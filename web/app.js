/* ═══════════════════════════════════════════════════════════════════
   Rime — frost-sealed treasury · client
   One state object, small render helpers, no framework.
   ═══════════════════════════════════════════════════════════════════ */

const $ = (sel, el = document) => el.querySelector(sel);

/* ─── config ──────────────────────────────────────────────────────── */

const SIGNERS = [
  { id: 1, name: "Alice", token: "dev-token-alice", hue: "a" },
  { id: 2, name: "Bob",   token: "dev-token-bob",   hue: "b" },
  { id: 3, name: "Carol", token: "dev-token-carol", hue: "c" },
];
const POLL_MS = 4000;

/* Device mode: ?signer=alice|bob|carol renders one full-viewport signer view
   (real phones on the demo wifi). No param → desktop dashboard + framed phones. */
const SIGNER_SLUGS = { alice: 0, bob: 1, carol: 2 };
const ME = SIGNER_SLUGS[
  (new URLSearchParams(location.search).get("signer") || "").toLowerCase()
] ?? null;

const readToken = () => (ME != null ? SIGNERS[ME].token : SIGNERS[0].token);

/* Ceremony pipeline, in protocol order (post-quorum steps). */
const CEREMONY_ORDER = [
  "pczt.create", "sighash.extract", "sighash.ready",
  "ceremony.start", "ceremony.join", "ceremony.signed",
  "pczt.signed", "pczt.prove", "pczt.combine",
  "broadcast", "confirmed",
];

/* Human labels for SSE steps (long form, for detail lines). */
const STEP_LABELS = {
  "created":         "Request created",
  "decision":        "Signer decision recorded",
  "pczt.create":     "Building transaction",
  "sighash.extract": "Extracting SIGHASH",
  "sighash.ready":   "SIGHASH extracted",
  "ceremony.start":  "Signing ceremony started (2 of 3)",
  "ceremony.join":   "Signer joined the ceremony",
  "ceremony.signed": "Threshold signature complete",
  "pczt.signed":     "Signatures applied to transaction",
  "pczt.prove":      "Generating zero-knowledge proofs",
  "pczt.combine":    "Assembling final transaction",
  "broadcast":       "Broadcast to network",
  "confirmed":       "Confirmed on chain",
  "failed":          "Ceremony failed",
  // signer recovery ("lake scene")
  "recovery.lost":    "Device share marked lost",
  "recovery.repair":  "Remaining signers rebuilding the share",
  "recovery.refresh": "Rotating all shares — old share is now a dead key",
  "recovery.done":    "Signer restored · treasury address unchanged",
  "recovery.failed":  "Recovery failed",
};

/* Short labels for the pipeline strip nodes. */
const STEP_SHORT = {
  "pczt.create":     "Build tx",
  "sighash.extract": "Extract",
  "sighash.ready":   "SIGHASH",
  "ceremony.start":  "Ceremony",
  "ceremony.join":   "Join",
  "ceremony.signed": "Threshold sig",
  "pczt.signed":     "Apply sigs",
  "pczt.prove":      "ZK proofs",
  "pczt.combine":    "Combine",
  "broadcast":       "Broadcast",
  "confirmed":       "Confirmed",
};

/* Recovery pipeline (post-"lost" repair sequence), in order. */
const RECOVERY_ORDER = ["recovery.repair", "recovery.refresh", "recovery.done"];
const RECOVERY_SHORT = {
  "recovery.repair":  "Rebuild",
  "recovery.refresh": "Rotate keys",
  "recovery.done":    "Restored",
};

const stepLabel = (s) => STEP_LABELS[s] || s;

/* ─── state ───────────────────────────────────────────────────────── */

const state = {
  treasury: null,           // {network, address, threshold, signers} | {configured:false}
  requests: [],             // from GET /api/requests
  audit: [],                // from GET /api/audit
  ceremonies: {},           // request_id -> {reached, latest, failed, sawSteps:Set}
  decisions: { 1: {}, 2: {}, 3: {} }, // signer id -> request id -> "approve"|"reject"
  activeCeremonyId: null,   // request id shown on the strip
  sse: "connecting",        // connecting | live | offline
  recipientDirty: false,
  signers: [],              // from GET /api/signers → [{id, name, status}]
  recovery: null,           // active repair: {signerId, reached, step, failed, done, reviveUntil}
};

const threshold = () => state.treasury?.threshold ?? 2;
const unit = () => (state.treasury?.network === "main" ? "ZEC" : "TAZ");
const explorerBase = () =>
  state.treasury?.network === "main"
    ? "https://mainnet.zcashexplorer.app/transactions/"
    : "https://testnet.zcashexplorer.app/transactions/";

