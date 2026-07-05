// Rime — shared constants, label maps and pure helpers.
// Ported from the reference web/app.js so behavior stays byte-faithful.

import { SIGNER_TOKENS } from "@/lib/types";
import type { PaymentRequest, Treasury } from "@/lib/types";

export interface SignerConfig {
  id: number;
  name: string;
  token: string;
  /** avatar hue key */
  hue: "a" | "b" | "c";
}

export const SIGNERS: SignerConfig[] = [
  { id: 1, name: "Alice", token: SIGNER_TOKENS.alice, hue: "a" },
  { id: 2, name: "Bob", token: SIGNER_TOKENS.bob, hue: "b" },
  { id: 3, name: "Carol", token: SIGNER_TOKENS.carol, hue: "c" },
];

/** ?signer=alice|bob|carol → signer index (else null = desktop dashboard). */
export const SIGNER_SLUGS: Record<string, number> = { alice: 0, bob: 1, carol: 2 };

/** Ceremony pipeline, in protocol order (post-quorum steps). */
export const CEREMONY_ORDER = [
  "pczt.create",
  "sighash.extract",
  "sighash.ready",
  "ceremony.start",
  "ceremony.join",
  "ceremony.signed",
  "pczt.signed",
  "pczt.prove",
  "pczt.combine",
  "broadcast",
  "confirmed",
] as const;

/** Human labels for SSE steps (long form, for detail lines). */
export const STEP_LABELS: Record<string, string> = {
  created: "Request created",
  decision: "Signer decision recorded",
  "pczt.create": "Building transaction",
  "sighash.extract": "Extracting SIGHASH",
  "sighash.ready": "SIGHASH extracted",
  "ceremony.start": "Signing ceremony started (2 of 3)",
  "ceremony.join": "Signer joined the ceremony",
  "ceremony.signed": "Threshold signature complete",
  "pczt.signed": "Signatures applied to transaction",
  "pczt.prove": "Generating zero-knowledge proofs",
  "pczt.combine": "Assembling final transaction",
  broadcast: "Broadcast to network",
  confirmed: "Confirmed on chain",
  failed: "Ceremony failed",
  // signer recovery ("lake scene")
  "recovery.lost": "Device share marked lost",
  "recovery.repair": "Remaining signers rebuilding the share",
  "recovery.refresh": "Rotating all shares — old share is now a dead key",
  "recovery.done": "Signer restored · treasury address unchanged",
  "recovery.failed": "Recovery failed",
};

/** Short labels for the pipeline strip nodes. */
export const STEP_SHORT: Record<string, string> = {
  "pczt.create": "Build tx",
  "sighash.extract": "Extract",
  "sighash.ready": "SIGHASH",
  "ceremony.start": "Ceremony",
  "ceremony.join": "Join",
  "ceremony.signed": "Threshold sig",
  "pczt.signed": "Apply sigs",
  "pczt.prove": "ZK proofs",
  "pczt.combine": "Combine",
  broadcast: "Broadcast",
  confirmed: "Confirmed",
};

/** Recovery pipeline (post-"lost" repair sequence), in order. */
export const RECOVERY_ORDER = [
  "recovery.repair",
  "recovery.refresh",
  "recovery.done",
] as const;

export const RECOVERY_SHORT: Record<string, string> = {
  "recovery.repair": "Rebuild",
  "recovery.refresh": "Rotate keys",
  "recovery.done": "Restored",
};

export const stepLabel = (s: string): string => STEP_LABELS[s] ?? s;

/* ─── network helpers ─────────────────────────────────────────────── */

export const unitFor = (network?: string): string =>
  network === "main" ? "ZEC" : "TAZ";

export const explorerBase = (network?: string): string =>
  network === "main"
    ? "https://mainnet.zcashexplorer.app/transactions/"
    : "https://testnet.zcashexplorer.app/transactions/";

/* ─── formatting ──────────────────────────────────────────────────── */

export function truncMid(s: string, head = 12, tail = 8): string {
  const str = String(s ?? "");
  return str.length <= head + tail + 1
    ? str
    : `${str.slice(0, head)}…${str.slice(-tail)}`;
}

/** "0.25" → 25000000n zatoshis; null when invalid. Avoids bigint literals
 *  (tsconfig targets ES2017) by going through the BigInt() constructor. */
export function toZatoshis(input: string): bigint | null {
  const s = String(input).trim();
  if (!/^\d+(\.\d{0,8})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return (
    BigInt(whole) * BigInt(100_000_000) +
    BigInt((frac + "00000000").slice(0, 8))
  );
}

/** zatoshis → decimal coin string with trailing zeros trimmed. */
export function fmtZat(zat: number | null | undefined): string {
  const n = Number(zat ?? 0);
  if (!Number.isFinite(n)) return "—";
  return (n / 1e8)
    .toFixed(8)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

export function parseWhen(v: string | number | null | undefined): Date | null {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function timeAgo(v: string | number | null | undefined): string {
  const d = parseWhen(v);
  if (!d) return "";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}

export function clock(v: string | number | null | undefined): string {
  const d = parseWhen(v);
  return d ? d.toLocaleTimeString([], { hour12: false }) : "";
}

/* ─── request ordering ────────────────────────────────────────────── */

export function sortRequests(list: PaymentRequest[]): PaymentRequest[] {
  return [...list].sort((a, b) => {
    const ta = parseWhen(a.created_at)?.getTime() ?? 0;
    const tb = parseWhen(b.created_at)?.getTime() ?? 0;
    return tb - ta || (b.id ?? 0) - (a.id ?? 0);
  });
}

/** Display name for signer index i — server names win, config is the fallback. */
export function displayName(treasury: Treasury | null, i: number): string {
  const fromServer = treasury?.signers?.[i];
  return fromServer || SIGNERS[i]?.name || `Signer ${i + 1}`;
}
