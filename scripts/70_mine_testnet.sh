#!/usr/bin/env bash
# Self-sufficient testnet funding: mine TAZ directly into the treasury.
#
# Zcash testnet accepts MINIMUM-difficulty blocks when no block has arrived
# for ~6 target spacings (~7.5 min), so a CPU can win blocks. Zebra's
# experimental internal miner (build: cargo install zebrad --features
# internal-miner) exploits exactly this, and supports ZIP-213 shielded
# coinbase — the reward lands straight in the treasury's Orchard address.
# Coinbase spends unlock after 100 confirmations (~2h at 75s blocks).
#
# Requires: runtime/zebrad.toml (see repo docs; ~10 GB disk for testnet).
source "$(dirname "${BASH_SOURCE[0]}")/00_env.sh"

exec zebrad -c "$RIME_RUNTIME/zebrad.toml" start
