#!/usr/bin/env bash
# Initialize the watch-only treasury wallet from the UFVK and start syncing.
source "$(dirname "${BASH_SOURCE[0]}")/00_env.sh"

UFVK="${1:?usage: 30_wallet_init.sh <UFVK> [birthday-height]}"
BIRTHDAY="${2:-}"  # empty = devtool defaults to current chain height

# Connection mode: devtool defaults to Tor, which cannot resolve the raw
# testnet URL — direct is fine for a demo (and for testnet especially).
zcash-devtool wallet -w "$WALLET_DIR" init-fvk \
  --name rime_treasury \
  --fvk "$UFVK" \
  ${BIRTHDAY:+--birthday "$BIRTHDAY"} \
  -s "$LIGHTWALLETD" \
  --connection "${RIME_CONNECTION:-direct}"

echo "==> syncing (first sync can take a while; birthday height bounds it)"
zcash-devtool wallet -w "$WALLET_DIR" sync
zcash-devtool wallet -w "$WALLET_DIR" balance
