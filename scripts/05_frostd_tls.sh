#!/usr/bin/env bash
# Generate a local CA + server certificate for frostd, no mkcert/sudo needed.
#
# frost-client is built with reqwest's rustls-tls-native-roots, which honors
# the SSL_CERT_FILE env var — so pointing SSL_CERT_FILE at our CA makes the
# self-signed frostd cert trusted for this process only. Nothing touches the
# system keychain.
#
# Usage:
#   ./scripts/05_frostd_tls.sh          # generates runtime/tls/* (idempotent)
#   frostd -i 127.0.0.1 -p 2744 -c runtime/tls/server.crt -k runtime/tls/server.key
#   export SSL_CERT_FILE=$PWD/runtime/tls/ca.crt   # for every frost-client call
source "$(dirname "${BASH_SOURCE[0]}")/00_env.sh"

TLS="$RIME_RUNTIME/tls"
mkdir -p "$TLS"

if [ -f "$TLS/server.crt" ]; then
  echo "==> certs already exist in $TLS"
  exit 0
fi

echo "==> generating local CA"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout "$TLS/ca.key" -out "$TLS/ca.crt" \
  -days 90 -nodes -subj "/CN=Rime local dev CA" 2>/dev/null

echo "==> generating frostd server cert (127.0.0.1 / localhost)"
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout "$TLS/server.key" -out "$TLS/server.csr" \
  -nodes -subj "/CN=localhost" 2>/dev/null
openssl x509 -req -in "$TLS/server.csr" \
  -CA "$TLS/ca.crt" -CAkey "$TLS/ca.key" -CAcreateserial \
  -out "$TLS/server.crt" -days 90 \
  -extfile <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1") 2>/dev/null

rm -f "$TLS/server.csr" "$TLS/ca.srl"
echo "==> done. Start frostd with:"
echo "    frostd -i 127.0.0.1 -p 2744 -c $TLS/server.crt -k $TLS/server.key"
echo "==> and export for frost-client:"
echo "    export SSL_CERT_FILE=$TLS/ca.crt"
