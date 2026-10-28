-- Cascade-delete performance indexes.
--
-- Schema audit (pre-V05) findings:
--
-- PRAGMA foreign_keys status
-- --------------------------
-- The writer connection has PRAGMA foreign_keys = ON set in Store::open()
-- before the writer thread is spawned — correct. Reader connections are
-- opened read-only and never trigger cascades, so no change needed there.
--
-- Missing indexes identified
-- --------------------------
-- For DELETE FROM projects WHERE id = ?, SQLite walks every dependent table
-- looking for rows with a matching FK column. Without an index on the FK
-- column, each dependent table requires a full-table scan. The tables that
-- REFERENCES projects(id) ON DELETE CASCADE are:
--   pages              — project_id (no standalone index; idx_pages_latest_path
--                        is on (workspace_id, project_id, path) WHERE is_latest=1
--                        and cannot be used for an unfiltered project_id scan)
--   sessions           — project_id (idx_sessions_recent covers the prefix
--                        only when workspace_id is also known)
--   observations       — project_id (idx_observations_session is on session_id
--                        only; no project_id index at all)
--   handoffs           — project_id (both handoff indexes are partial/filtered;
--                        not usable for an unfiltered project_id scan)
--
-- page_embeddings REFERENCES pages(id) ON DELETE CASCADE is covered by the
-- PRIMARY KEY on page_id — no additional index needed.
--
-- links(from_page_id) REFERENCES pages(id) ON DELETE CASCADE is covered by
-- the PRIMARY KEY on from_page_id — no additional index needed.
--
-- Other schema oddities noted (not fixed here — no behaviour change needed):
--   - audit_log has no FK on workspace_id/project_id/page_id (nullable BLOBs
--     with no REFERENCES clause). Intentional: the audit log is an append-only
--     event log; orphan rows are acceptable and expected.
--   - handoffs.from_session_id is nullable (manual handoffs have no session);
--     the SET NULL cascade on sessions(id) is correct.
--   - observations has workspace_id denormalised alongside project_id; both
--     carry REFERENCES … ON DELETE CASCADE so a workspace delete cascades
--     through the workspace FK independently of the project FK. Correct.

CREATE INDEX IF NOT EXISTS idx_pages_project
    ON pages(project_id);

CREATE INDEX IF NOT EXISTS idx_sessions_project
    ON sessions(project_id);

CREATE INDEX IF NOT EXISTS idx_observations_project
    ON observations(project_id);

CREATE INDEX IF NOT EXISTS idx_handoffs_project
    ON handoffs(project_id);
