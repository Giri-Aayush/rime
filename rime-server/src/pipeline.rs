//! The signing ceremony pipeline: what happens after the second approval.
//!
//! Orchestrates the exact flow proven by hand on Jul 5 (see scripts/40..60):
//!
//! ```text
//!   1. zcash-devtool pczt create            → unsigned PCZT (reason in memo)
//!   2. zcash-sign sign                      → prints SIGHASH + randomizer,
//!                                             then waits on stdin for the
//!                                             FROST aggregate signature
//!   3. frost-client coordinator + 2 participants (the approvers) via frostd
//!                                           → aggregate RedPallas signature
//!   4. signature → zcash-sign stdin         → signed PCZT
//!   5. zcash-devtool pczt prove / combine / send → txid on-chain
//! ```
//!
//! Every step emits an SSE event and an audit row. The server never touches
//! key shares: participants run against per-signer frost-client configs.
//!
//! NOTE (demo shortcut, replaced when rime-signer daemons land): participant
//! processes are spawned by the server with consent pre-given, because the
//! human already approved in the UI — the UI approval IS the consent the
//! participant prompt asks for.

use std::process::Stdio;

use anyhow::{anyhow, Context};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};

use crate::config::{RimeConfig, SignerCfg};

pub struct PipelineOutcome {
    pub txid: String,
}

/// Emit progress via this callback: (step, detail).
pub type Progress<'a> = &'a (dyn Fn(&str, &str) + Send + Sync);