/* ─── tiny utils ──────────────────────────────────────────────────── */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function truncMid(s, head = 12, tail = 8) {
  s = String(s ?? "");
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** "0.25" → 25000000n zatoshis; null when invalid. */
function toZatoshis(input) {
  const s = String(input).trim();
  if (!/^\d+(\.\d{0,8})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * 100_000_000n + BigInt((frac + "00000000").slice(0, 8));
}

/** zatoshis → decimal coin string with trailing zeros trimmed. */
function fmtZat(zat) {
  const n = Number(zat ?? 0);
  if (!Number.isFinite(n)) return "—";
  return (n / 1e8).toFixed(8).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function parseWhen(v) {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function timeAgo(v) {
  const d = parseWhen(v);
  if (!d) return "";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}

function clock(v) {
  const d = parseWhen(v);
  return d ? d.toLocaleTimeString([], { hour12: false }) : "";
}

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast" + (isError ? " toast--error" : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ─── api ─────────────────────────────────────────────────────────── */

async function api(path, { method = "GET", body, token = readToken() } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const ct = res.headers.get("content-type") || "";
      detail = ct.includes("json")
        ? ((await res.json()).error || "")
        : (await res.text()); // mark-lost 409 returns a plain-text reason
    } catch { /* ignore */ }
    throw new Error((detail || "").trim() || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function loadTreasury() {
  try {
    const t = await api("/api/treasury");
    if (t && t.configured !== false) {
      state.treasury = t;
      renderTreasury();
      return;
    }
  } catch { /* server may still be warming up */ }
  setTimeout(loadTreasury, 5000); // retry until configured
}

async function refreshRequests() {
  try {
    const list = await api("/api/requests");
    if (Array.isArray(list)) {
      state.requests = list;
      renderFeed();
      renderPhones();
      renderStrip();
    }
  } catch { /* keep last known state; poll again shortly */ }
}

async function refreshAudit() {
  try {
    const list = await api("/api/audit");
    if (Array.isArray(list)) {
      state.audit = list;
      renderAudit();
    }
  } catch { /* ignore */ }
}

async function refreshSigners() {
  try {
    const list = await api("/api/signers");
    if (Array.isArray(list)) {
      state.signers = list;
      renderPhones();
    }
  } catch { /* keep last known signer statuses */ }
}

let refreshQueued = false;
function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  setTimeout(() => {
    refreshQueued = false;
    refreshRequests();
    refreshAudit();
    refreshSigners();
  }, 250);
}

/* ─── SSE (single-use tickets, 60s TTL, backoff reconnect) ────────── */

let sseSource = null;
let sseBackoff = 1000;

async function connectSSE() {
  setConn("connecting");
  try {
    const { ticket } = await api("/api/sse-ticket", { method: "POST" });
    sseSource = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);

    sseSource.onopen = () => { sseBackoff = 1000; setConn("live"); };

    sseSource.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg && typeof msg.step === "string" && msg.step.startsWith("recovery."))
          onRecoveryEvent(msg);
        else
          onCeremonyEvent(msg);
      } catch { /* non-JSON keepalive */ }
    };

    sseSource.onerror = () => {
      sseSource.close();
      sseSource = null;
      setConn("offline");
      retrySSE();
    };
  } catch {
    setConn("offline");
    retrySSE();
  }
}

function retrySSE() {
  const wait = sseBackoff;
  sseBackoff = Math.min(sseBackoff * 2, 15000);
  setTimeout(connectSSE, wait); // fresh ticket every attempt — they are single-use
}

function setConn(mode) {
  state.sse = mode;
  const label = mode === "live" ? "live" : mode;
  const el = $("#conn");
  el.className = `conn conn--${mode}`;
  $("#conn-label").textContent = label;
  const sconn = $("#sconn");
  if (sconn) {
    sconn.className = `conn conn--${mode}`;
    $("#sconn-label").textContent = label;
  }
}

function onCeremonyEvent(msg) {
  if (!msg || msg.request_id == null) return;
  const id = msg.request_id;
  const c = (state.ceremonies[id] ??= { reached: -1, latest: null, failed: null, sawSteps: new Set() });

  c.latest = msg;
  c.sawSteps.add(msg.step);

  if (msg.step === "failed") {
    c.failed = msg.detail || "Ceremony failed";
    state.activeCeremonyId = id;
  } else {
    const idx = CEREMONY_ORDER.indexOf(msg.step);
    if (idx >= 0) {
      c.reached = Math.max(c.reached, idx);
      state.activeCeremonyId = id;
    }
  }

  renderStrip();
  renderPhones();
  renderFeed();
  scheduleRefresh(); // pull authoritative statuses shortly after
}

/* ─── signer status helpers ───────────────────────────────────────── */

