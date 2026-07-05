# Rime — Threat Model & Known Limitations

Rime is a hackathon prototype built on the Zcash Foundation's demo-grade FROST
tooling. It is honest about what it is. This document is the source for the
submission's security section; stating these plainly is a feature, not an
apology.

## Trust model

- **Coordinator = Signer #1 (the treasury operator).** Per ZIP 312's threat
  model the ceremony coordinator learns transaction details and could harm
  privacy (not funds). Rime makes the operator an explicit, named trusted role
  rather than pretending the coordinator is trustless.
- **Prototype key custody: shares live server-side.** In this build the FROST
  participants and their key shares run on one machine in per-signer
  directories. The phones/iPad in the demo are the *human approval surface* —
  the tap gates the cryptographic participant. Production packaging moves each
  daemon + share onto its owner's device; the workflow layer above is unchanged.
  This is the single biggest gap between prototype and product, and it is
  stated wherever the architecture is described.

## Accepted risks (inherent to the prototype)

- **Recovery writes a fresh cleartext share to the server filesystem.** The
  Repairable Threshold Scheme reconstructs the lost signer's share, which is
  then written back to their config. Because shares already live server-side
  (above), this exposes no capability the operator lacks. All share files are
  written `0600` and atomically. In production the repaired share would be
  delivered to the new device, never persisted centrally.
- **Recovery is authorized by a single active signer.** `mark-lost` and
  `repair` require a valid, non-lost signer token, refuse to drop the group
  below the signing threshold, refuse self-repair, and record the acting signer
  in the audit log. A production system would gate recovery behind a quorum
  approval of its own (a second signer confirming the repair), the same way
  payments are gated. Noted as future work, not shipped.

## What Rime does defend

- Single-fire quorum: the pending→quorum transition is atomic, so a late or
  concurrent approval can never launch a duplicate signing ceremony.
- Read surface (requests, audit, treasury, live events) requires a signer
  token. SSE uses single-use, short-lived tickets so tokens never appear in
  URLs, logs, or history.
- Orchard-only addresses: the UI and scripts only ever emit the Orchard
  receiver, so no one can brick funds by sending to an unspendable Sapling
  receiver of the same unified address.
- Signer tokens sync from config on boot, so rotating or removing a signer
  takes effect immediately.

## Cryptography

Rime writes no cryptography of its own. It uses the audited ZF stack as-is:
`frost-core` (NCC Group audited), `frostd`/`frost-client` (Least Authority
audited), `reddsa` for the RedPallas (Orchard) ciphersuite, and
`zcash-devtool` PCZTs. The rerandomized variant's audit coverage is narrower
than the core; treat balances accordingly.
