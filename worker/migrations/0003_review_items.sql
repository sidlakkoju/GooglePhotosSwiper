CREATE TABLE review_items (
 scope TEXT NOT NULL,
 id TEXT NOT NULL,
 data TEXT NOT NULL,
 PRIMARY KEY (scope, id)
);
INSERT INTO review_items (scope, id, data)
 SELECT review_state.scope, json_extract(item.value, '$.mediaKey'), item.value
 FROM review_state, json_each(review_state.progress, '$.items') AS item;
UPDATE review_state SET progress = json_set(progress, '$.items', json('[]'))
 WHERE json_type(progress, '$.items') = 'array';
