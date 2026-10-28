-- M8 retention / access tracking columns.
--
-- The forget sweep needs two signals to compute retention for a page:
-- (a) how long since it was last touched (decay) and (b) how often it
-- gets queried (reinforcement). We track both inline on `pages` to
-- avoid a hot accesses table on the read path.
--
-- `superseded_at` distinguishes the M7 LLM-supersession path (where
-- `supersedes` points to the previous version) from the M8 forget-sweep
-- soft-delete path (where `supersedes IS NULL` and `superseded_at`
-- carries the eviction time). Hard-deletion happens only after
-- `hard_delete_after_days` days WITH zero subsequent access.

ALTER TABLE pages ADD COLUMN last_accessed_at INTEGER;
ALTER TABLE pages ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pages ADD COLUMN superseded_at INTEGER;

-- Hot path: list decay candidates (only is_latest=true rows matter).
CREATE INDEX idx_pages_decay
    ON pages(workspace_id, project_id, updated_at)
    WHERE is_latest = 1;

-- Eviction candidates from prior sweeps (for hard-delete pass).
CREATE INDEX idx_pages_evicted
    ON pages(superseded_at)
    WHERE is_latest = 0 AND supersedes IS NULL AND superseded_at IS NOT NULL;
