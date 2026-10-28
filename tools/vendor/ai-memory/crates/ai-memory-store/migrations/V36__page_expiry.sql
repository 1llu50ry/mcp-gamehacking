-- Per-page TTL. `expires_at` (microseconds since epoch, UTC) is derived
-- from the frontmatter `expires_at:` key — markdown stays the source of
-- truth and a reindex rebuilds this column. NULL = never expires.
-- Expired pages are hidden from search/recent/briefing and hard-deleted
-- (file + rows) by the retention sweep.
ALTER TABLE pages ADD COLUMN expires_at INTEGER;

CREATE INDEX idx_pages_expiry ON pages(expires_at)
    WHERE is_latest = 1 AND expires_at IS NOT NULL;
