# Rime — Setup & Operator Guide

Two ways to bring up the treasury: **local** (native binaries, best for hacking)
or **Docker** (one compose file, best for a clean demo). Both end the same way:
frostd on `:2744`, rime-server + web UI on `:8787`.

> ⏱️ **Heads-up: the first build is heavy.** Rime compiles the Zcash Foundation's
> FROST tooling (`frost-client`, `frostd`, `zcash-sign`) and `zcash-devtool` from
> source, plus the Rime Rust workspace and a Next.js export. Cold, that's tens of
> minutes and several GB. It's a one-time cost; subsequent builds are cached.

> 🔐 **`runtime/` is secret.** It holds cleartext FROST key shares, the watch-only
> wallet, the TLS keys, and the SQLite DB. It is gitignored and is **never** baked
> into a Docker image — it's always a mount. Treat it exactly like a private key.

---

## Prerequisites

**Local path:** a recent Rust toolchain (`rustup`), Node 22 + `pnpm` 10, and the
native build deps for the zcash/frost crates: a C/C++ toolchain, `cmake`,
`clang`, `protobuf-compiler`, `pkg-config`, `openssl`. On macOS:

```bash
brew install rust node pnpm cmake protobuf pkg-config openssl
```

**Docker path:** Docker with Compose v2 (`docker compose version`). Nothing else.

---

## Option A — Local (no Docker)

```bash
make tools      # cargo install the ZF tools + build the workspace (LONG, one-time)
make keygen     # TLS certs + 2-of-3 keygen + treasury address + watch-only wallet
make config     # create runtime/rime-server.toml from the example
#   → edit runtime/rime-server.toml (see "The server config" below)
make frostd     # terminal 1: the FROST coordination server (leave it running)
make demo       # terminal 2: build the UI + serve it on the LAN (0.0.0.0:8787)
```

`make server` is the loopback-only variant (`127.0.0.1:8787`) if you don't need
other devices. Run `make help` to list every target.

---

## Option B — Docker

```bash
make docker-init   # one-shot: TLS + keygen + address + wallet (writes ./runtime)
make config        # create runtime/rime-server.toml from the example
#   → edit runtime/rime-server.toml (see "The server config" below)
make up            # build on first run, then start frostd + rime-server
make logs          # follow the logs;  open http://localhost:8787
make down          # stop (your ./runtime and its keys persist)
```

Configuration is read from your shell or an optional `.env` file next to
`docker-compose.yml`:

```dotenv
RIME_NET=test                 # test | main  (default: test)
RIME_BIND=0.0.0.0:8787        # LAN demo; use 127.0.0.1:8787 for loopback only
RIME_DISCORD_WEBHOOK=https://discord.com/api/webhooks/...   # optional
```

**Why the two services share a network:** frostd's TLS cert is issued for
`localhost`/`127.0.0.1` only, and the config points at `localhost:2744`. So
rime-server joins frostd's network namespace (`network_mode: "service:frostd"`),
where frostd genuinely *is* `localhost:2744` and the cert validates — no cert
regeneration, no source changes. Because of that shared stack, port `8787` is
published on the **frostd** service in `docker-compose.yml`.

---

## The server config (`runtime/rime-server.toml`)

`make config` copies `rime-server/config.example.toml` to
`runtime/rime-server.toml`. Fill it from the values `make keygen` / `docker-init`
printed at the end of bring-up:

- `network` — `"test"` or `"main"` (match `RIME_NET`).
- `group` — the group public key (the 64-hex `ak`) from
  `frost-client groups -c runtime/alice.toml`.
- `treasury_address` — the **Orchard-only** address from
  `runtime/treasury_keys.<net>.txt`. (Only ever show this receiver — funds sent to
  a Sapling receiver of the same unified address would be unspendable.)
- each signer `pubkey` — the signer's frost-client *communication* key.
- each signer `token` — replace every `CHANGE-ME` with a strong per-signer secret;
  it's the bearer token for that signer's UI. Tokens re-sync from this file on
  every boot, so rotating one takes effect immediately.

Without this file, rime-server still runs — but in **workflow-only** mode: it
records requests and approvals but cannot run a signing ceremony.

---

## Funding the treasury

Send only to the **Orchard** treasury address printed at bring-up.

**Testnet (`RIME_NET=test`) — free TAZ:**
- A testnet faucet is the quickest path — paste the treasury address.
- Or mine directly into the treasury with `scripts/70_mine_testnet.sh` (Zebra's
  experimental internal miner; testnet accepts minimum-difficulty blocks, so a
  CPU can win them). This needs a `runtime/zebrad.toml` and ~10 GB of disk, and
  coinbase spends unlock after 100 confirmations (~2 h). Good for a fully
  self-contained demo with no external faucet.

**Mainnet (`RIME_NET=main`) — real ZEC:** send a **tiny** amount (e.g. 0.001 ZEC)
from any wallet to the treasury address. Rime is a hackathon prototype on
demo-grade tooling (see `THREAT_MODEL.md`) — do not hold funds you can't lose.

After funding, watch the balance land:

```bash
zcash-devtool wallet -w runtime/wallet-<net> sync
zcash-devtool wallet -w runtime/wallet-<net> balance
```

---

## The multi-device demo

The phones/iPad are the **human approval surface** — each tap gates the signer's
participation in the ceremony (the shares still live server-side in this
prototype; see `THREAT_MODEL.md`).

1. Bind to the LAN: `make demo` (local) or `RIME_BIND=0.0.0.0:8787 make up` (Docker).
2. Find your Mac's LAN IP: `ipconfig getifaddr en0` (or `en1` on Wi-Fi).
3. On each device (same Wi-Fi), open a dedicated signer view:
   - `http://<mac-lan-ip>:8787/?signer=alice`
   - `http://<mac-lan-ip>:8787/?signer=bob`
   - `http://<mac-lan-ip>:8787/?signer=carol`
4. Create a payment request, approve it from any two devices → quorum fires the
   FROST ceremony automatically → the transaction broadcasts. If a
   `RIME_DISCORD_WEBHOOK` is set, quorum/broadcast/recovery ping your channel.

To demo **recovery**, mark a signer lost and repair it from another signer's
view; the remaining two rebuild the share and the treasury address is unchanged.

---

## Troubleshooting

- **UI loads but says "workflow-only" / no treasury** → `runtime/rime-server.toml`
  is missing or unreadable; run `make config` and fill it in.
- **Ceremony fails at connect** → frostd isn't running, or `SSL_CERT_FILE`
  doesn't point at `runtime/tls/ca.crt`. Locally, keep `make frostd` up.
- **Phones can't reach the UI** → you're bound to loopback; use `RIME_BIND=0.0.0.0:8787`
  and confirm both devices are on the same network (and the Mac firewall allows it).
- **First `docker compose up` looks stuck** → it's the heavy first build. Watch
  `docker compose logs -f` or build ahead of time with `docker compose build`.
