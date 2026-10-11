CREATE TABLE decisions (
 scope TEXT NOT NULL,
 id TEXT NOT NULL,
 decision TEXT NOT NULL CHECK (decision IN ('keep', 'remove')),
 PRIMARY KEY (scope, id)
);
CREATE TABLE review_state (
 scope TEXT PRIMARY KEY,
 progress TEXT NOT NULL DEFAULT '{}',
 history TEXT NOT NULL DEFAULT '[]'
);
