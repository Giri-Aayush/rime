//! rime-server — the treasury workflow engine.
//!
//! Owns the request → approvals → ceremony → broadcast state machine and the
//! audit log. Cryptographic operations are delegated to the ZF reference
//! tools (frost-client, frostd, zcash-sign, zcash-devtool) as subprocesses —
//! see pipeline.rs. The server never touches key shares.

mod balance;
mod config;
mod notify;
mod pipeline;
mod recovery;

use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::sse::{Event, Sse},
    routing::{get, post},
    Json, Router,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use config::RimeConfig;

/// 2-of-3: the number of approvals that triggers a signing ceremony.
const QUORUM: i64 = 2;

type Db = Arc<Mutex<Connection>>;

#[derive(Clone)]
struct AppState {
    db: Db,
    cfg: Option<Arc<RimeConfig>>,
    events: broadcast::Sender<String>,
    discord: Option<String>,
    balance: Arc<balance::BalanceCache>,
}

#[derive(Debug, Deserialize)]
struct NewRequest {
    recipient: String,
    amount_zat: i64,
    reason: String,
    signer_token: String,
}

#[derive(Debug, Deserialize)]
struct Decision {
    signer_token: String,
    decision: String, // "approve" | "reject"
}

#[derive(Debug, Serialize)]
struct PaymentRequest {
    id: i64,
    recipient: String,
    amount_zat: i64,
    reason: String,
    status: String,
    txid: Option<String>,
    approvals: i64,
    created_at: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rime_server=info,tower_http=info".into()),
        )
        .init();

    std::fs::create_dir_all("runtime")?;
    let conn = Connection::open("runtime/rime.db")?;
    conn.execute_batch(include_str!("schema.sql"))?;

    let cfg_path = std::env::var("RIME_SERVER_CONFIG")
        .unwrap_or_else(|_| "runtime/rime-server.toml".into());
    let cfg = match RimeConfig::load(&cfg_path) {
        Ok(c) => {
            tracing::info!(path = %cfg_path, network = %c.network, "signing config loaded");
            Some(Arc::new(c))
        }
        Err(e) => {
            tracing::warn!(path = %cfg_path, "no signing config ({e}); workflow-only mode");
            None
        }
    };
    seed_signers(&conn, cfg.as_deref())?;

    let (events, _) = broadcast::channel(256);
    let discord = notify::resolve(&cfg.as_ref().and_then(|c| c.discord_webhook.clone()));
    if discord.is_some() {
        tracing::info!("discord notifications enabled");
    }
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        cfg,
        events,
        discord,
        balance: Arc::new(balance::BalanceCache::new()),
    };

    let app = build_app(state);

    // Default stays loopback; set RIME_BIND=0.0.0.0:8787 for the multi-device
    // demo so phones on the same wifi can reach their signer views.
    let addr = std::env::var("RIME_BIND").unwrap_or_else(|_| "127.0.0.1:8787".into());
    tracing::info!("rime-server listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

/// Build the router for a given state. Extracted so tests can exercise the
/// full API surface in-process (via `oneshot`) without binding a socket.
fn build_app(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/treasury", get(treasury))
        .route("/api/balance", get(balance_handler))
        .route("/api/requests", get(list_requests).post(create_request))
        .route("/api/requests/{id}/decide", post(decide))
        .route("/api/sse-ticket", post(sse_ticket))
        .route("/api/events", get(sse_events))
        .route("/api/audit", get(audit))
        .route("/api/signers", get(signers))
        .route("/api/signers/{id}/mark-lost", post(mark_lost))
        .route("/api/signers/{id}/repair", post(repair_signer))
        // Serve the built Next.js export when present, else the vanilla
        // fallback UI. Override with RIME_WEB_DIR.
        .fallback_service(tower_http::services::ServeDir::new(
            std::env::var("RIME_WEB_DIR").unwrap_or_else(|_| {
                if std::path::Path::new("frontend/out/index.html").exists() {
                    "frontend/out".into()
                } else {
                    "web".into()
                }
            }),
        ))
        .with_state(state)
}

/// Sync signers from config on every boot (upsert by id) so token rotation
/// and renames in rime-server.toml take effect — a stale token in the DB
/// must never outlive the config that revoked it. Signer `status`
/// (active/lost/repaired) is runtime state and is preserved.
fn seed_signers(conn: &Connection, cfg: Option<&RimeConfig>) -> anyhow::Result<()> {
    match cfg {
        Some(c) => {
            for s in &c.signers {
                conn.execute(
                    "INSERT INTO signers (id, name, token) VALUES (?1, ?2, ?3)
                     ON CONFLICT(id) DO UPDATE SET name = excluded.name, token = excluded.token",
                    rusqlite::params![s.id, s.name, s.token],
                )?;
            }
            // Remove signers that no longer exist in config.
            let ids: Vec<String> = c.signers.iter().map(|s| s.id.to_string()).collect();
            conn.execute(
                &format!("DELETE FROM signers WHERE id NOT IN ({})", ids.join(",")),
                [],
            )?;
        }
        None => {
            let n: i64 = conn.query_row("SELECT COUNT(*) FROM signers", [], |r| r.get(0))?;
            if n == 0 {
                conn.execute_batch(
                    "INSERT INTO signers (id, name, token) VALUES
                        (1, 'Alice', 'dev-token-alice'),
                        (2, 'Bob',   'dev-token-bob'),
                        (3, 'Carol', 'dev-token-carol');",
                )?;
            }
        }
    }
    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "ok": true, "service": "rime-server" }))
}

