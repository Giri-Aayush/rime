//! rime-signer — a signer's own agent.
//!
//! Each signer runs this on their own machine. It watches the treasury for
//! payments awaiting their approval and lets them approve or reject from where
//! they are — the same role the phone plays in the demo's device view.
//!
//! In this prototype the FROST key share and the participant flow live on the
//! rime-server (see THREAT_MODEL.md); this agent is the approval surface.
//! Production packaging moves the share and the participant into this daemon,
//! so the approval you give here is what unlocks your own signing — the CLI
//! surface stays the same.

use std::collections::BTreeSet;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use serde::Deserialize;

#[derive(Parser, Debug)]
#[command(name = "rime-signer", about = "A Rime signer's approval agent")]
struct Args {
    /// Signer name (alice|bob|carol) — maps to the dev token. Or pass --token.
    #[arg(long, global = true)]
    signer: Option<String>,

    /// Explicit bearer token (overrides --signer).
    #[arg(long, global = true)]
    token: Option<String>,

    /// rime-server base URL.
    #[arg(long, global = true, default_value = "http://127.0.0.1:8787")]
    server: String,

    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Watch for payments awaiting approval; print new ones as they arrive.
    Watch {
        /// Poll interval, seconds.
        #[arg(long, default_value_t = 3)]
        interval: u64,
    },
    /// List the payments currently awaiting a decision.
    Pending,
    /// Approve a payment by id.
    Approve { id: i64 },
    /// Reject a payment by id.
    Reject { id: i64 },
}

#[derive(Debug, Deserialize)]
struct PaymentRequest {
    id: i64,
    recipient: String,
    amount_zat: i64,
    reason: String,
    status: String,
    approvals: i64,
}

struct Client {
    http: reqwest::Client,
    server: String,
    token: String,
}

impl Client {
    async fn requests(&self) -> Result<Vec<PaymentRequest>> {
        let r = self
            .http
            .get(format!("{}/api/requests", self.server))
            .bearer_auth(&self.token)
            .send()
            .await
            .context("contacting rime-server")?;
        if !r.status().is_success() {
            return Err(anyhow!(
                "server returned {} — check the token/server",
                r.status()
            ));
        }
        Ok(r.json().await?)
    }

    async fn decide(&self, id: i64, decision: &str) -> Result<()> {
        let r = self
            .http
            .post(format!("{}/api/requests/{id}/decide", self.server))
            .json(&serde_json::json!({ "signer_token": self.token, "decision": decision }))
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!(
                "{}: {}",
                r.status(),
                r.text().await.unwrap_or_default()
            ));
        }
        Ok(())
    }
}

/// Payments still open for a decision.
fn awaiting(reqs: &[PaymentRequest]) -> impl Iterator<Item = &PaymentRequest> {
    reqs.iter()
        .filter(|r| r.status == "pending" || r.status == "quorum")
}

fn zec(zat: i64) -> String {
    format!("{:.8}", zat as f64 / 100_000_000.0)
}

fn print_pending(reqs: &[PaymentRequest]) {
    let open: Vec<_> = awaiting(reqs).collect();
    if open.is_empty() {
        println!("No payments awaiting approval.");
        return;
    }
    for r in open {
        println!(
            "  #{}  {} ZEC  {}/2 approvals  \"{}\"\n       to {}",
            r.id,
            zec(r.amount_zat),
            r.approvals,
            r.reason,
            r.recipient,
        );
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_target(false).init();
    let args = Args::parse();

    let token = match (&args.token, &args.signer) {
        (Some(t), _) => t.clone(),
        (None, Some(name)) => match name.to_lowercase().as_str() {
            "alice" | "bob" | "carol" => format!("dev-token-{}", name.to_lowercase()),
            other => {
                return Err(anyhow!(
                    "unknown signer '{other}' (use alice|bob|carol or --token)"
                ))
            }
        },
        (None, None) => return Err(anyhow!("pass --signer <name> or --token <token>")),
    };
    let client = Client {
        http: reqwest::Client::new(),
        server: args.server.clone(),
        token,
    };

    match args.cmd {
        Cmd::Pending => print_pending(&client.requests().await?),
        Cmd::Approve { id } => {
            client.decide(id, "approve").await?;
            println!("Approved payment #{id}.");
        }
        Cmd::Reject { id } => {
            client.decide(id, "reject").await?;
            println!("Rejected payment #{id}.");
        }
        Cmd::Watch { interval } => {
            println!(
                "Watching {} for payments awaiting approval (Ctrl-C to stop)...",
                client.server
            );
            let mut seen: BTreeSet<i64> = BTreeSet::new();
            let mut first = true;
            loop {
                match client.requests().await {
                    Ok(reqs) => {
                        for r in awaiting(&reqs) {
                            if seen.insert(r.id) {
                                if first {
                                    // On startup, show the current backlog once.
                                    println!(
                                        "· awaiting: #{} {} ZEC \"{}\" ({}/2)",
                                        r.id,
                                        zec(r.amount_zat),
                                        r.reason,
                                        r.approvals
                                    );
                                } else {
                                    println!(
                                        "\n▶ NEW approval needed: #{} — {} ZEC — \"{}\"\n  approve:  rime-signer --signer <you> approve {}",
                                        r.id, zec(r.amount_zat), r.reason, r.id
                                    );
                                }
                            }
                        }
                        first = false;
                    }
                    Err(e) => tracing::warn!("{e}"),
                }
                tokio::time::sleep(Duration::from_secs(interval)).await;
            }
        }
    }
    Ok(())
}