function signerStatus(id) {
  const s = state.signers.find((x) => x.id === id);
  return s ? s.status : "active"; // default until /api/signers lands
}
const signerName = (id) => SIGNERS.find((s) => s.id === id)?.name || `Signer ${id}`;

function setLocalSignerStatus(id, status) {
  const s = state.signers.find((x) => x.id === id);
  if (s) s.status = status;
  else state.signers.push({ id, name: signerName(id), status });
}

/* Recovery SSE (request_id 0). recovery.lost just flags the loss (poll shows
   it); repair/refresh/done/failed drive the animated repair panel. */
function onRecoveryEvent(msg) {
  const step = msg.step;

  if (step === "recovery.lost") {
    scheduleRefresh();
    renderPhones();
    return;
  }

  let r = state.recovery;
  if (!r) r = state.recovery = { signerId: null, reached: -1, step: null, failed: null, done: false, reviveUntil: 0 };
  if (r.signerId == null) {
    const cand = state.signers.find((x) => x.status === "lost" || x.status === "repairing")
      || (ME != null ? SIGNERS[ME] : null);
    if (cand) r.signerId = cand.id;
  }
  r.step = step;

  if (step === "recovery.failed") {
    r.failed = msg.detail || "Recovery failed";
  } else {
    const idx = RECOVERY_ORDER.indexOf(step);
    if (idx >= 0) r.reached = Math.max(r.reached, idx);
    if (step === "recovery.done") {
      r.done = true;
      if (r.signerId != null) setLocalSignerStatus(r.signerId, "active");
      const win = ME != null ? 2600 : 1800; // device lingers on "Restored ✓" a beat longer
      r.reviveUntil = Date.now() + win;
      const finishedId = r.signerId;
      setTimeout(() => {
        if (state.recovery && state.recovery.signerId === finishedId && state.recovery.done) {
          state.recovery = null;
        }
        refreshSigners();
        renderPhones();
      }, win);
    }
  }

  renderPhones();
  scheduleRefresh();
}

/* ─── render: header + treasury ───────────────────────────────────── */

function renderTreasury() {
  const t = state.treasury;
  if (!t) return;

  $("#badge-network").textContent = `network ${t.network || "—"}`;
  $("#badge-threshold").textContent = `${t.threshold ?? 2}‑of‑${(t.signers || SIGNERS).length} · FROST`;
  $("#threshold-inline").textContent = `${t.threshold ?? 2} of ${(t.signers || SIGNERS).length}`;
  $("#balance-unit").textContent = unit();
  $("#f-unit").textContent = unit();

  const addrEl = $("#addr");
  addrEl.textContent = t.address || "—";
  addrEl.title = t.address || "";

  // adopt server-provided signer names, in order
  if (Array.isArray(t.signers)) {
    t.signers.forEach((name, i) => { if (SIGNERS[i] && name) SIGNERS[i].name = name; });
  }

  // default the form recipient to the treasury address (self-pay demo)
  const rcpt = $("#f-recipient");
  if (!state.recipientDirty && t.address) rcpt.value = t.address;

  renderPhones();
}

/* ─── render: request feed ────────────────────────────────────────── */

function chipFor(status) {
  const known = ["pending", "quorum", "signing", "broadcast", "failed", "rejected"];
  const cls = known.includes(status) ? status : "pending";
  return `<span class="chip chip--${cls}">${esc(status)}</span>`;
}

function quorumBar(req) {
  const need = threshold();
  const got = ["quorum", "signing", "broadcast"].includes(req.status)
    ? need
    : Math.min(req.approvals ?? 0, need);
  const pct = Math.round((got / need) * 100);
  return `
    <div class="quorum">
      <div class="quorum-track">
        <div class="quorum-fill${got >= need ? " full" : ""}" style="width:${pct}%"></div>
      </div>
      <span class="quorum-count"><strong>${got}</strong>/${need} approvals</span>
    </div>`;
}

function sortedRequests() {
  return [...state.requests].sort((a, b) => {
    const ta = parseWhen(a.created_at)?.getTime() ?? 0;
    const tb = parseWhen(b.created_at)?.getTime() ?? 0;
    return tb - ta || (b.id ?? 0) - (a.id ?? 0);
  });
}

