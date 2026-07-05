//! Treasury balance, read from the watch-only wallet.
//!
//! `zcash-devtool wallet balance` reads the wallet's cached state (no network
//! sync — ~60ms), printing a `Balance:   X.XXXXXXXX ZEC` line plus per-pool
//! spendable amounts. We shell out, parse the totals, and cache the result
//! briefly so a room full of dashboard pollers doesn't spawn a subprocess each.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use tokio::process::Command;

#[derive(Clone, Debug, serde::Serialize)]
pub struct Balance {
    pub total_zat: i64,
    pub orchard_zat: i64,
    /// Wallet's synced chain height, if reported.
    pub height: Option<i64>,
}

pub struct BalanceCache {
    inner: Mutex<Option<(Instant, Balance)>>,
    ttl: Duration,
}

impl BalanceCache {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None), ttl: Duration::from_secs(8) }
    }

    /// Cached balance, refreshing at most once per `ttl`.
    pub async fn get(&self, wallet_dir: &str) -> Result<Balance> {
        if let Some((at, bal)) = self.inner.lock().unwrap().as_ref() {
            if at.elapsed() < self.ttl {
                return Ok(bal.clone());
            }
        }
        let bal = read(wallet_dir).await?;
        *self.inner.lock().unwrap() = Some((Instant::now(), bal.clone()));
        Ok(bal)
    }
}

async fn read(wallet_dir: &str) -> Result<Balance> {
    let out = Command::new("zcash-devtool")
        .args(["wallet", "-w", wallet_dir, "balance"])
        .output()
        .await?;
    // devtool prints to stdout+stderr; parse both.
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if !out.status.success() && !text.contains("Balance:") {
        return Err(anyhow!("zcash-devtool balance failed: {text}"));
    }
    Ok(Balance {
        total_zat: zats_after(&text, "Balance:").unwrap_or(0),
        orchard_zat: zats_after(&text, "Orchard Spendable:").unwrap_or(0),
        height: line_after(&text, "Height:").and_then(|s| s.trim().parse().ok()),
    })
}

/// The decimal-ZEC amount following `label`, converted to zatoshis.
fn zats_after(text: &str, label: &str) -> Option<i64> {
    let s = line_after(text, label)?;
    let zec: f64 = s.split_whitespace().next()?.parse().ok()?;
    Some((zec * 100_000_000.0).round() as i64)
}

fn line_after<'a>(text: &'a str, label: &str) -> Option<&'a str> {
    text.lines().find_map(|l| l.split_once(label).map(|(_, rest)| rest.trim()))
}
