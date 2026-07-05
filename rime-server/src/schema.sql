CREATE TABLE IF NOT EXISTS signers (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    token      TEXT NOT NULL UNIQUE,
    status     TEXT NOT NULL DEFAULT 'active'  -- active | lost | repaired
);

CREATE TABLE IF NOT EXISTS requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient  TEXT NOT NULL,                  -- unified address
    amount_zat INTEGER NOT NULL,
    reason     TEXT NOT NULL,                  -- rides in the encrypted memo
    status     TEXT NOT NULL DEFAULT 'pending',-- pending | quorum | signing | broadcast | failed | rejected
    txid       TEXT,
    created_by INTEGER NOT NULL REFERENCES signers(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approvals (
    request_id INTEGER NOT NULL REFERENCES requests(id),
    signer_id  INTEGER NOT NULL REFERENCES signers(id),
    decision   TEXT NOT NULL,                  -- approve | reject
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (request_id, signer_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event      TEXT NOT NULL,
    detail     TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
