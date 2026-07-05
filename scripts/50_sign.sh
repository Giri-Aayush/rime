#!/usr/bin/env bash
# Signing step 1: zcash-sign extracts the SIGHASH + randomizer from the
# PCZT and waits for the FROST-aggregated signature.
#
# Interactive in the tutorial; rime-server automates it by driving
# stdin/stdout. Run the ceremony (55_ceremony.sh) to produce the signature
# this step is waiting for.
source "$(dirname "${BASH_SOURCE[0]}")/00_env.sh"

zcash-sign sign -n "$RIME_NET" \
  --tx-plan "$RIME_RUNTIME/pczt.created" \
  -o "$RIME_RUNTIME/pczt.signed"

echo "==> signed PCZT at $RIME_RUNTIME/pczt.signed"
echo "==> NEXT: scripts/60_prove_send.sh"
