#!/usr/bin/env bash
# Derive the treasury's Orchard-ONLY address and Unified Full Viewing Key
# from the FROST group's verifying key (ak).
#
# FOOTGUN GUARD: the FROST account is Orchard-only. Only the Orchard
# receiver printed here may ever be shown as a deposit address — funds
# sent to a Sapling receiver would be permanently unspendable.
source "$(dirname "${BASH_SOURCE[0]}")/00_env.sh"

AK="${1:?usage: 20_address.sh <ak-hex>  (from: frost-client groups -c \$ALICE_CFG)}"

zcash-sign generate --net "$RIME_NET" --ak "$AK" | tee "$RIME_RUNTIME/treasury_keys.txt"
echo
echo "==> saved to $RIME_RUNTIME/treasury_keys.txt (gitignored)"
echo "==> NEXT: scripts/30_wallet_init.sh <UFVK> <birthday-height>"
