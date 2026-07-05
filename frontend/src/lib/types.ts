// Mirror of the rime-server JSON contract.

export type RequestStatus =
  | "pending"
  | "quorum"
  | "signing"
  | "broadcast"
  | "failed"
  | "rejected";

export type SignerStatus = "active" | "lost";

export interface Treasury {
  network: "main" | "test";
  address: string;
  threshold: number;
  signers: string[];
  configured?: false;
}

export interface PaymentRequest {
  id: number;
  recipient: string;
  amount_zat: number;
  reason: string;
  status: RequestStatus;
  txid: string | null;
  approvals: number;
  created_at: string;
}

export interface Signer {
  id: number;
  name: string;
  status: SignerStatus;
}

export interface AuditRow {
  event: string;
  detail: string;
  at: string;
}

export interface Balance {
  total_zat: number;
  orchard_zat: number;
  height: number | null;
}

// SSE payloads. request_id === 0 marks a treasury-level event (recovery).
export interface RimeEvent {
  request_id: number;
  step: string;
  detail: string;
}

export const SIGNER_TOKENS: Record<string, string> = {
  alice: "dev-token-alice",
  bob: "dev-token-bob",
  carol: "dev-token-carol",
};
