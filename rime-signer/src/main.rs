//! rime-signer — one instance runs per participant.
//!
//! Holds ONLY its own FROST share (via its frost-client config directory) and
//! polls the server for ceremonies awaiting this signer. It joins a FROST
//! signing round (by driving `frost-client participant` as a subprocess) only
//! after its human has approved the payment in the UI — human intent gates the
//! cryptographic actor.
//!
//! Day-1 skeleton: argument surface + poll loop. Ceremony wiring lands Jul 6.

use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "rime-signer", about = "Rime treasury signer daemon")]
struct Args {
    /// Server base URL
    #[arg(long, default_value = "http://127.0.0.1:8787")]
    server: String,

    /// This signer's bearer token
    #[arg(long)]
    token: String,

    /// Path to this signer's frost-client config (holds only THIS share)
    #[arg(long)]
    frost_config: String,

    /// Poll interval in seconds
    #[arg(long, default_value_t = 2)]
    interval: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().init();
    let args = Args::parse();
    tracing::info!(server = %args.server, config = %args.frost_config, "rime-signer starting");

    loop {
        // TODO(Jul 6): GET {server}/api/signer/pending with bearer token;
        // on an approved ceremony, spawn `frost-client participant` against
        // frostd and stream progress back to the server.
        tokio::time::sleep(std::time::Duration::from_secs(args.interval)).await;
        tracing::debug!("poll tick");
    }
}