function renderFeed() {
  const feed = $("#feed");
  const reqs = sortedRequests();
  if (!reqs.length) {
    feed.innerHTML = `<p class="empty">No requests yet — create one above.</p>`;
    return;
  }
  feed.innerHTML = reqs.map((r) => {
    const fail = r.status === "failed"
      ? (state.ceremonies[r.id]?.failed || "Ceremony failed — see audit log")
      : state.ceremonies[r.id]?.failed;
    return `
    <article class="req">
      <div class="req-top">
        <span class="req-reason"><span class="req-id">R#${esc(r.id)}</span>${esc(r.reason)}</span>
        ${chipFor(r.status)}
      </div>
      <div class="req-meta">
        <span class="req-amt">${fmtZat(r.amount_zat)}<span class="unit">${unit()}</span></span>
        <span class="req-to" title="${esc(r.recipient)}">→ ${esc(truncMid(r.recipient))}</span>
        <span class="req-time">${esc(timeAgo(r.created_at))}</span>
      </div>
      ${quorumBar(r)}
      ${r.txid ? `
        <a class="req-txid" href="${explorerBase()}${encodeURIComponent(r.txid)}"
           target="_blank" rel="noopener" title="${esc(r.txid)}">
          <span class="txid-label">txid</span>${esc(r.txid)}
        </a>` : ""}
      ${fail ? `<div class="req-fail">${esc(fail)}</div>` : ""}
    </article>`;
  }).join("");
}

/* ─── render: signer phones ───────────────────────────────────────── */

function phoneQueue(signer) {
  const mine = state.decisions[signer.id];
  const reqs = sortedRequests();
  return {
    // actionable: pending, this signer hasn't decided in this session
    open: reqs.filter((r) => r.status === "pending" && !mine[r.id]),
    // quorum/signing without my decision — approved by enough others
    others: reqs.filter((r) => ["quorum", "signing"].includes(r.status) && !mine[r.id]),
    // requests I decided this session (most recent few)
    decided: reqs.filter((r) => mine[r.id]).slice(0, 4),
  };
}

