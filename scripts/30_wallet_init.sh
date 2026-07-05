#!/usr/bin/env bash
# Initialize the watch-only treasury wallet from the UFVK and start syncing.
source "$(dirname "${BASH_SOURCE[0]}")/00_env.sh"

UFVK="${1:?usage: 30_wallet_init.sh <UFVK> <birthday-height>}"
BIRTHDAY="${2:?usage: 30_wallet_init.sh <UFVK> <birthday-height>}"

zcash-devtool wallet -w "$WALLET_DIR" init-fvk \
  --name rime_treasury \
  --fvk "$UFVK" \
  --birthday "$BIRTHDAY" \
  -s "$LIGHTWALLETD"

echo "==> syncing (first sync can take a while; birthday height bounds it)"
zcash-devtool wallet -w "$WALLET_DIR" sync
zcash-devtool wallet -w "$WALLET_DIR" balance
