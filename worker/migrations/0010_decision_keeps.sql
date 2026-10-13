CREATE TABLE IF NOT EXISTS decision_keeps (scope TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(scope,id));
INSERT OR IGNORE INTO decision_keeps (scope,id,updated_at) SELECT d.scope,d.id,COALESCE(v.updated_at,0) FROM decisions d LEFT JOIN decision_versions v ON v.scope = d.scope AND v.id = d.id WHERE d.decision = 'keep';
