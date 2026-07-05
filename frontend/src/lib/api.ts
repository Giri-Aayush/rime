import type {
  AuditRow,
  Balance,
  PaymentRequest,
  RimeEvent,
  Signer,
  Treasury,
} from "./types";

// Same-origin in the demo (Rust server serves this export). In `next dev`,
// point at the Rust server with NEXT_PUBLIC_RIME_API=http://localhost:8787.
const BASE = process.env.NEXT_PUBLIC_RIME_API ?? "";

async function req<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // Server sends plain-text bodies for 4xx (e.g. the mark-lost 409).
    const body = await res.text().catch(() => "");
    throw new Error(body || `${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// Unauthenticated create/decide carry the signer token in the body instead.
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const api = {
  treasury: (token: string) => req<Treasury>("/api/treasury", token),
  balance: (token: string) => req<Balance>("/api/balance", token),
  requests: (token: string) => req<PaymentRequest[]>("/api/requests", token),
  signers: (token: string) => req<Signer[]>("/api/signers", token),
  audit: (token: string) => req<AuditRow[]>("/api/audit", token),

  createRequest: (b: {
    recipient: string;
    amount_zat: number;
    reason: string;
    signer_token: string;
  }) => post<{ id: number; status: string }>("/api/requests", b),

  decide: (id: number, signer_token: string, decision: "approve" | "reject") =>
    post<{ id: number; approvals: number; status: string }>(
      `/api/requests/${id}/decide`,
      { signer_token, decision },
    ),

  markLost: (id: number, signer_token: string) =>
    post<{ id: number; status: string }>(`/api/signers/${id}/mark-lost`, {
      signer_token,
    }),

  repair: (id: number, signer_token: string) =>
    post<{ id: number; status: string }>(`/api/signers/${id}/repair`, {
      signer_token,
    }),
};

/**
 * Subscribe to the server's live event stream. EventSource can't send an
 * Authorization header, so we first POST /api/sse-ticket with the bearer
 * token to get a single-use, 60-second ticket, then connect with it. On any
 * drop we re-ticket with backoff. Returns an unsubscribe function.
 */
export function subscribeEvents(
  token: string,
  onEvent: (e: RimeEvent) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let backoff = 500;

  async function connect() {
    if (closed) return;
    try {
      // sse-ticket authenticates with the bearer header (not a body).
      const { ticket } = await req<{ ticket: string }>("/api/sse-ticket", token, {
        method: "POST",
      });
      if (closed) return;
      es = new EventSource(`${BASE}/api/events?ticket=${encodeURIComponent(ticket)}`);
      es.onopen = () => {
        backoff = 500;
        onStatus?.(true);
      };
      es.onmessage = (ev) => {
        try {
          onEvent(JSON.parse(ev.data) as RimeEvent);
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        onStatus?.(false);
        es?.close();
        es = null;
        if (!closed) {
          setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 8000);
        }
      };
    } catch {
      if (!closed) {
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 8000);
      }
    }
  }

  connect();
  return () => {
    closed = true;
    es?.close();
  };
}
