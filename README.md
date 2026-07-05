# Rime

**Frost-sealed treasury for teams.** Two signatures move the money. One never can.

Rime is a shielded treasury for Zcash built on [FROST](https://frost.zfnd.org/) threshold
signatures: a 2-of-3 signing group controls the funds, payments go through a
request → approve → sign workflow, and a lost signer can be repaired by the
remaining two — without the full key ever existing, anywhere.

> 🧊 Building in public for [ZecHub Hackathon 3.0](https://zechub.wiki/hackathon)
> (FROST track) — May 25 → July 15, 2026. Follow along; everything lands here.

## Why

Most community and company treasuries on Zcash sit behind **one person's wallet**.
One key. One laptop. One bus. The Zcash Community Grants wishlist has asked for
*"easy multi-sig tools for Shielded Addresses (e.g. an implementation of FROST in
user-facing wallets)"* — Rime is that, for teams:

- **2-of-3 threshold custody** — no single point of failure, no single point of theft.
- **Payment workflow** — requests with reasons, approvals from any two signers,
  automatic signing ceremony and broadcast.
- **Signer recovery** — a lost device is repaired by the remaining signers using
  FROST's Repairable Threshold Scheme. The treasury never moves.
- **Shielded end to end** — on-chain, a Rime transaction is indistinguishable from
  any single-signer shielded payment. The approval reason travels in the encrypted
  memo: auditable by the team, invisible to the world.

## How it works

```
┌────────────┐   requests/approvals   ┌─────────────┐
│  Web UI    │ ─────────────────────▶ │ rime-server │──── watch-only wallet
│ (3 signer  │        REST/SSE        │ (workflow   │     (UFVK, zcash-devtool,
│  views)    │ ◀───────────────────── │  engine)    │      lightwalletd)
└────────────┘                        └──────┬──────┘
                                             │ orchestrates (subprocess)
                              ┌──────────────┼───────────────┐
                              ▼              ▼               ▼
                        frost-client      frostd        zcash-sign
                        (ceremony)      (transport)    (SIGHASH/apply)
                              ▲
                    rime-signer × 3 (each holds ONLY its own share;
                    joins a ceremony only after its human approves)
```

Built entirely on the Zcash Foundation's audited FROST stack — `frost-core`,
`frostd`, `frost-client`, `zcash-sign` — plus `zcash-devtool` PCZTs. Rime adds the
treasury workflow layer; it re-implements no cryptography.

Prior art we build on gratefully: [Zkool](https://github.com/hhanh00/zkool2)
pioneered FROST multisig accounts in a Zcash wallet; the
[ZF FROST tooling](https://github.com/ZcashFoundation/frost-tools) makes threshold
signing on Zcash real. Rime's contribution is the team workflow: requests,
approvals, recovery, and a UI humans can use.

## Status

- [x] Day 1 — repo, scaffold, toolchain, 2-of-3 `redpallas` keygen spike
- [ ] First FROST-signed mainnet transaction (CLI, end to end)
- [ ] Workflow engine (requests → quorum → ceremony → broadcast)
- [ ] Web UI (dashboard, signer views, live ceremony)
- [ ] Signer repair + share refresh
- [ ] Demo video + submission

## Security model (prototype — read this)

Rime is a hackathon prototype on demo-grade upstream tooling. Known constraints,
by design and documented rather than papered over:

- The FROST account is **Orchard-only**. Rime only ever displays the Orchard
  receiver — funds sent to a Sapling receiver of the underlying unified address
  would be unspendable.
- Per ZIP 312's threat model, the ceremony **coordinator learns transaction
  details**. In Rime the coordinator is the treasury operator, who is also
  Signer #1 — a trusted role, stated openly.
- The ZF FROST core crates are audited (NCC Group); the rerandomized variant and
  the helper tools have a narrower audit trail (Least Authority audited
  `frostd`/`frost-client`). Do not hold funds you cannot afford to lose.

## License

MIT