pub async fn run(
    cfg: &RimeConfig,
    request_id: i64,
    recipient: &str,
    amount_zat: i64,
    memo: &str,
    approvers: &[SignerCfg],
    progress: Progress<'_>,
) -> anyhow::Result<PipelineOutcome> {
    if approvers.len() < 2 {
        return Err(anyhow!("need 2 approvers, got {}", approvers.len()));
    }
    let dir = &cfg.runtime_dir;
    let created = format!("{dir}/pczt.{request_id}.created");
    let signed = format!("{dir}/pczt.{request_id}.signed");
    let proven = format!("{dir}/pczt.{request_id}.proven");
    let finalp = format!("{dir}/pczt.{request_id}.final");

    // 1. Build the unsigned PCZT ------------------------------------------
    progress("pczt.create", "building unsigned transaction");
    let out = Command::new("zcash-devtool")
        .args(["pczt", "-w", &cfg.wallet_dir, "create"])
        .args(["--address", recipient])
        .args(["--value", &amount_zat.to_string()])
        .args(["--memo", memo])
        .stderr(Stdio::piped())
        .output()
        .await
        .context("spawning zcash-devtool pczt create")?;
    if !out.status.success() {
        return Err(anyhow!(
            "pczt create failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    tokio::fs::write(&created, &out.stdout).await?;

    // 2. zcash-sign: extract SIGHASH + randomizer, hold for signature -----
    progress("sighash.extract", "extracting SIGHASH and randomizer");
    let mut zsign = Command::new("zcash-sign")
        .args(["sign", "--network", &cfg.network])
        .args(["--tx-plan", &created, "-o", &signed])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("spawning zcash-sign")?;

    let zsign_stdout = zsign.stdout.take().expect("piped");
    let mut reader = BufReader::new(zsign_stdout).lines();
    let mut hexes: Vec<String> = Vec::new();
    while hexes.len() < 2 {
        let line = tokio::time::timeout(std::time::Duration::from_secs(60), reader.next_line())
            .await
            .context("timed out waiting for SIGHASH/randomizer from zcash-sign")??
            .ok_or_else(|| {
                anyhow!("zcash-sign closed stdout before printing SIGHASH/randomizer")
            })?;
        hexes.extend(hex_tokens(&line, 64));
    }
    let (sighash, randomizer) = (hexes[0].clone(), hexes[1].clone());
    progress("sighash.ready", &format!("SIGHASH {}", &sighash[..16]));

    // 3. FROST ceremony through frostd -------------------------------------
    progress(
        "ceremony.start",
        &format!(
            "2-of-3 ceremony: {} + {}",
            approvers[0].name, approvers[1].name
        ),
    );
    let signature = ceremony(cfg, &sighash, &randomizer, approvers, progress).await?;
    progress(
        "ceremony.signed",
        &format!("aggregate signature {}", &signature[..16]),
    );

    // 4. Hand the signature back to zcash-sign -----------------------------
    let mut stdin = zsign.stdin.take().expect("piped");
    stdin.write_all(format!("{signature}\n").as_bytes()).await?;
    drop(stdin);
    let status = zsign.wait().await?;
    if !status.success() {
        return Err(anyhow!("zcash-sign rejected the signature"));
    }
    progress("pczt.signed", "signature applied");

    // 5. Prove, combine, broadcast -----------------------------------------
    progress("pczt.prove", "computing zero-knowledge proof");
    pipe_file_cmd(
        "zcash-devtool",
        &["pczt", "-w", &cfg.wallet_dir, "prove"],
        &created,
        &proven,
    )
    .await?;
    progress("pczt.combine", "combining signed + proven");
    let out = Command::new("zcash-devtool")
        .args([
            "pczt",
            "-w",
            &cfg.wallet_dir,
            "combine",
            "-i",
            &signed,
            "-i",
            &proven,
        ])
        .stderr(Stdio::piped())
        .output()
        .await?;
    if !out.status.success() {
        return Err(anyhow!(
            "pczt combine failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    tokio::fs::write(&finalp, &out.stdout).await?;

    progress("broadcast", "sending to the network");
    let final_bytes = tokio::fs::read(&finalp).await?;
    let mut send = Command::new("zcash-devtool")
        .args(["pczt", "-w", &cfg.wallet_dir, "send"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    send.stdin
        .take()
        .expect("piped")
        .write_all(&final_bytes)
        .await?;
    let out = send.wait_with_output().await?;
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if !out.status.success() {
        return Err(anyhow!("broadcast failed: {combined}"));
    }
    let txid = hex_tokens(&combined, 64)
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("no txid in send output: {combined}"))?;
    progress("confirmed", &format!("txid {txid}"));

    Ok(PipelineOutcome { txid })
}

/// Run the coordinator + the two approvers' participant processes, return the
/// aggregate signature hex. Mirrors scripts/55_ceremony.sh.
async fn ceremony(
    cfg: &RimeConfig,
    sighash: &str,
    randomizer: &str,
    approvers: &[SignerCfg],
    progress: Progress<'_>,
) -> anyhow::Result<String> {
    let coord_cfg = cfg.coordinator();
    let selected = format!("{},{}", approvers[0].pubkey, approvers[1].pubkey);

    let mut coordinator = frost_cmd(cfg, "coordinator", &coord_cfg.frost_config)
        .args(["--group", &cfg.group, "-S", &selected, "-m", "-", "-r", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("spawning frost-client coordinator")?;
    coordinator
        .stdin
        .take()
        .expect("piped")
        .write_all(format!("{sighash}\n{randomizer}\n").as_bytes())
        .await?;

    // Give the coordinator a moment to create the frostd session, then join
    // the approvers. Consent is pre-given: the human clicked Approve in the UI.
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    let mut participants: Vec<Child> = Vec::new();
    for a in &approvers[..2] {
        progress("ceremony.join", &format!("{} joining", a.name));
        let mut p = frost_cmd(cfg, "participant", &a.frost_config)
            .args(["--group", &cfg.group])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| format!("spawning participant {}", a.name))?;
        p.stdin.take().expect("piped").write_all(b"y\n").await?;
        participants.push(p);
    }

    // The coordinator prints "Signature:" followed by 128 hex chars.
    let mut out = String::new();
    coordinator
        .stdout
        .take()
        .expect("piped")
        .read_to_string(&mut out)
        .await?;
    let status = coordinator.wait().await?;
    for mut p in participants {
        let _ = p.wait().await;
    }
    if !status.success() {
        let mut err = String::new();
        if let Some(mut se) = coordinator.stderr.take() {
            let _ = se.read_to_string(&mut err).await;
        }
        return Err(anyhow!("coordinator failed: {out}\n{err}"));
    }
    hex_tokens(&out, 128)
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("no signature in coordinator output: {out}"))
}

fn frost_cmd(cfg: &RimeConfig, sub: &str, signer_config: &str) -> Command {
    let mut c = Command::new("frost-client");
    c.arg(sub)
        .args(["-c", signer_config])
        .args(["--server-url", &cfg.frostd_url])
        .env("SSL_CERT_FILE", &cfg.ca_cert);
    c
}

/// stdin-from-file → stdout-to-file subprocess helper (for `pczt prove`).
async fn pipe_file_cmd(bin: &str, args: &[&str], input: &str, output: &str) -> anyhow::Result<()> {
    let inp = tokio::fs::read(input).await?;
    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child.stdin.take().expect("piped").write_all(&inp).await?;
    let out = child.wait_with_output().await?;
    if !out.status.success() {
        return Err(anyhow!(
            "{bin} {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    tokio::fs::write(output, &out.stdout).await?;
    Ok(())
}

/// Extract lowercase hex tokens of exactly `len` chars from arbitrary text —
/// tolerant of label/prompt formatting differences across tool versions.
fn hex_tokens(text: &str, len: usize) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_hexdigit())
        .filter(|t| t.len() == len)
        .map(|t| t.to_ascii_lowercase())
        .collect()
}
