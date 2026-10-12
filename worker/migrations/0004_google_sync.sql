CREATE TABLE IF NOT EXISTS google_accounts (sub TEXT PRIMARY KEY, space TEXT NOT NULL UNIQUE, email TEXT);
CREATE TABLE IF NOT EXISTS device_spaces (device_id TEXT PRIMARY KEY, space TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS google_pending (state_hash BLOB PRIMARY KEY, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, space TEXT, name TEXT NOT NULL, platform TEXT NOT NULL, login_hint TEXT, source_scope TEXT, sub TEXT, email TEXT, completed_at INTEGER, claimed_at INTEGER, claim_device TEXT);
CREATE TABLE IF NOT EXISTS decision_versions (scope TEXT NOT NULL, id TEXT NOT NULL, device_id TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(scope,id));
