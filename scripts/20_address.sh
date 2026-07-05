#!/usr/bin/env bash
# Derive the treasury's Orchard-ONLY address and Unified Full Viewing Key
# from the FROST group's verifying key (ak).
#
# FOOTGUN GUARD 1: the FROST account is Orchard-only. Only the Orchard
# receiver printed here may ever be shown as a deposit address — funds
# sent to a Sapling receiver would be permanently unspendable.
#
# FOOTGUN GUARD 2: `zcash-sign generate` is NON-DETERMINISTIC — every run
# derives a brand-new account (different UFVK + address) from the same ak,
# because the nk/rivk viewing components are freshly randomized. Re-running
# this after the wallet is funded would point the treasury at a new, empty
# account and orphan the funds under the old one. So we refuse to overwrite an
# existing keys file unless --force is passed. Derive ONCE; keep that identity.
source "$(dirname "${BASH_SOURCE[0]}")/00_env.sh"

AK="${1:?usage: 20_address.sh <ak-hex> [--force]  (ak from: frost-client groups -c \$ALICE_CFG)}"
KEYS="$RIME_RUNTIME/treasury_keys.$RIME_NET.txt"

if [ -s "$KEYS" ] && [ "${2:-}" != "--force" ]; then
  echo "==> $KEYS already exists — refusing to overwrite."
  echo "    zcash-sign generate is non-deterministic; a new run would create a"
  echo "    DIFFERENT account and orphan any funds under the current address:"
  grep -oE 'u(test)?1[a-z0-9]{20,}' "$KEYS" | head -1
  echo "    Pass --force only if you intend to abandon that identity."
  exit 0
fi

zcash-sign generate --network "$RIME_NET" --ak "$AK" | tee "$KEYS"
chmod 600 "$KEYS"
echo
echo "==> saved to $KEYS (gitignored, 0600)"
echo "==> NEXT: scripts/30_wallet_init.sh <UFVK> [birthday-height]"