function ceremonyPanel() {
  const id = state.activeCeremonyId;
  if (id == null) return "";
  const c = state.ceremonies[id];
  if (!c) return "";
  const req = state.requests.find((r) => r.id === id);
  const total = CEREMONY_ORDER.length;
  const done = c.reached + 1;
  const failed = !!c.failed;
  const finished = !failed && c.reached >= CEREMONY_ORDER.indexOf("broadcast");
  const cls = failed ? " pceremony--failed" : finished ? " pceremony--done" : "";
  const title = failed ? "Ceremony failed" : finished ? "Funds moved" : "Ceremony live";
  const line = failed
    ? esc(c.failed)
    : esc(c.latest ? stepLabel(c.latest.step) : "Preparing…");
  const pct = failed ? 100 : Math.round((Math.max(done, 0) / total) * 100);
  const txid = req?.txid;
  return `
    <div class="pceremony${cls}">
      <div class="pceremony-title"><span class="live-dot"></span>${title}
        ${req ? ` · R#${esc(req.id)}` : ""}</div>
      <div class="pceremony-step">${line}</div>
      <div class="pceremony-track"><div class="pceremony-fill" style="width:${pct}%"></div></div>
      ${txid ? `
        <a class="pceremony-txid" href="${explorerBase()}${encodeURIComponent(txid)}"
           target="_blank" rel="noopener" title="${esc(txid)}">txid ${esc(truncMid(txid, 10, 8))}</a>` : ""}
    </div>`;
}

function pcard(req, signer, kind) {
  const mine = state.decisions[signer.id][req.id];
  let footer;
  if (kind === "open") {
    footer = `
      <div class="pcard-actions">
        <button class="btn btn-approve" data-action="approve" data-req="${esc(req.id)}"
                data-signer="${signer.id}" type="button">Approve</button>
        <button class="btn btn-reject" data-action="reject" data-req="${esc(req.id)}"
                data-signer="${signer.id}" type="button">Reject</button>
      </div>`;
  } else if (kind === "others") {
    footer = `
      <div class="pcard-state pcard-state--waiting">
        <span class="state-dot"></span>quorum reached — signing
      </div>`;
  } else {
    footer = mine === "approve"
      ? `<div class="pcard-state pcard-state--approved"><span class="state-dot"></span>you approved</div>`
      : `<div class="pcard-state pcard-state--rejected"><span class="state-dot"></span>you rejected</div>`;
  }
  return `
    <div class="pcard${kind === "open" ? " pcard--actionable" : ""}">
      <div class="pcard-reason">${esc(req.reason)}</div>
      <div class="pcard-amt">${fmtZat(req.amount_zat)}<span class="unit">${unit()}</span></div>
      <div class="pcard-to" title="${esc(req.recipient)}">→ ${esc(truncMid(req.recipient, 14, 10))}</div>
      ${quorumBar(req)}
      ${footer}
    </div>`;
}

/* ─── render: signer recovery ("lake scene") ──────────────────────── */

const BIG_TICK = `<svg class="big-tick" viewBox="0 0 52 52" aria-hidden="true">
  <circle cx="26" cy="26" r="23"/><path d="M15 27l7 7 15-16"/></svg>`;

/** Is signer `id` currently mid-repair (repairing status or live recovery). */
function isRepairing(id) {
  const r = state.recovery;
  return signerStatus(id) === "repairing" || !!(r && r.signerId === id && !r.done);
}
/** Show the celebratory revival for a short window after recovery.done. */
function isReviving(id) {
  const r = state.recovery;
  return !!(r && r.signerId === id && r.done && Date.now() < r.reviveUntil);
}

/* Animated repair progress — reuses the ceremony checkmark cascade. */
function recoveryPanel(signerId) {
  const r = state.recovery;
  const active = !!(r && r.signerId === signerId);
  const reached = active ? r.reached : -1;
  const failed = active ? r.failed : null;
  const done = active ? r.done : false;
  const cls = failed ? " recovery--failed" : done ? " recovery--done" : "";
  const title = failed ? "Recovery failed" : done ? "Signer restored" : "Recovery in progress";
  const line = failed ? esc(failed)
    : active && r.step ? esc(stepLabel(r.step))
    : "Rebuilding the share from the other two signers…";
  const failAt = failed ? Math.min(reached + 1, RECOVERY_ORDER.length - 1) : -1;

  const nodes = RECOVERY_ORDER.map((step, i) => {
    let c = "", inner = TICK_SVG;
    if (failed && i === failAt) { c = "fail"; inner = `<span class="step-x">✕</span>`; }
    else if (i <= reached) c = "done";
    else if (!failed && !done && active && i === reached + 1) c = "active";
    const link = i < RECOVERY_ORDER.length - 1
      ? `<span class="step-link${i <= reached - 1 ? " done" : ""}"></span>` : "";
    return `
      <div class="step ${c}">
        <span class="step-node">${inner}</span>
        <span class="step-label">${esc(RECOVERY_SHORT[step] || step)}</span>
      </div>${link}`;
  }).join("");

  return `
    <div class="recovery${cls}">
      <div class="recovery-title"><span class="live-dot"></span>${title}</div>
      <div class="recovery-step">${line}</div>
      <div class="recovery-steps">${nodes}</div>
    </div>`;
}

/* Screen shown inside a lost / repairing / reviving phone frame. */
function phoneLostScreen(s) {
  if (isReviving(s.id)) {
    return `
      <div class="revive-panel">
        <div class="revive-check">${BIG_TICK}</div>
        <div class="revive-title">Share restored</div>
        <div class="revive-sub">Treasury address unchanged — ${esc(s.name)} can approve again.</div>
      </div>`;
  }
  const repairing = isRepairing(s.id);
  return `
    <div class="lost-panel">
      <div class="lost-glyph" aria-hidden="true">❄</div>
      <div class="lost-title">Device share lost</div>
      <div class="lost-desc">${esc(s.name)}'s key share is gone. Funds stay safe —
        the other two signers can rebuild it. Nothing moves without ${threshold()} approvals.</div>
      ${repairing
        ? recoveryPanel(s.id)
        : `<button class="btn btn-repair" data-repair="${s.id}" type="button">Repair from other signers</button>`}
    </div>`;
}

/* ─── render: signer phones ───────────────────────────────────────── */

function renderPhone(s, i) {
  const st = signerStatus(s.id);
  const lost = st === "lost";
  const repairing = isRepairing(s.id);
  const reviving = isReviving(s.id);
  const down = (lost || repairing) && !reviving;

  const frameCls = ["phone",
    down ? "phone--lost" : "",
    repairing && !reviving ? "phone--repairing" : "",
    reviving ? "phone--revived" : "",
  ].filter(Boolean).join(" ");

  let statusChip;
  if (repairing && !reviving) statusChip = `<span class="phone-status status--repairing">Repairing</span>`;
  else if (lost && !reviving) statusChip = `<span class="phone-status status--lost">Lost</span>`;
  else statusChip = `<span class="phone-status status--active">Active</span>`;

  let screen, foot = "";
  if (down || reviving) {
    screen = phoneLostScreen(s);
  } else {
    const q = phoneQueue(s);
    const cards = [
      ceremonyPanel(),
      ...q.open.map((r) => pcard(r, s, "open")),
      ...q.others.map((r) => pcard(r, s, "others")),
      ...q.decided.map((r) => pcard(r, s, "decided")),
    ].filter(Boolean);
    screen = cards.length ? cards.join("") : `
      <div class="phone-empty">
        <div><span class="flake">✻</span>No pending approvals<br>All quiet on the ice.</div>
      </div>`;
    foot = `<div class="phone-foot">
        <button class="phone-lost-link" data-report-lost="${s.id}" type="button">Report device lost</button>
      </div>`;
  }

  const pending = (down || reviving) ? "" :
    `<span class="phone-badge${phoneQueue(s).open.length ? "" : " zero"}">${phoneQueue(s).open.length} pending</span>`;

  return `
    <div class="${frameCls}" aria-label="${esc(s.name)}'s phone">
      <div class="phone-notch"></div>
      <div class="phone-head">
        <span class="avatar avatar--${s.hue}">${esc(s.name[0] || "?")}</span>
        <div class="phone-id">
          <div class="phone-name">${esc(s.name)}</div>
          <div class="phone-role">signer ${i + 1} of ${SIGNERS.length}</div>
        </div>
        <div class="phone-head-right">${statusChip}${pending}</div>
      </div>
      <div class="phone-screen">${screen}</div>
      ${foot}
    </div>`;
}

function renderPhones() {
  if (ME != null) { renderSignerApp(); return; }
  const wrap = $("#phones");
  const scrolls = [...wrap.querySelectorAll(".phone-screen")].map((el) => el.scrollTop);
  wrap.innerHTML = SIGNERS.map((s, i) => renderPhone(s, i)).join("");
  [...wrap.querySelectorAll(".phone-screen")].forEach((el, i) => {
    if (scrolls[i]) el.scrollTop = scrolls[i];
  });
}

/* ─── render: device mode (one real phone = one signer) ───────────── */

function signerHead(s, muted) {
  return `
    <div class="signer-head">
      <span class="avatar avatar--${s.hue}${muted ? " avatar--muted" : ""}">${esc(s.name[0] || "?")}</span>
      <div class="signer-id">
        <div class="signer-name">${esc(s.name)}</div>
        <div class="signer-role">Rime treasury · signer ${ME + 1} of ${SIGNERS.length}</div>
      </div>
      <span class="conn conn--${state.sse}" id="sconn">
        <span class="conn-dot"></span><span id="sconn-label">${esc(state.sse === "live" ? "live" : state.sse)}</span>
      </span>
    </div>`;
}

function renderSignerApp() {
  const app = $("#signer-app");
  const s = SIGNERS[ME];
  const st = signerStatus(s.id);
  document.body.classList.toggle("device-down", (st === "lost" || isRepairing(s.id)) && !isReviving(s.id));

  // ── Restored ✓ celebration ──
  if (isReviving(s.id)) {
    app.innerHTML = `
      ${signerHead(s, false)}
      <div class="signer-screen">
        <div class="device-restored">
          <div class="restored-check">${BIG_TICK}</div>
          <div class="device-restored-title">Restored ✓</div>
          <div class="device-restored-sub">Share rebuilt · treasury address unchanged.<br>You can approve payments again.</div>
        </div>
      </div>
      <div class="signer-foot"><span class="foot-brand">🧊 Rime · share recovery</span></div>`;
    return;
  }

  // ── Lost / recovering full-screen ──
  if (st === "lost" || isRepairing(s.id)) {
    app.innerHTML = `
      ${signerHead(s, true)}
      <div class="signer-screen device-lost-screen">
        <div class="device-lost">
          <div class="device-lost-glyph" aria-hidden="true">❄</div>
          <div class="device-lost-title">This device's share was lost</div>
          <div class="device-lost-sub">Recovering from the other two signers — your treasury is safe.</div>
          ${recoveryPanel(s.id)}
          <div class="device-lost-note">The old share is being retired as a dead key.
            When recovery finishes you'll be able to approve again.</div>
        </div>
      </div>
      <div class="signer-foot"><span class="foot-brand">🧊 Rime · 2‑of‑3 FROST</span></div>`;
    return;
  }

  // ── Normal signer view ──
  const q = phoneQueue(s);
  const count = q.open.length;
  const cards = [
    ceremonyPanel(),
    ...q.open.map((r) => pcard(r, s, "open")),
    ...q.others.map((r) => pcard(r, s, "others")),
    ...q.decided.map((r) => pcard(r, s, "decided")),
  ].filter(Boolean);

  const prevScroll = $(".signer-screen", app)?.scrollTop ?? 0;
  app.innerHTML = `
    ${signerHead(s, false)}
    <div class="signer-screen">
      ${count ? `<div class="signer-callout">${count} request${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} your approval</div>` : ""}
      ${cards.length ? cards.join("") : `
        <div class="phone-empty">
          <div><span class="flake">✻</span>No pending approvals<br>All quiet on the ice.</div>
        </div>`}
    </div>
    <div class="signer-foot">
      <button class="device-lost-link" data-report-lost="${s.id}" type="button">Report this device lost</button>
      <span class="foot-brand">🧊 Rime · ${threshold()}&#8209;of&#8209;${SIGNERS.length} FROST</span>
    </div>`;
  const screen = $(".signer-screen", app);
  if (screen && prevScroll) screen.scrollTop = prevScroll;
}

/* ─── render: audit log ───────────────────────────────────────────── */

function renderAudit() {
  const rows = [...state.audit].reverse(); // newest first
  $("#audit-count").textContent = rows.length;
  $("#audit").innerHTML = rows.length
    ? rows.map((a) => `
        <div class="audit-row">
          <span class="audit-time">${esc(clock(a.at))}</span>
          <span class="audit-event" title="${esc(a.event)}">${esc(a.event)}</span>
          <span class="audit-detail">${esc(a.detail)}</span>
        </div>`).join("")
    : `<p class="empty">Nothing logged yet.</p>`;
}

/* ─── render: ceremony strip ──────────────────────────────────────── */

const TICK_SVG = `<svg class="tick" viewBox="0 0 16 16" aria-hidden="true">
  <path d="M3.5 8.5l3 3 6-7"/></svg>`;

function renderStrip() {
  if (ME != null) return; // device mode: ceremony lives inside the signer screen
  const strip = $("#strip");
  const id = state.activeCeremonyId;
  const c = id != null ? state.ceremonies[id] : null;
  const req = id != null ? state.requests.find((r) => r.id === id) : null;

  const failed = !!c?.failed;
  const reached = c?.reached ?? -1;
  const finished = !failed && reached >= CEREMONY_ORDER.indexOf("broadcast");
  const failAt = failed ? Math.min(reached + 1, CEREMONY_ORDER.length - 1) : -1;

  let tag, title, detail;
  if (!c) {
    tag = `<span class="strip-tag">Ceremony pipeline</span>`;
    title = `<span class="strip-detail">awaiting quorum — steps stream here live as two signers approve</span>`;
    detail = "";
  } else {
    const tagCls = failed ? "strip-tag--failed" : finished ? "strip-tag--done" : "strip-tag--live";
    const tagTxt = failed ? "Failed" : finished ? "Complete" : `<span class="live-dot"></span>Live`;
    tag = `<span class="strip-tag ${tagCls}">${tagTxt}</span>`;
    title = `<span class="strip-title">R#${esc(id)}${req ? ` · ${esc(req.reason)}` : ""}</span>`;
    detail = failed
      ? `<span class="strip-detail strip-detail--failed">${esc(c.failed)}</span>`
      : `<span class="strip-detail">${esc(c.latest ? stepLabel(c.latest.step) + (c.latest.detail ? ` — ${c.latest.detail}` : "") : "")}</span>`;
  }

  const txid = req?.txid
    ? `<a class="strip-txid" href="${explorerBase()}${encodeURIComponent(req.txid)}"
         target="_blank" rel="noopener">txid ${esc(truncMid(req.txid, 12, 10))} ↗</a>`
    : "";

  const nodes = CEREMONY_ORDER.map((step, i) => {
    let cls = "";
    let inner = TICK_SVG;
    if (failed && i === failAt) { cls = "fail"; inner = `<span class="step-x">✕</span>`; }
    else if (i <= reached) cls = "done";
    else if (!failed && !finished && c && i === reached + 1) cls = "active";
    const link = i < CEREMONY_ORDER.length - 1
      ? `<span class="step-link${i <= reached - 1 ? " done" : ""}"></span>` : "";
    return `
      <div class="step ${cls}">
        <span class="step-node">${inner}</span>
        <span class="step-label">${esc(STEP_SHORT[step] || step)}</span>
      </div>${link}`;
  }).join("");

  strip.innerHTML = `
    <div class="strip-head">${tag}${title}${detail}${txid}</div>
    <div class="strip-steps">${nodes}</div>`;
}

