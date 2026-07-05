# Rime — Code Review

**Reviewer:** senior SDE pass · **Date:** 2026-07-06
**Scope:** whole repo — `rime-server`, `rime-signer`, `rime-repair` (Rust), `frontend/` (Next.js), `web/` (vanilla fallback UI), `scripts/`, build/deploy config.

## Verdict

The code that exists is genuinely well-crafted: clean module boundaries, comments that explain *why* (the quorum-transition guard, the SSE-ticket rationale, the RTS placeholder-commitment trick), real security reasoning, and honest `NOTE`s where a shortcut was taken. Clippy was already near-clean (5 style lints, no item-level dead code). The gap between "reads senior" and "is senior-grade" is **discipline around the code** — tests, a non-poisoning DB layer, CI — not the code itself.

This review **removed the genuinely dead code** (verified below) and **reports** the items that are judgment calls or architectural changes rather than silently rewriting them.

---

## Part 1 — Removed (done, verified)

All changes verified green: `cargo clippy --all-targets` → **0 warnings**, `tsc --noEmit` → **0 errors**. Net **−17 lines** across 7 files.

| # | What | Where | Why it was dead |
|---|------|-------|-----------------|
| 1 | `require_signer`'s `query_token` param + the `.or(query_token)` branch | `rime-server/src/main.rs` | Passed `None` at all 7 call sites; no client uses `?token=` auth. The doc comment advertised a `?token=` path that doesn't exist — EventSource actually authenticates through the single-use ticket flow. Removed the param + dead branch, corrected the doc. |
| 2 | Exports `POLL_MS`, `REQUEST_STATUSES` | `frontend/src/lib/rime.ts` | Defined, referenced nowhere (the hook has its own poll interval). |
| 3 | Export `COIN` | `frontend/src/lib/types.ts` | Defined, referenced nowhere. |
| 4 | Runtime dependency `shadcn` | `frontend/package.json` | `shadcn` is the component-generator **CLI**, mis-listed under `dependencies`; 0 imports. It should never ship in the bundle. |
| 5 | `tower-http` `"trace"` feature + `tower_http=info` log directive | `rime-server/Cargo.toml`, `main.rs` | Only `ServeDir` (the `"fs"` feature) is used; no `TraceLayer` is mounted, so the feature and its log filter were inert. |
| 6 | 5 clippy lints → 0 | `rime-repair/src/main.rs` (×2), `rime-server/src/pipeline.rs` (×3) | 2× `needless_question_mark`; 3× `doc_overindented_list_items` — fixed by wrapping the pipeline diagram in a ` ```text ` fence, which keeps the author's visual alignment *and* satisfies the lint (so a future `-D warnings` gate stays green). |

**Verified NOT dead (left in place):**
- `rime-signer` — a working CLI approval agent (`watch`/`pending`/`approve`/`reject`), built and installed by the Dockerfile. Real, wired.
- `recovery.rs`, `config.rs`, `balance.rs`, `notify.rs` — all reachable, no dead items.
- All frontend components — every one under `components/` is imported and rendered.

---

## Part 2 — Found, NOT auto-removed (your call)

Ranked by severity. These are either architectural (change error/behavior semantics) or product decisions — I flagged them rather than rewriting.

### 🔴 High

**H1 · Zero tests, anywhere.** No `#[test]`/`#[tokio::test]` in Rust, no `*.test.*` in the frontend. The 2-of-3 quorum-transition guard (`transitioned == 1` in [`decide`](rime-server/src/main.rs)), `hex_tokens` parsing, balance-line parsing, and the RTS `repair`/`refresh` crypto are all unverified. This is the single biggest gap. → *Recommend: unit tests for the quorum state machine + `hex_tokens` + balance parsing first; they're pure and high-value.*

**H2 · `Arc<Mutex<Connection>>` as the whole DB layer.** Three problems: **(a) poisoning** — a panic in any handler while holding the lock poisons the mutex, and every subsequent `.lock().unwrap()` then panics → the server is effectively dead; **(b) serialization** — one global lock means every read blocks every other read; **(c)** synchronous `rusqlite` calls run on async runtime threads with no `spawn_blocking`. Fine at demo scale, not a production-senior choice. → *Recommend: `deadpool-sqlite`/`r2d2` pool, or at minimum `parking_lot::Mutex` (no poisoning) as a one-line stopgap.*

### 🟡 Medium

**M1 · `unwrap`/`expect` in the ceremony path.** In `spawn_ceremony` ([main.rs](rime-server/src/main.rs)): `.expect("request exists")` and two `.unwrap()`s on the statement/rows. On a deleted or malformed row these panic the spawned task instead of transitioning the request to `failed`. → *Recommend: return an error and route it through the existing `status = 'failed'` path.* (The `.expect("piped")` calls in `pipeline.rs` are fine — those are genuinely infallible right after `Stdio::piped()`.)

**M2 · Test-support dev-deps with no tests.** `tower` + `http-body-util` are declared under `[dev-dependencies]` in `rime-server/Cargo.toml` but nothing uses them (there are no tests). They're currently dead — but they're exactly the crates axum handler tests need. → *Decision: write the tests (preferred, resolves H1 too) or drop the deps.*

**M3 · Two parallel UIs.** `web/` (≈76 KB vanilla JS/CSS) and `frontend/` (Next.js) render the same product. `web/` is a **documented fallback** (served only when `frontend/out/` is absent), so it is *not* strictly dead — but it is duplicate maintenance surface, and the two will drift. **I did not delete it** — it's working, reachable code and removing a whole alternate UI is a product decision, not a dead-code cleanup. → *Recommend: consciously pick one; if `web/` is kept only as a "no-build" fallback, say so in the README and freeze it.*

**M4 · No CI, no `rustfmt.toml`/clippy config.** Nothing gates a regression, a formatting drift, or re-introduced warnings. → *Recommend: a minimal GH Actions workflow — `cargo fmt --check`, `cargo clippy -D warnings`, `cargo build`, `tsc --noEmit`.*

### 🟢 Low

**L1 · String-interpolated SQL.** `seed_signers` builds `DELETE FROM signers WHERE id NOT IN (...)` by joining ids into the query string ([main.rs](rime-server/src/main.rs)). Safe *only* because the ids are `i64` from config, not user input — but it's a pattern to avoid on reflex. → *Recommend: bind parameters.*

---

## How this was checked

- `cargo clippy --all-targets` (authoritative for Rust item-level dead code + lints)
- `tsc --noEmit` (frontend type integrity after export removal)
- Manual call-site tracing for dead *parameters* and dead *branches* (which the compiler can't flag)
- Per-symbol reference counting for unused exports; per-dependency import counting for dead deps
- Wiring checks (Dockerfile/Makefile/compose/scripts) to distinguish dead binaries from live ones
