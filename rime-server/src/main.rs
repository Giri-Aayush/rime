//! rime-server — the treasury workflow engine.
//!
//! Owns the request → approvals → ceremony → broadcast state machine and the
//! audit log. Cryptographic operations are delegated to the frozen scripts in
//! `scripts/`, which wrap the Zcash Foundation's reference tools
//! (frost-client, frostd, zcash-sign, zcash-devtool). The server never touches
//! key shares.

use std::sync::{Arc, Mutex};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// 2-of-3: the number of approvals that triggers a signing ceremony.
const QUORUM: i64 = 2;

type Db = Arc<Mutex<Connection>>;

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
    seed_signers(&conn)?;
    let db: Db = Arc::new(Mutex::new(conn));

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/requests", get(list_requests).post(create_request))
        .route("/api/requests/{id}/decide", post(decide))
        .route("/api/audit", get(audit))
        .with_state(db);

    let addr = "127.0.0.1:8787";
    tracing::info!("rime-server listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

/// Demo signers. Tokens are placeholders until real per-signer provisioning
/// lands with the signer daemons.
fn seed_signers(conn: &Connection) -> anyhow::Result<()> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM signers", [], |r| r.get(0))?;
    if n == 0 {
        conn.execute_batch(
            "INSERT INTO signers (id, name, token) VALUES
                (1, 'Alice', 'dev-token-alice'),
                (2, 'Bob',   'dev-token-bob'),
                (3, 'Carol', 'dev-token-carol');",
        )?;
    }
    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "ok": true, "service": "rime-server" }))
}

async fn create_request(
    State(db): State<Db>,
    Json(req): Json<NewRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let db = db.lock().unwrap();
    let signer_id = signer_by_token(&db, &req.signer_token)?;
    db.execute(
        "INSERT INTO requests (recipient, amount_zat, reason, created_by) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![req.recipient, req.amount_zat, req.reason, signer_id],
    )
    .map_err(internal)?;
    let id = db.last_insert_rowid();
    log_event(&db, "request.created", &format!("#{id} {} zat: {}", req.amount_zat, req.reason));
    Ok(Json(json!({ "id": id, "status": "pending" })))
}

async fn list_requests(State(db): State<Db>) -> Result<Json<Vec<PaymentRequest>>, (StatusCode, String)> {
    let db = db.lock().unwrap();
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
    State(db): State<Db>,
    Path(id): Path<i64>,
    Json(d): Json<Decision>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    if d.decision != "approve" && d.decision != "reject" {
        return Err((StatusCode::BAD_REQUEST, "decision must be approve|reject".into()));
    }
    let db = db.lock().unwrap();
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

    let mut status = "pending".to_string();
    if d.decision == "reject" {
        status = "rejected".into();
    } else if approvals >= QUORUM {
        status = "quorum".into();
        log_event(&db, "request.quorum", &format!("#{id} reached {approvals}/{QUORUM} — ceremony pending"));
        // TODO(Jul 6): trigger the signing ceremony pipeline (scripts/40..60)
        // as a tokio task: pczt create → zcash-sign → frost-client rounds →
        // prove/combine/send, streaming progress over SSE.
    }
    db.execute("UPDATE requests SET status = ?1 WHERE id = ?2 AND status = 'pending'",
        rusqlite::params![status, id])
        .map_err(internal)?;
    Ok(Json(json!({ "id": id, "approvals": approvals, "status": status })))
}

async fn audit(State(db): State<Db>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let db = db.lock().unwrap();
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
