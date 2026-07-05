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
#   rime-server.toml→ full server config, incl. per-signer comm pubkeys
#
# Idempotent: each step is skipped if its output already exists (re-running
# keygen would mint a new group and orphan funds under the old address, so it
# is guarded). Extraction is deterministic against the tools' actual output
# formats (verified) — it only stops for manual help if a parse genuinely
# fails, never guessing in a way that could corrupt key material.
#
# SECURITY: every file this touches lives under runtime/ (gitignored, cleartext
# shares). Nothing here leaves that directory. rime-server.toml is written 0600.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 00_env.sh exports RIME_NET, RIME_RUNTIME, ALICE_CFG/BOB_CFG/CAROL_CFG,
# FROSTD_URL, WALLET_DIR, LIGHTWALLETD.
source "$HERE/00_env.sh"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }

# First lowercase 64-hex token on stdin (a 32-byte key). The group public key
# is the first hex in `frost-client groups` output ("Public key <hex>").
first_hex64() { grep -oE '[0-9a-fA-F]{64}' | head -n1 | tr 'A-F' 'a-f'; }

# frost-client prints `groups` to stderr, hence 2>&1 throughout.
#
# A signer's own communication pubkey. In `frost-client groups -c <their.toml>`
# the participant lines are "<TAB>[name]<TAB>(<hex>)", and the signer's OWN
# entry has a blank name. So the own pubkey is the parenthesized hex on the
# line whose name field (field 2, tab-separated) is empty; the "Public key"
# line and headers have no field-3 paren, so they're excluded. (awk selects the
# line — no `{64}` interval, which BSD awk lacks — grep extracts the hex.)
own_pubkey() {
  frost-client groups -c "$1" 2>&1 \
    | awk -F'\t' '$2 == "" && $3 ~ /^\(/ { print $3 }' \
    | grep -oE '[0-9a-fA-F]{64}' | head -n1 | tr 'A-F' 'a-f'
}

echo "Rime bring-up — network: $RIME_NET   runtime: $RIME_RUNTIME"

# ── 1/4 · TLS ────────────────────────────────────────────────────────────────
log "step 1/4 — frostd TLS certificates (idempotent)"
bash "$HERE/05_frostd_tls.sh"

# ── 2/4 · keygen ─────────────────────────────────────────────────────────────
# Guard: re-running trusted-dealer would mint a NEW group and orphan any funds
# under the old address. Skip if a group is already registered in Alice's config.
log "step 2/4 — 2-of-3 trusted-dealer keygen (redpallas / Orchard)"
if [ -f "$ALICE_CFG" ] && frost-client groups -c "$ALICE_CFG" 2>&1 | grep -qE '[0-9a-fA-F]{64}'; then
  echo "    a group is already registered in $ALICE_CFG — skipping keygen"
else
  bash "$HERE/10_keygen.sh"
fi

# The FROST group verifying key (ak) is the group's 64-hex public key, which is
# what 20_address.sh consumes.
AK="$(frost-client groups -c "$ALICE_CFG" 2>&1 | first_hex64 || true)"
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

# ── 5/5 · write rime-server.toml ─────────────────────────────────────────────
# Paths are written relative to the repo root, which is rime-server's working
# directory (locally and in the container).
SERVER_TOML="$RIME_RUNTIME/rime-server.toml"
log "step 5/5 — write $SERVER_TOML"

if [ -z "${ADDR:-}" ]; then
  warn "could not read the treasury address from $KEYS — leaving rime-server.toml for you to complete"
  exit 1
fi

# Deterministically pull each signer's own communication pubkey.
A_PK="$(own_pubkey "$ALICE_CFG")"; B_PK="$(own_pubkey "$BOB_CFG")"; C_PK="$(own_pubkey "$CAROL_CFG")"
if [ -z "$A_PK" ] || [ -z "$B_PK" ] || [ -z "$C_PK" ]; then
  warn "could not read a signer communication pubkey; not writing rime-server.toml"
  echo "    inspect: frost-client groups -c $ALICE_CFG"
  exit 1
fi

if [ -s "$SERVER_TOML" ] && [ "${1:-}" != "--force-config" ]; then
  echo "    $SERVER_TOML exists — leaving it (pass --force-config to overwrite)"
else
  umask 077
  cat > "$SERVER_TOML" <<EOF
# Generated by scripts/bringup.sh for network "$RIME_NET". Contains no secrets
# itself, but points at the signer configs which DO hold cleartext shares.
# The tokens below are DEMO credentials matching the shipped web UI; replace
# them with strong per-signer secrets for any real use.
network          = "$RIME_NET"
wallet_dir       = "runtime/wallet-$RIME_NET"
group            = "$AK"
frostd_url       = "localhost:2744"
ca_cert          = "runtime/tls/ca.crt"
runtime_dir      = "runtime"
treasury_address = "$ADDR"
# discord_webhook  = "https://discord.com/api/webhooks/..."   # or RIME_DISCORD_WEBHOOK

[[signers]]
id = 1
name = "Alice"
pubkey = "$A_PK"
frost_config = "runtime/alice.toml"
token = "dev-token-alice"

[[signers]]
id = 2
name = "Bob"
pubkey = "$B_PK"
frost_config = "runtime/bob.toml"
token = "dev-token-bob"

[[signers]]
id = 3
name = "Carol"
pubkey = "$C_PK"
frost_config = "runtime/carol.toml"
token = "dev-token-carol"
EOF
  chmod 600 "$SERVER_TOML"
  echo "    wrote $SERVER_TOML (0600)"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
log "init complete — rime-server is ready to run"
cat <<EOF
  network           : $RIME_NET
  group / ak        : $AK
  treasury address  : $ADDR
  signer pubkeys    : Alice $A_PK
                      Bob   $B_PK
                      Carol $C_PK
  server config     : $SERVER_TOML
  TLS               : $RIME_RUNTIME/tls/{ca.crt,server.crt,server.key}

Start the treasury:  make up   (docker)   or   make demo   (local)
Then open http://localhost:8787  (phones: http://<lan-ip>:8787/?signer=alice)
EOF
