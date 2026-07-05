//! Signer recovery: the server-side of the "lake scene".
//!
//! mark-lost   → the signer's token stops working (signer_by_token already
//!               excludes lost signers) and their daemon is out of the group
//! repair      → the remaining signers regenerate the lost share via
//!               rime-repair (RTS), writing it to the lost signer's config
//! refresh     → all shares rotate; the share at the bottom of the lake
//!               becomes a dead key. Group key and address are unchanged.
//!
//! rime-repair is driven as a subprocess, same philosophy as the signing
//! pipeline: the server orchestrates, the pinned tools do the cryptography.

use std::process::Stdio;

use anyhow::{anyhow, Result};
use tokio::process::Command;

use crate::config::RimeConfig;

fn repair_bin() -> String {
    std::env::var("RIME_REPAIR_BIN").unwrap_or_else(|_| "./target/debug/rime-repair".into())
}

async fn run(args: &[String]) -> Result<String> {
    let out = Command::new(repair_bin())
        .args(args)
        .stderr(Stdio::piped())
        .stdout(Stdio::piped())
        .output()
        .await?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    if !out.status.success() {
        return Err(anyhow!(
            "rime-repair failed: {}{}",
            stdout,
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(stdout)
}

/// Regenerate the lost signer's share from the remaining signers' configs.
pub async fn repair(cfg: &RimeConfig, lost_id: i64) -> Result<String> {
    let lost = cfg
        .signer_by_id(lost_id)
        .ok_or_else(|| anyhow!("unknown signer {lost_id}"))?;
    let mut args: Vec<String> = vec![
        "repair".into(),
        "--group".into(),
        cfg.group.clone(),
        "--lost".into(),
        lost_id.to_string(),
        "--lost-config".into(),
        lost.frost_config.clone(),
    ];
    for s in cfg.signers.iter().filter(|s| s.id != lost_id) {
        args.push("--helper".into());
        args.push(s.frost_config.clone());
    }
    run(&args).await
}

/// Rotate every signer's share in place; old shares become dead keys.
pub async fn refresh(cfg: &RimeConfig) -> Result<String> {
    let mut args: Vec<String> = vec!["refresh".into(), "--group".into(), cfg.group.clone()];
    for s in &cfg.signers {
        args.push("--config".into());
        args.push(s.frost_config.clone());
    }
    run(&args).await
}
