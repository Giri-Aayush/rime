//! rime-server — the treasury workflow engine.
//!
//! Owns the request → approvals → ceremony → broadcast state machine and the
//! audit log. Cryptographic operations are delegated to the ZF reference
//! tools (frost-client, frostd, zcash-sign, zcash-devtool) as subprocesses —
//! see pipeline.rs. The server never touches key shares.

mod config;
mod pipeline;

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
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        cfg,
        events,
    };

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/treasury", get(treasury))
        .route("/api/requests", get(list_requests).post(create_request))
        .route("/api/requests/{id}/decide", post(decide))
        .route("/api/sse-ticket", post(sse_ticket))
        .route("/api/events", get(sse_events))
        .route("/api/audit", get(audit))
        .with_state(state);

    // Default stays loopback; set RIME_BIND=0.0.0.0:8787 for the multi-device
    // demo so phones on the same wifi can reach their signer views.
    let addr = std::env::var("RIME_BIND").unwrap_or_else(|_| "127.0.0.1:8787".into());
    tracing::info!("rime-server listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
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