async fn treasury(
    State(st): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    require_signer(&st.db.lock().unwrap(), &headers, None)?;
    Ok(match &st.cfg {
        Some(c) => Json(json!({
            "network": c.network,
            "address": c.treasury_address,
            "threshold": QUORUM,
            "signers": c.signers.iter().map(|s| &s.name).collect::<Vec<_>>(),
        })),
        None => Json(json!({ "configured": false })),
    })
}

async fn balance_handler(
    State(st): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    require_signer(&st.db.lock().unwrap(), &headers, None)?;
    let Some(cfg) = &st.cfg else {
        return Err((StatusCode::PRECONDITION_FAILED, "no wallet configured".into()));
    };
    match st.balance.get(&cfg.wallet_dir).await {
        Ok(b) => Ok(Json(json!({
            "total_zat": b.total_zat,
            "orchard_zat": b.orchard_zat,
            "height": b.height,
        }))),
        Err(e) => Err((StatusCode::BAD_GATEWAY, e.to_string())),
    }
}

async fn create_request(
    State(st): State<AppState>,
    Json(req): Json<NewRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let db = st.db.lock().unwrap();
    let signer_id = signer_by_token(&db, &req.signer_token)?;
    db.execute(
        "INSERT INTO requests (recipient, amount_zat, reason, created_by) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![req.recipient, req.amount_zat, req.reason, signer_id],
    )
    .map_err(internal)?;
    let id = db.last_insert_rowid();
    log_event(&db, "request.created", &format!("#{id} {} zat: {}", req.amount_zat, req.reason));
    let _ = st.events.send(json!({"request_id": id, "step": "created", "detail": req.reason}).to_string());
    Ok(Json(json!({ "id": id, "status": "pending" })))
}

async fn list_requests(
    State(st): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<PaymentRequest>>, (StatusCode, String)> {
    let db = st.db.lock().unwrap();
    require_signer(&db, &headers, None)?;
    let mut stmt = db
        .prepare(
            "SELECT r.id, r.recipient, r.amount_zat, r.reason, r.status, r.txid, r.created_at,
                    (SELECT COUNT(*) FROM approvals a WHERE a.request_id = r.id AND a.decision = 'approve')
             FROM requests r ORDER BY r.id DESC",
        )
        .map_err(internal)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PaymentRequest {
                id: row.get(0)?,
                recipient: row.get(1)?,
                amount_zat: row.get(2)?,
                reason: row.get(3)?,
                status: row.get(4)?,
                txid: row.get(5)?,
                created_at: row.get(6)?,
                approvals: row.get(7)?,
            })
        })
        .map_err(internal)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(internal)?;
    Ok(Json(rows))
}

