#!/usr/bin/env bash
# scripts/bringup.sh — NEW: one-command Rime initialization.
#
# Chains the one-time init steps that produce the gitignored files under
# runtime/. Used by `make keygen` and by the docker-compose `init` service:
#
#   05_frostd_tls   → local CA + frostd server cert     (runtime/tls/*)
#   10_keygen       → 2-of-3 trusted-dealer FROST group (runtime/{alice,bob,carol}.toml)
#   20_address      → Orchard-only treasury addr + UFVK (runtime/treasury_keys.$NET.txt)
#   30_wallet_init  → watch-only wallet + first sync     (runtime/wallet-$NET)
#
# It is best-effort automated and idempotent where the underlying scripts are:
# each step is skipped if its output already exists, and if a tool's output
# can't be parsed automatically it STOPS and prints the exact manual command to
# continue — it never guesses in a way that could corrupt key material.
#
# It does NOT write runtime/rime-server.toml (that needs the per-signer
# communication pubkeys); it prints what you need to fill it. See SETUP.md.
#
# SECURITY: every file this touches lives under runtime/ (gitignored, cleartext
# shares). Nothing here leaves that directory.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 00_env.sh exports RIME_NET, RIME_RUNTIME, ALICE_CFG/BOB_CFG/CAROL_CFG,
# FROSTD_URL, WALLET_DIR, LIGHTWALLETD.
source "$HERE/00_env.sh"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }

# First lowercase 64-hex token on stdin (a 32-byte key). Tolerant of the
# surrounding label formatting frost-client uses.
first_hex64() { grep -oE '[0-9a-fA-F]{64}' | head -n1 | tr 'A-F' 'a-f'; }

echo "Rime bring-up — network: $RIME_NET   runtime: $RIME_RUNTIME"

# ── 1/4 · TLS ────────────────────────────────────────────────────────────────
log "step 1/4 — frostd TLS certificates (idempotent)"
bash "$HERE/05_frostd_tls.sh"

# ── 2/4 · keygen ─────────────────────────────────────────────────────────────
# Guard: re-running trusted-dealer would mint a NEW group and orphan any funds
# under the old address. Skip if a group is already registered in Alice's config.
log "step 2/4 — 2-of-3 trusted-dealer keygen (redpallas / Orchard)"
if [ -f "$ALICE_CFG" ] && frost-client groups -c "$ALICE_CFG" 2>/dev/null | grep -qE '[0-9a-fA-F]{64}'; then
  echo "    a group is already registered in $ALICE_CFG — skipping keygen"
else
  bash "$HERE/10_keygen.sh"
fi

# The FROST group verifying key (ak) is the group's 64-hex public key, which is
# what 20_address.sh consumes.
AK="$(frost-client groups -c "$ALICE_CFG" 2>/dev/null | first_hex64 || true)"
if [ -z "${AK:-}" ]; then
  warn "could not read the group key from: frost-client groups -c $ALICE_CFG"
  echo "    run that command, note the group public key (ak), then continue with:"
  echo "      scripts/20_address.sh <ak-hex>"
  echo "      scripts/30_wallet_init.sh <UFVK> [birthday-height]"
  exit 1
fi
echo "    group / ak = $AK"

# ── 3/4 · address ────────────────────────────────────────────────────────────
KEYS="$RIME_RUNTIME/treasury_keys.$RIME_NET.txt"
log "step 3/4 — derive Orchard-only treasury address + UFVK"
if [ -s "$KEYS" ]; then
  echo "    $KEYS already exists — skipping"
else
  bash "$HERE/20_address.sh" "$AK"
fi

# ── 4/4 · wallet init + sync ─────────────────────────────────────────────────
# The Unified FVK is the `uview…` (mainnet) / `uviewtest…` (testnet) token in the
# saved keys file. The treasury address is the `u1…`/`utest1…` token.
UFVK="$(grep -oE 'uview[a-z0-9]+' "$KEYS" 2>/dev/null | head -n1 || true)"
ADDR="$(grep -oE 'u(test)?1[a-z0-9]{20,}' "$KEYS" 2>/dev/null | head -n1 || true)"

log "step 4/4 — initialize + sync the watch-only wallet"
if [ -z "${UFVK:-}" ]; then
  warn "could not read the UFVK from $KEYS"
  echo "    inspect that file and run: scripts/30_wallet_init.sh <UFVK> [birthday-height]"
  exit 1
fi
if [ -d "$WALLET_DIR" ]; then
  echo "    wallet dir $WALLET_DIR exists — skipping init"
  echo "    (re-run scripts/30_wallet_init.sh \"$UFVK\" to force a re-sync)"
else
  bash "$HERE/30_wallet_init.sh" "$UFVK"
fi

# ── Done — hand off to rime-server.toml ──────────────────────────────────────
log "init complete"
cat <<EOF
  network           : $RIME_NET
  group / ak        : $AK
  treasury address  : ${ADDR:-<see $KEYS>}
  UFVK              : $UFVK
  signer configs    : $ALICE_CFG, $BOB_CFG, $CAROL_CFG
  TLS               : $RIME_RUNTIME/tls/{ca.crt,server.crt,server.key}

Next: create runtime/rime-server.toml so rime-server can run ceremonies.
Copy rime-server/config.example.toml to runtime/rime-server.toml and set:
  - network            = "$RIME_NET"
  - group              = "$AK"
  - treasury_address   = "${ADDR:-<from $KEYS>}"
  - each signer pubkey  (frost-client's communication key, from the [participant]
                         entries in frost-client groups -c $ALICE_CFG)
  - each signer token   (replace CHANGE-ME with a strong per-signer secret)
Then start the treasury:  make up    (docker)   or   make demo    (local)
EOF
