//! rime-repair — signer recovery for Rime treasuries.
//!
//! Implements the two operations frost-client has no CLI for:
//!
//!   repair  — the remaining signers regenerate a lost participant's share
//!             (FROST Repairable Threshold Scheme, eprint 2017/1155).
//!             The full group key never exists at any point.
//!   refresh — all signers rotate their shares in place (zero-sharing).
//!             The group key and address stay the same; any previously
//!             stolen share becomes a dead key.
//!
//! Operates directly on frost-client config files. frost-client stores each
//! signer's KeyPackage and the group's PublicKeyPackage, but not the VSS
//! commitment that frost-core's repair API wants to carry around — so we pass
//! a placeholder commitment (never verified against) and instead verify the
//! repaired share against the participant's verifying share from the public
//! key package, which is stronger and uses only data we actually have.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use clap::{Parser, Subcommand};
use frost_core::keys::refresh::{compute_refreshing_shares, refresh_share};
use frost_core::keys::repairable::{
    repair_share_step_1, repair_share_step_2, repair_share_step_3,
};
use frost_core::keys::{
    KeyPackage, PublicKeyPackage, SecretShare, VerifiableSecretSharingCommitment, VerifyingShare,
};
use frost_core::Identifier;

/// Orchard's RedPallas ciphersuite — the Rime treasury's curve.
type C = reddsa::frost::redpallas::PallasBlake2b512;

#[derive(Parser, Debug)]
#[command(name = "rime-repair", about = "Repair a lost Rime signer / refresh shares")]
struct Args {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Regenerate a lost signer's share from the remaining signers' shares.
    Repair {
        /// Group public key (hex), as shown by `frost-client groups`
        #[arg(long)]
        group: String,
        /// Identifier of the lost participant (1-based, as in keygen order)
        #[arg(long)]
        lost: u16,
        /// frost-client config of each helper (need at least threshold many)
        #[arg(long = "helper", num_args = 1, action = clap::ArgAction::Append)]
        helpers: Vec<PathBuf>,
        /// frost-client config file to write the repaired share into
        #[arg(long)]
        lost_config: PathBuf,
        /// Compute and verify, but do not write
        #[arg(long)]
        dry_run: bool,
    },
    /// Rotate every signer's share in place; old shares become dead keys.
    Refresh {
        /// Group public key (hex)
        #[arg(long)]
        group: String,
        /// frost-client configs of ALL signers (every share must rotate)
        #[arg(long = "config", num_args = 1, action = clap::ArgAction::Append)]
        configs: Vec<PathBuf>,
        /// Signing threshold of the group
        #[arg(long, default_value_t = 2)]
        min_signers: u16,
    },
}

fn main() -> Result<()> {
    match Args::parse().cmd {
        Cmd::Repair { group, lost, helpers, lost_config, dry_run } => {
            repair(&group, lost, &helpers, &lost_config, dry_run)
        }
        Cmd::Refresh { group, configs, min_signers } => refresh(&group, &configs, min_signers),
    }
}

fn repair(group: &str, lost: u16, helpers: &[PathBuf], lost_config: &Path, dry_run: bool) -> Result<()> {
    if helpers.len() < 2 {
        bail!("need at least 2 helpers (the signing threshold)");
    }
    let lost_id = Identifier::<C>::try_from(lost).map_err(|e| anyhow!("bad identifier {lost}: {e}"))?;

    // Load the helpers' key packages and the group's public key package.
    let mut helper_packages: Vec<KeyPackage<C>> = Vec::new();
    for path in helpers {
        helper_packages.push(read_key_package(path, group)?);
    }
    let pubkeys = read_public_key_package(&helpers[0], group)?;
    let helper_ids: Vec<Identifier<C>> = helper_packages.iter().map(|kp| *kp.identifier()).collect();
    if helper_ids.contains(&lost_id) {
        bail!("participant {lost} is listed as a helper — helpers must be the remaining signers");
    }

    // frost-core's repair API carries a VSS commitment it never verifies
    // during the ceremony; frost-client doesn't store one. A single-element
    // placeholder (the group verifying key) satisfies the type.
    let carrier = VerifiableSecretSharingCommitment::<C>::deserialize(vec![pubkeys
        .verifying_key()
        .serialize()?])?;

    let mut rng = rand::rngs::OsRng;

    // Step 1: each helper derives deltas addressed to every helper.
    let mut deltas_for: BTreeMap<Identifier<C>, Vec<frost_core::Scalar<C>>> = BTreeMap::new();
    for kp in &helper_packages {
        let share = SecretShare::new(*kp.identifier(), *kp.signing_share(), carrier.clone());
        let deltas = repair_share_step_1(&helper_ids, &share, &mut rng, lost_id)
            .map_err(|e| anyhow!("repair step 1: {e}"))?;
        for (target, delta) in deltas {
            deltas_for.entry(target).or_default().push(delta);
        }
    }

    // Step 2: each helper sums the deltas it received.
    let sigmas: Vec<frost_core::Scalar<C>> = helper_ids
        .iter()
        .map(|id| repair_share_step_2::<C>(&deltas_for[id]))
        .collect();

    // Step 3: the sigmas reconstruct the lost signing share.
    let repaired = repair_share_step_3(&sigmas, lost_id, &carrier);

    // Verify against public data: the repaired share must map to the lost
    // participant's verifying share from the public key package.
    let expected: &VerifyingShare<C> = pubkeys
        .verifying_shares()
        .get(&lost_id)
        .ok_or_else(|| anyhow!("participant {lost} not in the public key package"))?;
    let derived = VerifyingShare::<C>::from(*repaired.signing_share());
    if &derived != expected {
        bail!("repaired share FAILED verification against the group's public key package");
    }

    let key_package = KeyPackage::new(
        lost_id,
        *repaired.signing_share(),
        *expected,
        *pubkeys.verifying_key(),
        helper_packages[0].min_signers().to_owned(),
    );

    if dry_run {
        println!("repair verified for participant {lost} (dry run, nothing written)");
        return Ok(());
    }
    write_key_package(lost_config, group, &key_package)?;
    println!(
        "repaired share for participant {lost} written to {} (verified against the group public key)",
        lost_config.display()
    );
    Ok(())
}