async fn decide(
    State(st): State<AppState>,
    Path(id): Path<i64>,
    Json(d): Json<Decision>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if d.decision != "approve" && d.decision != "reject" {
        return Err((StatusCode::BAD_REQUEST, "decision must be approve|reject".into()));
    }
    // All decision handling happens under one DB lock, and the ceremony fires
    // only if THIS call performed the pending→quorum transition (rows == 1).
    // A concurrent approval or a late third approval sees rows == 0 and never
    // double-fires the ceremony.
    let (approvals, status, fire) = {
        let db = st.db.lock().unwrap();
        let signer_id = signer_by_token(&db, &d.signer_token)?;
        db.execute(
            "INSERT OR REPLACE INTO approvals (request_id, signer_id, decision) VALUES (?1, ?2, ?3)",
            rusqlite::params![id, signer_id, d.decision],
        )
        .map_err(internal)?;
        log_event(&db, "request.decision", &format!("#{id} signer {signer_id}: {}", d.decision));

        let approvals: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM approvals WHERE request_id = ?1 AND decision = 'approve'",
                [id],
                |r| r.get(0),
            )
            .map_err(internal)?;

        let mut fire = false;
        if d.decision == "reject" {
            db.execute(
                "UPDATE requests SET status = 'rejected' WHERE id = ?1 AND status = 'pending'",
                [id],
            )
            .map_err(internal)?;
        } else if approvals >= QUORUM {
            let transitioned = db
                .execute(
                    "UPDATE requests SET status = 'quorum' WHERE id = ?1 AND status = 'pending'",
                    [id],
                )
                .map_err(internal)?;
            if transitioned == 1 {
                fire = true;
                log_event(&db, "request.quorum", &format!("#{id} reached {approvals}/{QUORUM}"));
            }
        }
        let status: String = db
            .query_row("SELECT status FROM requests WHERE id = ?1", [id], |r| r.get(0))
            .map_err(|_| (StatusCode::NOT_FOUND, "unknown request".into()))?;
        (approvals, status, fire)
    };

    let _ = st.events.send(
        json!({"request_id": id, "step": "decision", "detail": format!("{} ({approvals}/{QUORUM})", d.decision)})
            .to_string(),
    );

    if fire {
        let reason: String = {
            let db = st.db.lock().unwrap();
            db.query_row("SELECT reason FROM requests WHERE id = ?1", [id], |r| r.get(0))
                .unwrap_or_default()
        };
        notify::ping(
            st.discord.clone(),
            format!("✅ Payment #{id} reached {QUORUM}-of-3 approval — \"{reason}\". Signing now."),
        );
        spawn_ceremony(st.clone(), id);
    }
    Ok(Json(json!({ "id": id, "approvals": approvals, "status": status })))
}

