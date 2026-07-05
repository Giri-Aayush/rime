# Rime

**Frost-sealed treasury for teams. Two signatures move the money; one never can.**

Rime is a shielded treasury for Zcash built on [FROST](https://frost.zfnd.org/)
threshold signatures. A 2-of-3 signing group controls the funds. Payments go
through a request → approve → sign workflow, and a lost signer can be rebuilt by
the remaining two — without the full key ever existing, anywhere.

> 🧊 Built for [ZecHub Hackathon 3.0](https://zechub.wiki/hackathon) — FROST track.

---

## The problem

Most community and company treasuries on Zcash sit behind **one person's key** —
one laptop, one seed phrase, one point of failure and one point of theft. The
Zcash Community Grants wishlist names the gap directly, asking for *"easy
multi-sig tools for Shielded Addresses (e.g. an implementation of FROST in
user-facing wallets)."*

The demand is real and repeated: three adjacent proposals — a TSSK SDK, a
FROST-UI grant, and the Laminar treasury console — each sought funding to build
some version of this and stalled before shipping. The ecosystem keeps asking for
threshold custody it can actually use. Rime is a working demo of it.

---

## What it does

- **2-of-3 threshold custody of shielded ZEC.** The treasury is an Orchard
  (shielded) account. Any two of three signers can authorize a payment; no
  single signer can move a cent, and there is no complete private key to steal.
- **A payment workflow, not a raw CLI.** Someone files a payment request with a
  reason. Two signers approve from their own devices. The second approval
  automatically launches the signing ceremony and broadcasts the result — no one
  copies a hex blob between terminals.
- **Signer recovery without a rebuild.** Lose a device and the remaining signers
  regenerate its share using FROST's Repairable Threshold Scheme, then rotate
  every share so the lost one becomes a dead key. The full key never exists at
  any step, and the treasury address never changes.
- **Shielded end to end.** On-chain, a Rime spend is indistinguishable from any
  ordinary single-signer shielded payment — the threshold nature is invisible.
  The approval reason rides in the transaction's encrypted memo: auditable by
  the team, invisible to the world.

---

## Architecture

```
          ┌──────────────────────────────────────────────────┐
          │  Next.js UI  (static export, served by rime-server)│
          │  • desktop treasury dashboard                      │
          │  • ?signer=alice|bob|carol → per-device approval   │
          └───────────────────────┬──────────────────────────┘
                                  │  REST + SSE  (token-gated)
                                  ▼
          ┌──────────────────────────────────────────────────┐
          │  rime-server  (axum workflow engine)               │
          │  request → approvals → quorum → ceremony → broadcast│
          │  audit log · single-use SSE tickets · Discord pings│
          └───────┬───────────────────────────────┬───────────┘
                  │ orchestrates (subprocess)      │ watch-only wallet
                  ▼                                ▼
    ┌──────────────────────────────┐   ┌───────────────────────────┐
    │  FROST signing ceremony       │   │  zcash-devtool + UFVK      │
    │  frost-client coordinator     │   │  PCZT create/prove/combine │
    │    + 2 participants           │   │  /send, via lightwalletd   │
    │  through frostd (TLS)         │   └───────────────────────────┘
    │  zcash-sign: SIGHASH / apply  │
    └──────────────────────────────┘

    rime-repair  →  RTS repair + share refresh (run on demand)
    rime-signer  →  a signer's approval agent (watch / approve / reject);
                    the server still holds shares + drives the ceremony
```

**Four crates / processes:**

- **`rime-server`** — the workflow engine (axum). Owns the request → approval →
  quorum → ceremony → broadcast state machine, the audit log, and a Server-Sent
  Events stream for live progress. Serves the built UI from the same process.
  Its endpoints cover the treasury view, payment requests and decisions, the
  audit log, signer status, and the `mark-lost` / `repair` recovery actions.
- **The Next.js / shadcn frontend** — a static export (no Node runtime in the
  demo; `rime-server` serves the files). The desktop dashboard is the operator's
  view; `?signer=alice|bob|carol` switches to a full-screen device mode meant for
  real phones on the same network, which is where the two approvals actually
  happen.
- **`rime-repair`** — the recovery tool. Implements the two operations
  `frost-client` has no command for: **repair** (remaining signers regenerate a
  lost share via the Repairable Threshold Scheme, eprint 2017/1155) and
  **refresh** (all signers rotate their shares in place; the group key and
  address are unchanged, and any old share becomes dead).
- **`rime-signer`** — a signer's own approval agent: run on your machine, it
  watches the treasury for payments awaiting you and lets you `approve` /
  `reject` from where you are (the phone's role in the demo, as a CLI). It hits
  only the public API. **In this prototype the key share and the participant
  flow still live on the server** (see Security model); production packaging
  moves both into this daemon, so the approval you give here becomes what
  unlocks your own signing. This share-on-device step is the largest gap between
  prototype and product, and it is stated wherever the architecture is described.

**Rime writes no cryptography of its own.** It composes the audited Zcash
Foundation stack: `frost-core` (NCC Group audited) for the threshold scheme,
`frostd` + `frost-client` (Least Authority audited) for the signing transport
and ceremony, `reddsa` RedPallas for the Orchard ciphersuite, and
`zcash-devtool` PCZTs, per [ZIP-312](https://zips.z.cash/zip-0312). Credit to
[Zkool](https://github.com/hhanh00/zkool2) (hanh), which pioneered FROST
multisig accounts on Zcash. Rime's contribution is the layer above the
cryptography: the team **workflow** — requests, approvals, recovery, and a UI
humans can use.

---

## Try it

### Prerequisites

- **Rust** (stable) and **Node + pnpm** for the frontend.
- **Zcash Foundation FROST tools** and **zcash-devtool**:

  ```bash
  # frostd, frost-client, zcash-sign
  cargo install --git https://github.com/ZcashFoundation/frost-tools --locked \
    frost-client zcash-sign frostd

  # zcash-devtool (PCZT create/prove/combine/send + watch-only wallet)
  cargo install --git https://github.com/zcash/zcash-devtool --locked
  ```

### Reproduction flow

The `scripts/` directory is the reproduction flow — each script wraps one ZF
tool step and sources shared config from `scripts/00_env.sh`. Choose the network
with `RIME_NET` (`main` or `test`).

```bash
# 1. TLS certs for frostd (local CA, no sudo / mkcert needed), then start frostd:
./scripts/05_frostd_tls.sh
frostd -i 127.0.0.1 -p 2744 -c runtime/tls/server.crt -k runtime/tls/server.key
export SSL_CERT_FILE=$PWD/runtime/tls/ca.crt   # so frost-client trusts it

# 2. Trusted-dealer 2-of-3 keygen on the redpallas (Orchard) ciphersuite:
./scripts/10_keygen.sh

# 3. Derive the treasury's Orchard-only address + UFVK from the group's ak
#    (copy the ak from: frost-client groups -c runtime/alice.toml):
./scripts/20_address.sh <ak-hex>

# 4. Initialize + sync the watch-only wallet from the UFVK:
./scripts/30_wallet_init.sh <UFVK> [birthday-height]

# 5. Build the frontend (static export):
cd frontend && pnpm install && pnpm exec next build && cd ..
#    If pnpm blocks build scripts, that's harmless — sharp isn't needed
#    (images are unoptimized in the static export).

# 6. Copy the config, fill in your group key / addresses / signer tokens:
cp rime-server/config.example.toml runtime/rime-server.toml

# 7. Run the server. Bind to 0.0.0.0 so phones on the same wifi can reach
#    their signer views for the multi-device demo:
RIME_BIND=0.0.0.0:8787 cargo run -p rime-server
```

Open `http://<host>:8787` for the dashboard, and `?signer=alice` (or `bob`,
`carol`) on each phone for the device views.

**Optional:**

- **`RIME_DISCORD_WEBHOOK`** — set it (or `discord_webhook` in the config) and
  the team's Discord channel gets pinged when a payment reaches quorum, a
  broadcast lands, or a signer is recovered.
- **Testnet self-funding** — on `RIME_NET=test`, `./scripts/70_mine_testnet.sh`
  mines TAZ straight into the treasury's Orchard address using Zebra's
  experimental internal miner (testnet accepts minimum-difficulty blocks, so a
  CPU can win them; coinbase unlocks after 100 confirmations).

---

## Security model

Rime is a hackathon prototype on demo-grade upstream tooling. It states its
constraints plainly rather than papering over them — the full write-up is in
[THREAT_MODEL.md](./THREAT_MODEL.md). Highlights:

- **Coordinator = Signer #1 (the treasury operator).** Per ZIP-312's threat
  model, the ceremony coordinator learns transaction details (a privacy
  consideration, not a funds one). Rime makes the operator an explicit, named
  trusted role rather than pretending the coordinator is trustless.
- **Shares live server-side in this prototype.** The FROST participants and
  their key shares run on one machine in per-signer directories; the phones are
  the *human approval surface* — the tap gates the cryptographic participant.
  Production packaging moves each daemon and share onto its owner's device
  (`rime-signer`); the workflow layer above is unchanged.
- **Orchard-only, with a guard.** The UI and scripts only ever emit the Orchard
  receiver of the unified address, so no one can brick funds by sending to an
  unspendable Sapling receiver.
- **Single-fire quorum.** The pending → quorum transition is atomic under one DB
  lock, so a late or concurrent approval can never launch a duplicate ceremony.
- **Token-gated reads.** Requests, audit, treasury, and the live event stream all
  require a signer token. Tokens sync from config on every boot, so rotating or
  removing a signer takes effect immediately.
- **Single-use SSE tickets.** The event stream uses short-lived, single-use
  tickets so signer tokens never appear in URLs, logs, or browser history.
- **Careful share writes.** All share files are written `0600` and atomically.

Treat this as prototype-grade. Do not hold funds you cannot afford to lose.

---

## Status / roadmap

**Works today**

- [x] 2-of-3 `redpallas` (Orchard) trusted-dealer keygen
- [x] FROST signing ceremony proven end to end (produces a valid aggregate
      RedPallas signature)
- [x] Workflow server: requests → quorum → ceremony → broadcast, with audit log
- [x] Signer recovery: RTS repair + share refresh (`rime-repair`)
- [x] Web UI: desktop dashboard + per-device signer views, live over SSE
- [x] Discord notifications for quorum / broadcast / recovery

**Next**

- [ ] First FROST-signed **mainnet** broadcast, end to end
- [ ] On-device key shares via the `rime-signer` daemon (off the server)
- [ ] Quorum-gated recovery (a second signer confirms a repair, like payments)

---

## License

MIT
