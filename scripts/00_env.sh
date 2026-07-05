#!/usr/bin/env bash
# Shared environment for the Rime script contract.
# These scripts are the immutable interface between rime-server and the
# Zcash Foundation reference tools — and double as the README's
# reproduction steps. Source this file from every other script.
set -euo pipefail

# main | test  (rules require mainnet interaction; test is the debug fallback)
export RIME_NET="${RIME_NET:-main}"

# Everything generated at runtime (configs, wallets, PCZTs) lives under
# runtime/ — which is gitignored. NO KEY MATERIAL EVER LEAVES runtime/.
export RIME_RUNTIME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/runtime"
mkdir -p "$RIME_RUNTIME"

# Per-signer frost-client configs (each holds ONLY that signer's share)
export ALICE_CFG="$RIME_RUNTIME/alice.toml"
export BOB_CFG="$RIME_RUNTIME/bob.toml"
export CAROL_CFG="$RIME_RUNTIME/carol.toml"

# frostd coordination server (local for the demo)
export FROSTD_URL="${FROSTD_URL:-localhost:2744}"

# Watch-only wallet directory (zcash-devtool) — one per network
export WALLET_DIR="$RIME_RUNTIME/wallet-$RIME_NET"

# Public lightwalletd endpoint. The named "zecrocks" resolves per-network
# inside zcash-devtool (zec.rocks for main, testnet.zec.rocks for test —
# selected by the UFVK's network). Custom values must be host:port.
export LIGHTWALLETD="${LIGHTWALLETD:-zecrocks}"
