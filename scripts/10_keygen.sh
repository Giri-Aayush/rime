#!/usr/bin/env bash
# Create the Rime 2-of-3 FROST signing group (trusted-dealer keygen).
# Follows the ZF FROST Book devtool tutorial exactly:
# https://frost.zfnd.org/zcash/devtool-demo.html
source "$(dirname "${BASH_SOURCE[0]}")/00_env.sh"

echo "==> init signer configs (Alice, Bob, Carol)"
[ -f "$ALICE_CFG" ] || frost-client init -c "$ALICE_CFG"
[ -f "$BOB_CFG" ]   || frost-client init -c "$BOB_CFG"
[ -f "$CAROL_CFG" ] || frost-client init -c "$CAROL_CFG"

echo "==> trusted-dealer 2-of-3 keygen (redpallas / Orchard)"
frost-client trusted-dealer \
  -d "Rime treasury (Alice, Bob, Carol)" \
  --names Alice,Bob,Carol \
  -c "$ALICE_CFG" -c "$BOB_CFG" -c "$CAROL_CFG" \
  -C redpallas

echo "==> group registered in all three configs:"
frost-client groups -c "$ALICE_CFG"