/* ─── actions ─────────────────────────────────────────────────────── */

async function decide(signerId, reqId, decision) {
  const signer = SIGNERS.find((s) => s.id === signerId);
  if (!signer) return;

  // optimistic
  state.decisions[signerId][reqId] = decision;
  const req = state.requests.find((r) => r.id === reqId);
  if (req && decision === "approve") {
    req.approvals = (req.approvals ?? 0) + 1;
    if (req.approvals >= threshold() && req.status === "pending") req.status = "quorum";
  }
  renderPhones();
  renderFeed();

  try {
    await api(`/api/requests/${encodeURIComponent(reqId)}/decide`, {
      method: "POST",
      token: signer.token,
      body: { signer_token: signer.token, decision },
    });
    toast(`${signer.name} ${decision === "approve" ? "approved" : "rejected"} R#${reqId}`);
  } catch (e) {
    delete state.decisions[signerId][reqId]; // roll back
    toast(`${signer.name}: ${e.message}`, true);
  }
  refreshRequests();
}

async function markLost(signerId) {
  const signer = SIGNERS.find((s) => s.id === signerId);
  if (!signer) return;
  try {
    const res = await api(`/api/signers/${signerId}/mark-lost`, {
      method: "POST", token: signer.token, body: { signer_token: signer.token },
    });
    setLocalSignerStatus(signerId, res?.status || "lost"); // optimistic
    toast(`${signer.name}'s device marked lost`);
    renderPhones();
    refreshSigners();
  } catch (e) {
    // 409 (plain text) when it would drop below 2 active signers
    toast(e.message, true);
  }
}

