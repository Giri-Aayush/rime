//! rime-repair — signer recovery for Rime treasuries.
//!
//! Implements the two operations the frost-client CLI does not expose:
//!   repair  — remaining signers regenerate a lost participant's share
//!             (FROST Repairable Threshold Scheme; the full key never exists)
//!   refresh — rotate all shares so any stolen old share becomes a dead key
//!
//! Day-1 skeleton: command surface only. Implementation lands Jul 7 against
//! frost-core 2.2.0's keys::{repairable, refresh} APIs, operating on
//! `frost-client export`-ed key packages.

use clap::{Parser, Subcommand};

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
        /// Identifier (1-based) of the lost participant
        #[arg(long)]
        lost: u16,
        /// Paths to the helper signers' exported key packages
        #[arg(long, num_args = 2..)]
        helpers: Vec<String>,
        /// Output path for the repaired key package
        #[arg(long)]
        out: String,
    },
    /// Rotate every signer's share; previously exfiltrated shares die.
    Refresh {
        /// Paths to all current signers' exported key packages
        #[arg(long, num_args = 2..)]
        shares: Vec<String>,
    },
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    match args.cmd {
        Cmd::Repair { lost, .. } => anyhow::bail!(
            "not yet implemented (lands Jul 7): RTS repair for participant {lost} via frost_core::keys::repairable"
        ),
        Cmd::Refresh { .. } => anyhow::bail!(
            "not yet implemented (lands Jul 7): share refresh via frost_core::keys::refresh"
        ),
    }
}
