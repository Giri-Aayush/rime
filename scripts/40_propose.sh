#!/usr/bin/env bash
# Build the unsigned transaction (PCZT) for an approved payment request.
# The reason string rides in the encrypted memo — auditable by the
# treasury, invisible on-chain.
source "$(dirname "${BASH_SOURCE[0]}")/00_env.sh"

DEST="${1:?usage: 40_propose.sh <dest-unified-address> <value-zatoshis> <memo>}"
VALUE="${2:?value in zatoshis}"
MEMO="${3:-}"

zcash-devtool pczt -w "$WALLET_DIR" create \
  --address "$DEST" --value "$VALUE" --memo "$MEMO" \
  > "$RIME_RUNTIME/pczt.created"

echo "==> PCZT written to $RIME_RUNTIME/pczt.created"
echo "==> NEXT: scripts/50_sign.sh"
