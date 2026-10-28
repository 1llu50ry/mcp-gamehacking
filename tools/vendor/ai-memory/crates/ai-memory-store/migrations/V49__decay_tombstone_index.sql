-- A decay tombstone is identified by superseded_at, the only column written
-- by the forget-sweep eviction path. Rewritten page heads legitimately carry
-- a non-NULL supersedes pointer, so filtering those rows out made their
-- tombstones permanent and left this partial index unusable by the corrected
-- cleanup query.
DROP INDEX idx_pages_evicted;

CREATE INDEX idx_pages_evicted
    ON pages(workspace_id, project_id, superseded_at)
    WHERE is_latest = 0 AND superseded_at IS NOT NULL;