fn refresh(group: &str, configs: &[PathBuf], min_signers: u16) -> Result<()> {
    if configs.len() < 2 {
        bail!("refresh needs every signer's config (all shares must rotate together)");
    }
    let packages: Vec<KeyPackage<C>> = configs
        .iter()
        .map(|p| read_key_package(p, group))
        .collect::<Result<_>>()?;
    let identifiers: Vec<Identifier<C>> = packages.iter().map(|kp| *kp.identifier()).collect();
    let pubkeys = read_public_key_package(&configs[0], group)?;
    let old_vk = pubkeys.verifying_key().serialize()?;

    let mut rng = rand::rngs::OsRng;
    let (zero_shares, new_pubkeys) = compute_refreshing_shares(
        pubkeys,
        configs.len() as u16,
        min_signers,
        &identifiers,
        &mut rng,
    )
    .map_err(|e| anyhow!("compute refreshing shares: {e}"))?;

    // The group key must not change — same treasury address, new shares.
    if new_pubkeys.verifying_key().serialize()? != old_vk {
        bail!("refresh produced a different group key; aborting before write");
    }

    for (path, kp) in configs.iter().zip(&packages) {
        let zero = zero_shares
            .iter()
            .find(|s| s.identifier() == kp.identifier())
            .ok_or_else(|| anyhow!("no refreshing share for {:?}", kp.identifier()))?;
        let new_kp = refresh_share(zero.clone(), kp).map_err(|e| anyhow!("refresh share: {e}"))?;
        write_key_package(path, group, &new_kp)?;
        write_public_key_package(path, group, &new_pubkeys)?;
        println!("rotated share in {}", path.display());
    }
    println!("group key unchanged; all previous shares are now dead keys");
    Ok(())
}

// ---- frost-client config plumbing ------------------------------------------

fn load_doc(path: &Path) -> Result<toml::Value> {
    let raw = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    Ok(raw.parse::<toml::Value>()?)
}

fn group_entry<'a>(doc: &'a toml::Value, path: &Path, group: &str) -> Result<&'a toml::Value> {
    doc.get("group")
        .and_then(|g| g.get(group))
        .ok_or_else(|| anyhow!("group {group} not found in {}", path.display()))
}

fn read_key_package(path: &Path, group: &str) -> Result<KeyPackage<C>> {
    let doc = load_doc(path)?;
    let hex_str = group_entry(&doc, path, group)?
        .get("key_package")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("no key_package in {}", path.display()))?;
    KeyPackage::deserialize(&hex::decode(hex_str)?)
        .map_err(|e| anyhow!("bad key_package in {}: {e}", path.display()))
}

fn read_public_key_package(path: &Path, group: &str) -> Result<PublicKeyPackage<C>> {
    let doc = load_doc(path)?;
    let hex_str = group_entry(&doc, path, group)?
        .get("public_key_package")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("no public_key_package in {}", path.display()))?;
    PublicKeyPackage::deserialize(&hex::decode(hex_str)?)
        .map_err(|e| anyhow!("bad public_key_package in {}: {e}", path.display()))
}

fn write_group_field(path: &Path, group: &str, field: &str, value: String) -> Result<()> {
    let mut doc = load_doc(path)?;
    let entry = doc
        .get_mut("group")
        .and_then(|g| g.get_mut(group))
        .ok_or_else(|| anyhow!("group {group} not found in {}", path.display()))?;
    entry
        .as_table_mut()
        .ok_or_else(|| anyhow!("malformed group entry"))?
        .insert(field.into(), toml::Value::String(value));
    write_atomic_owner_only(path, &toml::to_string_pretty(&doc)?)
}

/// These files hold cleartext key shares: write 0600 and atomically (tempfile
/// in the same directory, then rename), so no reader ever sees a
/// world-readable or half-written config. Renaming also tightens the mode of
/// configs frost-client originally created with the default umask.
fn write_atomic_owner_only(path: &Path, contents: &str) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let dir = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("config");
    let tmp = dir.join(format!(".{name}.rime-tmp"));
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)
        .with_context(|| format!("creating {}", tmp.display()))?;
    f.write_all(contents.as_bytes())?;
    f.sync_all()?;
    std::fs::rename(&tmp, path).with_context(|| format!("replacing {}", path.display()))?;
    Ok(())
}

fn write_key_package(path: &Path, group: &str, kp: &KeyPackage<C>) -> Result<()> {
    write_group_field(path, group, "key_package", hex::encode(kp.serialize()?))
}

fn write_public_key_package(path: &Path, group: &str, pkp: &PublicKeyPackage<C>) -> Result<()> {
    write_group_field(path, group, "public_key_package", hex::encode(pkp.serialize()?))
}