async function repairSigner(signerId) {
  // repair is performed BY the other, still-active signers
  const helper = SIGNERS.find((s) => s.id !== signerId && signerStatus(s.id) === "active")
    || SIGNERS.find((s) => s.id !== signerId);
  if (!helper) return;
  state.recovery = { signerId, reached: -1, step: "recovery.repair", failed: null, done: false, reviveUntil: 0 };
  setLocalSignerStatus(signerId, "repairing"); // optimistic
  renderPhones();
  try {
    await api(`/api/signers/${signerId}/repair`, {
      method: "POST", token: helper.token, body: { signer_token: helper.token },
    });
    toast(`Rebuilding ${signerName(signerId)}'s share from the other signers…`);
    refreshSigners();
  } catch (e) {
    toast(e.message, true);
    if (state.recovery && state.recovery.signerId === signerId) state.recovery.failed = e.message;
    renderPhones();
  }
}

async function submitRequest(ev) {
  ev.preventDefault();
  const errEl = $("#f-error");
  errEl.textContent = "";

  const recipient = $("#f-recipient").value.trim();
  const amountStr = $("#f-amount").value.trim();
  const reason = $("#f-reason").value.trim();

  const zat = toZatoshis(amountStr);
  if (!recipient) { errEl.textContent = "Recipient is required."; return; }
  if (zat == null || zat <= 0n) { errEl.textContent = `Enter a positive ${unit()} amount (max 8 decimals).`; return; }
  if (!reason) { errEl.textContent = "A reason is required."; return; }

  const btn = $("#f-submit");
  btn.disabled = true;
  try {
    const res = await api("/api/requests", {
      method: "POST",
      body: {
        recipient,
        amount_zat: Number(zat),
        reason,
        signer_token: readToken(),
      },
    });
    toast(`Request R#${res.id} created — waiting on signers`);
    $("#f-amount").value = "";
    $("#f-reason").value = "";
    $("#f-zat-hint").innerHTML = "&nbsp;";
    refreshRequests();
    refreshAudit();
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

async function copyAddress() {
  const addr = state.treasury?.address;
  if (!addr) { toast("Address not available yet", true); return; }
  const btn = $("#copy-addr");
  try {
    await navigator.clipboard.writeText(addr);
  } catch {
    // clipboard API blocked — fall back to a transient textarea
    const ta = document.createElement("textarea");
    ta.value = addr;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  btn.textContent = "Copied";
  btn.classList.add("copied");
  setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1500);
}

/* ─── wiring ──────────────────────────────────────────────────────── */

/* One delegated handler for approve/reject, report-lost, and repair buttons. */
function onPhoneClick(ev) {
  const dec = ev.target.closest("button[data-action]");
  if (dec) {
    const raw = dec.dataset.req;
    const reqId = Number(raw);
    decide(Number(dec.dataset.signer), Number.isNaN(reqId) ? raw : reqId, dec.dataset.action);
    return;
  }
  const report = ev.target.closest("button[data-report-lost]");
  if (report) {
    const id = Number(report.dataset.reportLost);
    if (window.confirm(`Report ${signerName(id)}'s device as lost?\n\nThe other two signers will rebuild the share. The treasury address does not change.`))
      markLost(id);
    return;
  }
  const repair = ev.target.closest("button[data-repair]");
  if (repair) { repairSigner(Number(repair.dataset.repair)); return; }
}

function wire() {
  if (ME != null) {
    // device mode: only the signer screen is interactive
    document.body.classList.add("mode-signer");
    $("#signer-app").addEventListener("click", onPhoneClick);
    return;
  }

  $("#req-form").addEventListener("submit", submitRequest);
  $("#copy-addr").addEventListener("click", copyAddress);

  $("#f-recipient").addEventListener("input", () => { state.recipientDirty = true; });

  $("#f-amount").addEventListener("input", (ev) => {
    const zat = toZatoshis(ev.target.value.trim());
    $("#f-zat-hint").textContent =
      zat != null && zat > 0n ? `= ${Number(zat).toLocaleString("en-US")} zatoshis` : " ";
  });

  $("#phones").addEventListener("click", onPhoneClick);
}

function boot() {
  wire();
  renderPhones();
  renderStrip();
  renderAudit();
  loadTreasury();
  refreshRequests();
  refreshAudit();
  refreshSigners();
  connectSSE();
  setInterval(() => { refreshRequests(); refreshAudit(); refreshSigners(); }, POLL_MS);
}

boot();
