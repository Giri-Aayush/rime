#!/usr/bin/env bash
# Signing step 2: the FROST ceremony. 2 of 3 signers produce ONE signature.
#
# Coordinator = the treasury operator (also Signer #1, Alice) — the ZIP 312
# trust model, stated openly. Requires frostd running (see frostd docs;
# local TLS via mkcert).
#
# Tutorial reference: coordinator reads the SIGHASH (-m) and randomizer (-r)
# printed by 50_sign.sh; participants join and rounds complete automatically.
# Run each command in its own terminal (or let rime-server drive them):
source "$(dirname "${BASH_SOURCE[0]}")/00_env.sh"

GROUP="${1:?usage: 55_ceremony.sh <group-pubkey> <signer1-pubkey> <signer2-pubkey>}"
P1="${2:?participant 1 pubkey}"
P2="${3:?participant 2 pubkey}"

cat <<EOF
# Terminal 1 — coordinator (Alice):
frost-client coordinator -c "$ALICE_CFG" --server-url "$FROSTD_URL" \\
  --group "$GROUP" -S "$P1,$P2" -m - -r -
#   (paste SIGHASH, then randomizer, from 50_sign.sh)

# Terminal 2 — participant (Alice):
frost-client participant -c "$ALICE_CFG" --server-url "$FROSTD_URL" --group "$GROUP"

# Terminal 3 — participant (Bob):
frost-client participant -c "$BOB_CFG" --server-url "$FROSTD_URL" --group "$GROUP"

# Then paste the aggregate signature back into the 50_sign.sh prompt.
EOF
