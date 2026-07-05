"use client";

// The single source of truth for the Rime UI. Owns polling (4s), the SSE
// overlay, per-signer session decisions, the in-flight ceremony, and the
// recovery ("lake scene") lifecycle.
//
// A mutable `engineRef` mirrors the reference app.js `state` — event handlers
// and SSE frames read-modify-write it. After every change we `commit()` a
// shallow copy into React state (`snapshot`), and *all* render-time reads go
// through the snapshot. That keeps the imperative logic faithful while never
// reading a ref during render.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { api, subscribeEvents } from "@/lib/api";
import type {
  AuditRow,
  PaymentRequest,
  RimeEvent,
  Signer,
  Treasury,
} from "@/lib/types";
import {
  CEREMONY_ORDER,
  RECOVERY_ORDER,
  SIGNERS,
  displayName,
  explorerBase,
  sortRequests,
  toZatoshis,
  unitFor,
} from "@/lib/rime";

type Conn = "connecting" | "live" | "offline";
type Decision = "approve" | "reject";
type Status = "active" | "lost" | "repairing";

interface Ceremony {
  reached: number;
  latest: RimeEvent | null;
  failed: string | null;
  sawSteps: Set<string>;
}

interface Recovery {
  signerId: number | null;
  reached: number;
  step: string | null;
  failed: string | null;
  done: boolean;
  reviveUntil: number;
}

interface Engine {
  treasury: Treasury | null;
  requests: PaymentRequest[];
  audit: AuditRow[];
  signers: Signer[];
  ceremonies: Record<number, Ceremony>;
  decisions: Record<number, Record<number, Decision>>;
  activeCeremonyId: number | null;
  sse: Conn;
  recovery: Recovery | null;
}

function initialEngine(): Engine {
  return {
    treasury: null,
    requests: [],
    audit: [],
    signers: [],
    ceremonies: {},
    decisions: { 1: {}, 2: {}, 3: {} },
    activeCeremonyId: null,
    sse: "connecting",
    recovery: null,
  };
}

/* ─── pure selectors over an Engine snapshot ──────────────────────── */

function rawStatusOf(eng: Engine, id: number): Status {
  const s = eng.signers.find((x) => x.id === id);
  return (s?.status as Status) ?? "active";
}

function isRepairingOf(eng: Engine, id: number): boolean {
  const r = eng.recovery;
  return rawStatusOf(eng, id) === "repairing" || !!(r && r.signerId === id && !r.done);
}

function isRevivingOf(eng: Engine, id: number): boolean {
  const r = eng.recovery;
  return !!(r && r.signerId === id && r.done && Date.now() < r.reviveUntil);
}

function statusOf(eng: Engine, id: number): Status {
  if (isRevivingOf(eng, id)) return "active";
  if (isRepairingOf(eng, id)) return "repairing";
  return rawStatusOf(eng, id);
}

function phoneQueueOf(eng: Engine, signerId: number): PhoneQueue {
  const mine = eng.decisions[signerId] ?? {};
  const reqs = sortRequests(eng.requests);
  return {
    open: reqs.filter((r) => r.status === "pending" && !mine[r.id]),
    others: reqs.filter((r) => ["quorum", "signing"].includes(r.status) && !mine[r.id]),
    decided: reqs.filter((r) => mine[r.id]).slice(0, 4),
  };
}

/* ─── public shapes ───────────────────────────────────────────────── */

export interface PhoneQueue {
  open: PaymentRequest[];
  others: PaymentRequest[];
  decided: PaymentRequest[];
}

export interface ActiveCeremony {
  id: number;
  req: PaymentRequest | null;
  reached: number;
  failed: string | null;
  finished: boolean;
  latest: RimeEvent | null;
}

export interface RimeState {
  me: number | null;
  treasury: Treasury | null;
  requests: PaymentRequest[];
  audit: AuditRow[];
  sse: Conn;
  recovery: Recovery | null;
  threshold: number;
  network: string | undefined;
  unit: string;
  explorer: string;
  signerName: (i: number) => string;
  signerStatus: (id: number) => Status;
  phoneQueue: (signerId: number) => PhoneQueue;
  pendingCount: (signerId: number) => number;
  myDecision: (signerId: number, reqId: number) => Decision | undefined;
  isRepairing: (id: number) => boolean;
  isReviving: (id: number) => boolean;
  recoveryFor: (
    signerId: number,
  ) => { reached: number; step: string | null; failed: string | null; done: boolean } | null;
  activeCeremony: ActiveCeremony | null;
  failureDetail: (reqId: number) => string | null;
  decide: (signerId: number, reqId: number, decision: Decision) => void;
  markLost: (signerId: number) => void;
  repair: (signerId: number) => void;
  createRequest: (input: {
    recipient: string;
    amount: string;
    reason: string;
  }) => Promise<boolean>;
}