/// Fire the signing pipeline for a request that just reached quorum.
fn spawn_ceremony(st: AppState, id: i64) {
    let Some(cfg) = st.cfg.clone() else {
        let db = st.db.lock().unwrap();
        log_event(&db, "ceremony.skipped", &format!("#{id} quorum reached but server has no signing config"));
        return;
    };

    tokio::spawn(async move {
        // Gather request + the two approvers.
        let (recipient, amount, reason, approver_ids) = {
            let db = st.db.lock().unwrap();
            let row = db
                .query_row(
                    "SELECT recipient, amount_zat, reason FROM requests WHERE id = ?1",
                    [id],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)),
                )
                .expect("request exists");
            let mut stmt = db
                .prepare("SELECT signer_id FROM approvals WHERE request_id = ?1 AND decision = 'approve' ORDER BY created_at LIMIT 2")
                .unwrap();
            let ids: Vec<i64> = stmt.query_map([id], |r| r.get(0)).unwrap().flatten().collect();
            db.execute("UPDATE requests SET status = 'signing' WHERE id = ?1", [id]).ok();
            (row.0, row.1, row.2, ids)
        };
        let approvers: Vec<_> = approver_ids
            .iter()
            .filter_map(|i| cfg.signer_by_id(*i).cloned())
            .collect();

        let db = st.db.clone();
        let events = st.events.clone();
        let progress = move |step: &str, detail: &str| {
            let db = db.lock().unwrap();
            log_event(&db, &format!("ceremony.{step}"), &format!("#{id} {detail}"));
            let _ = events.send(json!({"request_id": id, "step": step, "detail": detail}).to_string());
        };

        let result = pipeline::run(&cfg, id, &recipient, amount, &reason, &approvers, &progress).await;

        let db = st.db.lock().unwrap();
        match result {
            Ok(out) => {
                db.execute(
                    "UPDATE requests SET status = 'broadcast', txid = ?1 WHERE id = ?2",
                    rusqlite::params![out.txid, id],
                )
                .ok();
                log_event(&db, "ceremony.broadcast", &format!("#{id} txid {}", out.txid));
                let _ = st.events.send(json!({"request_id": id, "step": "broadcast", "detail": out.txid}).to_string());
                notify::ping(
                    st.discord.clone(),
                    format!("🧊 Payment #{id} broadcast to Zcash. txid `{}`", out.txid),
                );
            }
            Err(e) => {
                db.execute("UPDATE requests SET status = 'failed' WHERE id = ?1", [id]).ok();
                log_event(&db, "ceremony.failed", &format!("#{id} {e:#}"));
                let _ = st.events.send(json!({"request_id": id, "step": "failed", "detail": e.to_string()}).to_string());
            }
        }
    });
}

/// Issue a single-use, 60-second ticket for the SSE stream. Authenticated
/// with the normal bearer header; the ticket is what goes in the URL, so the
/// real signer token never appears in access logs or browser history.
async fn sse_ticket(
    State(st): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let db = st.db.lock().unwrap();
    let signer_id = require_signer(&db, &headers, None)?;
    db.execute("DELETE FROM sse_tickets WHERE expires_at <= datetime('now')", [])
        .map_err(internal)?;
    let ticket: String = db
        .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
        .map_err(internal)?;
    db.execute(
        "INSERT INTO sse_tickets (ticket, signer_id, expires_at) VALUES (?1, ?2, datetime('now', '+60 seconds'))",
        rusqlite::params![ticket, signer_id],
    )
    .map_err(internal)?;
    Ok(Json(json!({ "ticket": ticket })))
}

async fn sse_events(
    State(st): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, (StatusCode, String)> {
    {
        let db = st.db.lock().unwrap();
        // Bearer header for CLI clients; one-time ?ticket= for EventSource.
        if require_signer(&db, &headers, None).is_err() {
            let ticket = q
                .get("ticket")
                .ok_or((StatusCode::UNAUTHORIZED, "missing ticket".to_string()))?;
            let redeemed = db
                .execute(
                    "DELETE FROM sse_tickets WHERE ticket = ?1 AND expires_at > datetime('now')",
                    [ticket],
                )
                .map_err(internal)?;
            if redeemed != 1 {
                return Err((StatusCode::UNAUTHORIZED, "invalid or expired ticket".into()));
            }
        }
    }
    let rx = st.events.subscribe();
    let stream = BroadcastStream::new(rx)
        .filter_map(|msg| msg.ok())
        .map(|msg| Ok(Event::default().data(msg)));
    Ok(Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default()))
}

async fn audit(
    State(st): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let db = st.db.lock().unwrap();
    require_signer(&db, &headers, None)?;
    let mut stmt = db
        .prepare("SELECT event, detail, created_at FROM audit_log ORDER BY id DESC LIMIT 200")
        .map_err(internal)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({ "event": r.get::<_, String>(0)?, "detail": r.get::<_, String>(1)?, "at": r.get::<_, String>(2)? }))
        })
        .map_err(internal)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(internal)?;
    Ok(Json(json!(rows)))
}

#[derive(Debug, Deserialize)]
struct TokenOnly {
    signer_token: String,
}

async fn signers(
    State(st): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let db = st.db.lock().unwrap();
    require_signer(&db, &headers, None)?;
    let mut stmt = db
        .prepare("SELECT id, name, status FROM signers ORDER BY id")
        .map_err(internal)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "name": r.get::<_, String>(1)?,
                "status": r.get::<_, String>(2)?,
            }))
        })
        .map_err(internal)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(internal)?;
    Ok(Json(json!(rows)))
}

