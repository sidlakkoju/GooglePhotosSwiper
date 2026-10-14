ALTER TABLE decision_versions ADD COLUMN changed_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS decision_versions_scope_changed ON decision_versions (scope, changed_at);
