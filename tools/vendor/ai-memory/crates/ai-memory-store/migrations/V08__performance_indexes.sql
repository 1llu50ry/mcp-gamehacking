-- Performance indexes and narrower FTS maintenance for growing stores.
--
-- These are additive except for the FTS update trigger. Page title/body are
-- the only columns mirrored into pages_fts, so metadata-only updates should
-- not delete/reinsert FTS rows.

DROP TRIGGER IF EXISTS pages_fts_au;

CREATE TRIGGER pages_fts_au AFTER UPDATE OF title, body ON pages BEGIN
    INSERT INTO pages_fts(pages_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
    INSERT INTO pages_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
END;

-- Incoming-link refresh repoints all links matching a path, not only currently
-- unresolved links. The partial unresolved index from V07 cannot serve that.
CREATE INDEX IF NOT EXISTS idx_links_to_path ON links(to_path);

-- Briefing/explore activity windows and latest-observation lookups are ordered
-- by time across the whole store and per project.
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_created_at ON observations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_project_created
    ON observations(workspace_id, project_id, created_at DESC);

-- Recent-page queries only consider latest rows. Keep superseded history out
-- of the hot ordered scan.
CREATE INDEX IF NOT EXISTS idx_pages_latest_updated
    ON pages(updated_at DESC)
    WHERE is_latest = 1;
CREATE INDEX IF NOT EXISTS idx_pages_project_latest_updated
    ON pages(workspace_id, project_id, updated_at DESC)
    WHERE is_latest = 1;