/// Declare a signer's device lost. Their token stops working immediately.
/// Refuses to drop the group below the signing threshold.
async fn mark_lost(
    State(st): State<AppState>,
    Path(id): Path<i64>,
    Json(t): Json<TokenOnly>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let name = {
        let db = st.db.lock().unwrap();
        let actor = signer_by_token(&db, &t.signer_token)?;
        let actor_name: String = db
            .query_row("SELECT name FROM signers WHERE id = ?1", [actor], |r| r.get(0))
            .map_err(internal)?;
        let active: i64 = db
            .query_row("SELECT COUNT(*) FROM signers WHERE status != 'lost'", [], |r| r.get(0))
            .map_err(internal)?;
        if active - 1 < QUORUM {
            return Err((
                StatusCode::CONFLICT,
                format!("cannot mark another signer lost: fewer than {QUORUM} signers would remain"),
            ));
        }
        let changed = db
            .execute("UPDATE signers SET status = 'lost' WHERE id = ?1 AND status != 'lost'", [id])
            .map_err(internal)?;
        if changed != 1 {
            return Err((StatusCode::CONFLICT, "signer is already lost or unknown".into()));
        }
        let name: String = db
            .query_row("SELECT name FROM signers WHERE id = ?1", [id], |r| r.get(0))
            .map_err(internal)?;
        log_event(&db, "recovery.lost", &format!("{name}'s device reported lost by {actor_name}"));
        name
    };
    let _ = st
        .events
        .send(json!({"request_id": 0, "step": "recovery.lost", "detail": name}).to_string());
    Ok(Json(json!({ "id": id, "status": "lost" })))
}

