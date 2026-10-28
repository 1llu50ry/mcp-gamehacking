-- Explicit feedback on retrieval quality, and the per-page salience it
-- drives. Until now the only reinforcement signal was the coarse
-- `access_count` / `last_accessed_at` bump every search hit produced;
-- the retention formula multiplied a single global `salience_default`.
--
-- `pages.salience` is NULL for every existing page, which the decay
-- math reads as "use salience_default" — so behaviour is unchanged
-- until a page actually receives feedback. It is a derived value:
-- `page_feedback` is the append-only source of truth. Each row stores
-- the post-signal salience so the derived page value can be rebuilt even
-- if the configured default changes later.
--
-- Feedback attaches to a page *version* (`page_id`), so rewriting a
-- flagged page retires both its salience and its lint findings: the
-- rows stay for audit but point at an `is_latest = 0` version, which
-- the lint query's `is_latest = 1` join filters out. That is the
-- resolution path — there is no separate "dismiss" state.
ALTER TABLE pages ADD COLUMN salience REAL;

CREATE TABLE page_feedback (
    id            BLOB PRIMARY KEY,
    page_id       BLOB NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    workspace_id  BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id    BLOB NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- helpful / not_helpful move salience; stale / wrong additionally
    -- surface the page in memory_lint reports.
    kind          TEXT NOT NULL CHECK (kind IN ('helpful', 'not_helpful', 'stale', 'wrong')),
    reason        TEXT,
    salience_after REAL NOT NULL CHECK (salience_after BETWEEN 0.25 AND 2.0),
    author_id     BLOB REFERENCES users(id) ON DELETE SET NULL,
    created_at    INTEGER NOT NULL
);

CREATE INDEX idx_page_feedback_page ON page_feedback(page_id, created_at DESC);
CREATE INDEX idx_page_feedback_scope ON page_feedback(workspace_id, project_id, created_at DESC);
