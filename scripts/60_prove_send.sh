#!/usr/bin/env bash
# Prove, combine, and broadcast the FROST-signed transaction to mainnet.
source "$(dirname "${BASH_SOURCE[0]}")/00_env.sh"

echo "==> proving"
zcash-devtool pczt -w "$WALLET_DIR" prove \
  < "$RIME_RUNTIME/pczt.created" > "$RIME_RUNTIME/pczt.proven"

echo "==> combining signed + proven"
zcash-devtool pczt -w "$WALLET_DIR" combine \
  -i "$RIME_RUNTIME/pczt.signed" -i "$RIME_RUNTIME/pczt.proven" \
  > "$RIME_RUNTIME/pczt.final"

echo "==> broadcasting"
zcash-devtool pczt -w "$WALLET_DIR" send < "$RIME_RUNTIME/pczt.final"
