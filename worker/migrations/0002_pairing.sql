CREATE TABLE devices (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 platform TEXT NOT NULL,
 token_hash BLOB UNIQUE,
 created_at INTEGER NOT NULL,
 last_seen_at INTEGER NOT NULL,
 revoked_at INTEGER,
 is_legacy INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE pairing_codes (
 id TEXT PRIMARY KEY,
 code_hash BLOB NOT NULL UNIQUE,
 short_hash BLOB NOT NULL,
 expires_at INTEGER NOT NULL,
 used_at INTEGER,
 failed_attempts INTEGER NOT NULL DEFAULT 0,
 created_by_device TEXT NOT NULL REFERENCES devices(id),
 claimed_device TEXT
);
CREATE UNIQUE INDEX live_pairing_short ON pairing_codes(short_hash) WHERE used_at IS NULL;
CREATE UNIQUE INDEX live_pairing_device ON pairing_codes(created_by_device) WHERE used_at IS NULL;
CREATE TABLE pair_attempts (
 ip_hash BLOB NOT NULL,
 window_start INTEGER NOT NULL,
 count INTEGER NOT NULL,
 PRIMARY KEY (ip_hash, window_start)
);
