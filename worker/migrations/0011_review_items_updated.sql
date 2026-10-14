ALTER TABLE review_items ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS review_items_scope_updated ON review_items (scope, updated_at);