/// Repair a lost signer: the remaining signers regenerate the share (RTS),
/// then every share is rotated so the lost one becomes a dead key.
async fn repair_signer(
    State(st): State<AppState>,
    Path(id): Path<i64>,
    Json(t): Json<TokenOnly>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let Some(cfg) = st.cfg.clone() else {
        return Err((StatusCode::PRECONDITION_FAILED, "server has no signing config".into()));
    };
    let name = {
        let db = st.db.lock().unwrap();
        let actor = signer_by_token(&db, &t.signer_token)?;
        // Recovery must be initiated by a signer other than the lost one, so a
        // single stolen token for the lost device can't drive its own repair.
        if actor == id {
            return Err((
                StatusCode::FORBIDDEN,
                "repair must be initiated by another active signer".into(),
            ));
        }
        let (name, status): (String, String) = db
            .query_row("SELECT name, status FROM signers WHERE id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .map_err(|_| (StatusCode::NOT_FOUND, "unknown signer".to_string()))?;
        if status != "lost" {
            return Err((StatusCode::CONFLICT, format!("{name} is not marked lost")));
        }
        name
    };

    let st2 = st.clone();
    tokio::spawn(async move {
        let emit = |step: &str, detail: &str| {
            let db = st2.db.lock().unwrap();
            log_event(&db, step, detail);
            let _ = st2
                .events
                .send(json!({"request_id": 0, "step": step, "detail": detail}).to_string());
        };
        emit("recovery.repair", &format!("{name}: remaining signers are rebuilding the share"));
        if let Err(e) = recovery::repair(&cfg, id).await {
            emit("recovery.failed", &format!("{name}: {e:#}"));
            return;
        }
        emit("recovery.refresh", "rotating all shares — the lost share becomes a dead key");
        if let Err(e) = recovery::refresh(&cfg).await {
            emit("recovery.failed", &format!("refresh: {e:#}"));
            return;
        }
        {
            let db = st2.db.lock().unwrap();
            db.execute("UPDATE signers SET status = 'active' WHERE id = ?1", [id]).ok();
        }
        emit("recovery.done", &format!("{name} restored on a new device; treasury address unchanged"));
        notify::ping(
            st2.discord.clone(),
            format!("🛟 {name}'s signer was recovered from the other signers. Treasury address unchanged; the old share is now dead."),
        );
    });

    Ok(Json(json!({ "id": id, "status": "repairing" })))
}

/// Authenticate any known signer for read access, via `Authorization:
/// Bearer <token>` or (for EventSource, which cannot set headers) `?token=`.
fn require_signer(
    db: &Connection,
    headers: &HeaderMap,
    query_token: Option<&str>,
) -> Result<i64, (StatusCode, String)> {
    let bearer = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let token = bearer
        .or(query_token)
        .ok_or((StatusCode::UNAUTHORIZED, "missing signer token".to_string()))?;
    signer_by_token(db, token)
}

fn signer_by_token(db: &Connection, token: &str) -> Result<i64, (StatusCode, String)> {
    db.query_row(
        "SELECT id FROM signers WHERE token = ?1 AND status != 'lost'",
        [token],
        |r| r.get(0),
    )
    .map_err(|_| (StatusCode::UNAUTHORIZED, "unknown signer token".into()))
}

fn log_event(db: &Connection, event: &str, detail: &str) {
    let _ = db.execute(
        "INSERT INTO audit_log (event, detail) VALUES (?1, ?2)",
        rusqlite::params![event, detail],
    );
}

fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

#[cfg(test)]
mod tests {
    //! In-process API tests over the real router (via `oneshot`) — no socket,
    //! no external tools. With no signing config the server runs workflow-only,
    //! so the ceremony is skipped and these exercise the money-path state
    //! machine (quorum, guards, auth) deterministically.
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use serde_json::{json, Value};
    use tower::ServiceExt;

    const ALICE: &str = "dev-token-alice";
    const BOB: &str = "dev-token-bob";
    const CAROL: &str = "dev-token-carol";

    fn state(cfg: Option<config::RimeConfig>) -> AppState {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("schema.sql")).unwrap();
        seed_signers(&conn, cfg.as_ref()).unwrap();
        let (events, _) = broadcast::channel(256);
        AppState {
            db: Arc::new(Mutex::new(conn)),
            cfg: cfg.map(Arc::new),
            events,
            discord: None,
            balance: Arc::new(balance::BalanceCache::new()),
        }
    }

    fn mini_cfg() -> config::RimeConfig {
        let signer = |id, name: &str, tok: &str| config::SignerCfg {
            id,
            name: name.into(),
            pubkey: "00".into(),
            frost_config: format!("runtime/{}.toml", name.to_lowercase()),
            token: tok.into(),
        };
        config::RimeConfig {
            network: "test".into(),
            wallet_dir: "runtime/wallet-test".into(),
            group: "00".into(),
            frostd_url: "localhost:2744".into(),
            ca_cert: "runtime/tls/ca.crt".into(),
            runtime_dir: "runtime".into(),
            treasury_address: "utest1demo".into(),
            discord_webhook: None,
            signers: vec![
                signer(1, "Alice", ALICE),
                signer(2, "Bob", BOB),
                signer(3, "Carol", CAROL),
            ],
        }
    }

    async fn send(
        app: &Router,
        method: &str,
        path: &str,
        bearer: Option<&str>,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut b = Request::builder().method(method).uri(path);
        if let Some(t) = bearer {
            b = b.header("authorization", format!("Bearer {t}"));
        }
        let req = match body {
            Some(v) => b
                .header("content-type", "application/json")
                .body(Body::from(v.to_string()))
                .unwrap(),
            None => b.body(Body::empty()).unwrap(),
        };
        let resp = app.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let json = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or(Value::Null)
        };
        (status, json)
    }

    #[tokio::test]
    async fn reads_require_a_signer_token() {
        let app = build_app(state(None));
        let (unauth, _) = send(&app, "GET", "/api/requests", None, None).await;
        assert_eq!(unauth, StatusCode::UNAUTHORIZED);
        let (bad, _) = send(&app, "GET", "/api/requests", Some("nope"), None).await;
        assert_eq!(bad, StatusCode::UNAUTHORIZED);
        let (ok, body) = send(&app, "GET", "/api/requests", Some(ALICE), None).await;
        assert_eq!(ok, StatusCode::OK);
        assert_eq!(body.as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn quorum_fires_once_even_on_a_late_third_approval() {
        let app = build_app(state(None)); // no cfg → ceremony skipped, status stays "quorum"
        let (c, _) = send(
            &app,
            "POST",
            "/api/requests",
            None,
            Some(json!({"recipient":"utest1x","amount_zat":50000,"reason":"t","signer_token":BOB})),
        )
        .await;
        assert_eq!(c, StatusCode::OK);

        let approve = |tok: &'static str| {
            let app = app.clone();
            async move {
                send(
                    &app,
                    "POST",
                    "/api/requests/1/decide",
                    None,
                    Some(json!({"signer_token":tok,"decision":"approve"})),
                )
                .await
            }
        };
        let (_, a1) = approve(ALICE).await;
        assert_eq!(a1["approvals"], 1);
        assert_eq!(a1["status"], "pending");
        let (_, a2) = approve(BOB).await;
        assert_eq!(a2["approvals"], 2);
        assert_eq!(a2["status"], "quorum");
        // late third approval must NOT re-fire the ceremony
        let (_, a3) = approve(CAROL).await;
        assert_eq!(a3["approvals"], 3);

        let (_, audit) = send(&app, "GET", "/api/audit", Some(ALICE), None).await;
        let quorum_events = audit
            .as_array()
            .unwrap()
            .iter()
            .filter(|r| r["event"] == "request.quorum")
            .count();
        assert_eq!(quorum_events, 1, "quorum must fire exactly once");
    }

    #[tokio::test]
    async fn reject_marks_the_request_rejected() {
        let app = build_app(state(None));
        send(
            &app,
            "POST",
            "/api/requests",
            None,
            Some(json!({"recipient":"utest1x","amount_zat":1,"reason":"t","signer_token":BOB})),
        )
        .await;
        let (_, d) = send(
            &app,
            "POST",
            "/api/requests/1/decide",
            None,
            Some(json!({"signer_token":ALICE,"decision":"reject"})),
        )
        .await;
        assert_eq!(d["status"], "rejected");
    }

    #[tokio::test]
    async fn mark_lost_refuses_to_drop_below_threshold_and_revokes_the_token() {
        let app = build_app(state(None));
        let (a, _) = send(
            &app,
            "POST",
            "/api/signers/3/mark-lost",
            None,
            Some(json!({"signer_token":ALICE})),
        )
        .await;
        assert_eq!(a, StatusCode::OK);
        // Carol's token is now revoked
        let (revoked, _) = send(&app, "GET", "/api/requests", Some(CAROL), None).await;
        assert_eq!(revoked, StatusCode::UNAUTHORIZED);
        // marking a second signer lost would leave <2 → refused
        let (b, _) = send(
            &app,
            "POST",
            "/api/signers/2/mark-lost",
            None,
            Some(json!({"signer_token":ALICE})),
        )
        .await;
        assert_eq!(b, StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn repair_requires_config_and_a_lost_target() {
        // no cfg → repair is a precondition failure
        let app = build_app(state(None));
        let (no_cfg, _) = send(
            &app,
            "POST",
            "/api/signers/3/repair",
            None,
            Some(json!({"signer_token":ALICE})),
        )
        .await;
        assert_eq!(no_cfg, StatusCode::PRECONDITION_FAILED);

        // with cfg but the target isn't lost → conflict (no ceremony spawned)
        let app = build_app(state(Some(mini_cfg())));
        let (not_lost, _) = send(
            &app,
            "POST",
            "/api/signers/1/repair",
            None,
            Some(json!({"signer_token":BOB})),
        )
        .await;
        assert_eq!(not_lost, StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn sse_requires_auth_and_rejects_bad_tickets() {
        let app = build_app(state(None));
        let (t_unauth, _) = send(&app, "POST", "/api/sse-ticket", None, None).await;
        assert_eq!(t_unauth, StatusCode::UNAUTHORIZED);
        let (ev_bad, _) = send(&app, "GET", "/api/events?ticket=deadbeef", None, None).await;
        assert_eq!(ev_bad, StatusCode::UNAUTHORIZED);
    }
}