const BROADCAST_IDX = CEREMONY_ORDER.indexOf("broadcast");

export function useRimeState(me: number | null): RimeState {
  const engineRef = useRef<Engine>(initialEngine());
  const [snapshot, setSnapshot] = useState<Engine>(() => initialEngine());
  const refreshQueued = useRef(false);

  // Publish the mutable engine into render state. Nested objects are shared,
  // but a fresh top-level object guarantees the re-render.
  const commit = useCallback(() => {
    setSnapshot({ ...engineRef.current });
  }, []);

  // Read/SSE token: this device's signer in device mode, else Alice's.
  const readToken = me != null ? SIGNERS[me].token : SIGNERS[0].token;

  const setLocalSignerStatus = useCallback((id: number, status: Status) => {
    const e = engineRef.current;
    const s = e.signers.find((x) => x.id === id);
    if (s) s.status = status as Signer["status"];
    else {
      const name = SIGNERS.find((x) => x.id === id)?.name ?? `Signer ${id}`;
      e.signers.push({ id, name, status: status as Signer["status"] });
    }
  }, []);

  /* ─── data fetching ─────────────────────────────────────────────── */

  const refreshRequests = useCallback(async () => {
    try {
      const list = await api.requests(readToken);
      if (Array.isArray(list)) {
        engineRef.current.requests = list;
        commit();
      }
    } catch {
      /* keep last known state; poll again shortly */
    }
  }, [readToken, commit]);

  const refreshAudit = useCallback(async () => {
    try {
      const list = await api.audit(readToken);
      if (Array.isArray(list)) {
        engineRef.current.audit = list;
        commit();
      }
    } catch {
      /* ignore */
    }
  }, [readToken, commit]);

  const refreshSigners = useCallback(async () => {
    try {
      const list = await api.signers(readToken);
      if (Array.isArray(list)) {
        engineRef.current.signers = list;
        commit();
      }
    } catch {
      /* keep last known signer statuses */
    }
  }, [readToken, commit]);

  const scheduleRefresh = useCallback(() => {
    if (refreshQueued.current) return;
    refreshQueued.current = true;
    setTimeout(() => {
      refreshQueued.current = false;
      void refreshRequests();
      void refreshAudit();
      void refreshSigners();
    }, 250);
  }, [refreshRequests, refreshAudit, refreshSigners]);

  /* ─── SSE event handlers ────────────────────────────────────────── */

  const onCeremonyEvent = useCallback(
    (msg: RimeEvent) => {
      if (!msg || msg.request_id == null) return;
      const id = msg.request_id;
      const e = engineRef.current;
      const c = (e.ceremonies[id] ??= {
        reached: -1,
        latest: null,
        failed: null,
        sawSteps: new Set<string>(),
      });

      c.latest = msg;
      c.sawSteps.add(msg.step);

      if (msg.step === "failed") {
        c.failed = msg.detail || "Ceremony failed";
        e.activeCeremonyId = id;
      } else {
        const idx = CEREMONY_ORDER.indexOf(msg.step as (typeof CEREMONY_ORDER)[number]);
        if (idx >= 0) {
          c.reached = Math.max(c.reached, idx);
          e.activeCeremonyId = id;
        }
      }
      commit();
      scheduleRefresh();
    },
    [commit, scheduleRefresh],
  );

  const onRecoveryEvent = useCallback(
    (msg: RimeEvent) => {
      const step = msg.step;
      const e = engineRef.current;

      if (step === "recovery.lost") {
        scheduleRefresh();
        commit();
        return;
      }

      // Resolve which signer this recovery belongs to (the lost/repairing one,
      // or this device in signer mode) at creation time.
      const resolveSignerId = (): number | null => {
        const cand =
          e.signers.find((x) => x.status === "lost" || (x.status as string) === "repairing") ??
          (me != null ? SIGNERS[me] : null);
        return cand ? cand.id : null;
      };

      // Build the next recovery state as a fresh object so we never mutate the
      // live engine graph in place; assign it back once fully built.
      const prev = e.recovery;
      const r: Recovery = prev
        ? { ...prev }
        : {
            signerId: null,
            reached: -1,
            step: null,
            failed: null,
            done: false,
            reviveUntil: 0,
          };
      if (r.signerId == null) r.signerId = resolveSignerId();
      r.step = step;

      if (step === "recovery.failed") {
        r.failed = msg.detail || "Recovery failed";
      } else {
        const idx = RECOVERY_ORDER.indexOf(step as (typeof RECOVERY_ORDER)[number]);
        if (idx >= 0) r.reached = Math.max(r.reached, idx);
        if (step === "recovery.done") {
          r.done = true;
          if (r.signerId != null) setLocalSignerStatus(r.signerId, "active");
          const win = me != null ? 2600 : 1800;
          r.reviveUntil = Date.now() + win;
          const finishedId = r.signerId;
          setTimeout(() => {
            const cur = engineRef.current.recovery;
            if (cur && cur.signerId === finishedId && cur.done) {
              engineRef.current.recovery = null;
            }
            void refreshSigners();
            commit();
          }, win);
        }
      }
      e.recovery = r;
      commit();
      scheduleRefresh();
    },
    [me, commit, scheduleRefresh, setLocalSignerStatus, refreshSigners],
  );

  /* ─── boot: treasury retry loop + polling + SSE ─────────────────── */

  useEffect(() => {
    let closed = false;

    async function loadTreasury() {
      if (closed) return;
      try {
        const t = await api.treasury(readToken);
        if (t && t.configured !== false) {
          engineRef.current.treasury = t;
          commit();
          return;
        }
      } catch {
        /* server may still be warming up */
      }
      if (!closed) setTimeout(loadTreasury, 5000);
    }

    void loadTreasury();
    void refreshRequests();
    void refreshAudit();
    void refreshSigners();

    const unsubscribe = subscribeEvents(
      readToken,
      (ev) => {
        if (typeof ev.step === "string" && ev.step.startsWith("recovery.")) onRecoveryEvent(ev);
        else onCeremonyEvent(ev);
      },
      (connected) => {
        engineRef.current.sse = connected ? "live" : "offline";
        commit();
      },
    );

    const pollTimer = setInterval(() => {
      void refreshRequests();
      void refreshAudit();
      void refreshSigners();
    }, 4000);

    return () => {
      closed = true;
      clearInterval(pollTimer);
      unsubscribe();
    };
  }, [
    readToken,
    commit,
    refreshRequests,
    refreshAudit,
    refreshSigners,
    onCeremonyEvent,
    onRecoveryEvent,
  ]);

  /* ─── derived selectors (all read the render snapshot) ──────────── */

  const threshold = snapshot.treasury?.threshold ?? 2;
  const network = snapshot.treasury?.network;
  const requests = useMemo(() => sortRequests(snapshot.requests), [snapshot.requests]);

  const signerName = useCallback(
    (i: number) => displayName(snapshot.treasury, i),
    [snapshot.treasury],
  );
  const signerStatus = useCallback((id: number) => statusOf(snapshot, id), [snapshot]);
  const isRepairing = useCallback((id: number) => isRepairingOf(snapshot, id), [snapshot]);
  const isReviving = useCallback((id: number) => isRevivingOf(snapshot, id), [snapshot]);
  const phoneQueue = useCallback((id: number) => phoneQueueOf(snapshot, id), [snapshot]);
  const pendingCount = useCallback((id: number) => phoneQueueOf(snapshot, id).open.length, [snapshot]);
  const myDecision = useCallback(
    (signerId: number, reqId: number) => snapshot.decisions[signerId]?.[reqId],
    [snapshot.decisions],
  );
  const failureDetail = useCallback(
    (reqId: number) => snapshot.ceremonies[reqId]?.failed ?? null,
    [snapshot.ceremonies],
  );
  const recoveryFor = useCallback(
    (signerId: number) => {
      const r = snapshot.recovery;
      if (!r || r.signerId !== signerId) return null;
      return { reached: r.reached, step: r.step, failed: r.failed, done: r.done };
    },
    [snapshot.recovery],
  );

  const activeCeremony: ActiveCeremony | null = useMemo(() => {
    const id = snapshot.activeCeremonyId;
    if (id == null) return null;
    const c = snapshot.ceremonies[id];
    if (!c) return null;
    const req = snapshot.requests.find((r) => r.id === id) ?? null;
    const failed = c.failed;
    const finished = !failed && c.reached >= BROADCAST_IDX;
    return { id, req, reached: c.reached, failed, finished, latest: c.latest };
  }, [snapshot.activeCeremonyId, snapshot.ceremonies, snapshot.requests]);

  /* ─── actions (event handlers — free to touch the live engine) ──── */

  const decide = useCallback(
    (signerId: number, reqId: number, decision: Decision) => {
      const signer = SIGNERS.find((s) => s.id === signerId);
      if (!signer) return;
      const eng = engineRef.current;
      const need = eng.treasury?.threshold ?? 2;

      // optimistic
      eng.decisions[signerId][reqId] = decision;
      const req = eng.requests.find((r) => r.id === reqId);
      if (req && decision === "approve") {
        req.approvals = (req.approvals ?? 0) + 1;
        if (req.approvals >= need && req.status === "pending") req.status = "quorum";
      }
      commit();

      void (async () => {
        try {
          await api.decide(reqId, signer.token, decision);
          toast.success(
            `${signer.name} ${decision === "approve" ? "approved" : "rejected"} R#${reqId}`,
          );
        } catch (err) {
          delete engineRef.current.decisions[signerId][reqId]; // roll back
          toast.error(`${signer.name}: ${(err as Error).message}`);
          commit();
        }
        void refreshRequests();
      })();
    },
    [commit, refreshRequests],
  );

  const markLost = useCallback(
    (signerId: number) => {
      const signer = SIGNERS.find((s) => s.id === signerId);
      if (!signer) return;
      void (async () => {
        try {
          const res = await api.markLost(signerId, signer.token);
          setLocalSignerStatus(signerId, (res?.status as Status) || "lost"); // optimistic
          toast.success(`${signer.name}'s device marked lost`);
          commit();
          void refreshSigners();
        } catch (err) {
          // 409 (plain text) when it would drop below 2 active signers
          toast.error((err as Error).message);
        }
      })();
    },
    [commit, refreshSigners, setLocalSignerStatus],
  );

  const repair = useCallback(
    (signerId: number) => {
      const eng = engineRef.current;
      // repair is performed BY the other, still-active signers
      const helper =
        SIGNERS.find((s) => s.id !== signerId && rawStatusOf(eng, s.id) === "active") ??
        SIGNERS.find((s) => s.id !== signerId);
      if (!helper) return;
      eng.recovery = {
        signerId,
        reached: -1,
        step: "recovery.repair",
        failed: null,
        done: false,
        reviveUntil: 0,
      };
      setLocalSignerStatus(signerId, "repairing"); // optimistic
      commit();
      void (async () => {
        try {
          await api.repair(signerId, helper.token);
          const idx = SIGNERS.findIndex((s) => s.id === signerId);
          const nm = displayName(engineRef.current.treasury, idx);
          toast.success(`Rebuilding ${nm}'s share from the other signers…`);
          void refreshSigners();
        } catch (err) {
          toast.error((err as Error).message);
          const cur = engineRef.current.recovery;
          if (cur && cur.signerId === signerId) cur.failed = (err as Error).message;
          commit();
        }
      })();
    },
    [commit, refreshSigners, setLocalSignerStatus],
  );

  const createRequest = useCallback(
    async (input: { recipient: string; amount: string; reason: string }): Promise<boolean> => {
      const recipient = input.recipient.trim();
      const reason = input.reason.trim();
      const zat = toZatoshis(input.amount.trim());
      const unit = unitFor(engineRef.current.treasury?.network);
      if (!recipient) {
        toast.error("Recipient is required.");
        return false;
      }
      if (zat == null || zat <= BigInt(0)) {
        toast.error(`Enter a positive ${unit} amount (max 8 decimals).`);
        return false;
      }
      if (!reason) {
        toast.error("A reason is required.");
        return false;
      }
      try {
        const res = await api.createRequest({
          recipient,
          amount_zat: Number(zat),
          reason,
          // Bob proposes; Alice and Carol are then the approvers on their phones.
          signer_token: SIGNERS[1].token,
        });
        toast.success(`Request R#${res.id} created — waiting on signers`);
        void refreshRequests();
        void refreshAudit();
        return true;
      } catch (err) {
        toast.error((err as Error).message);
        return false;
      }
    },
    [refreshRequests, refreshAudit],
  );

  return {
    me,
    treasury: snapshot.treasury,
    requests,
    audit: snapshot.audit,
    sse: snapshot.sse,
    recovery: snapshot.recovery,
    threshold,
    network,
    unit: unitFor(network),
    explorer: explorerBase(network),
    signerName,
    signerStatus,
    phoneQueue,
    pendingCount,
    myDecision,
    isRepairing,
    isReviving,
    recoveryFor,
    activeCeremony,
    failureDetail,
    decide,
    markLost,
    repair,
    createRequest,
  };
}
