-- Evidence for the cross-project profile (docs/design-cross-project-profile.md
-- §5.1). The harvester records one row per preference-shaped statement it
-- finds in a contributing project: the user's own prompt, a curated page
-- (`_rules/`, `decisions/`, `gotchas/`, `procedures/`), or a stack signal.
-- Convergence groups these rows across projects into `profile/` pages; the
-- rows themselves are never shown to an agent.
--
-- `contributor` is the qualified identity of whoever said it (the session's
-- `actor_user`, or `user:<username>` for a page author), NULL when shared. A
-- private profile only converges its own operator's rows.
--
-- The UNIQUE key makes a re-harvest idempotent: the same statement from the
-- same source is recorded once.
CREATE TABLE profile_candidates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id  BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id    BLOB NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
    source_kind   TEXT NOT NULL CHECK (source_kind IN ('prompt', 'page', 'stack')),
    source_ref    TEXT NOT NULL,
    topic_key     TEXT NOT NULL,
    category      TEXT NOT NULL,
    statement     TEXT NOT NULL,
    quote         TEXT NOT NULL,
    applies_to    TEXT NOT NULL DEFAULT '[]',
    observed_at   INTEGER NOT NULL,
    contributor   TEXT,
    generality    TEXT NOT NULL CHECK (generality IN ('project', 'general')),
    confidence    REAL NOT NULL DEFAULT 0.5,
    UNIQUE (workspace_id, project_id, source_kind, source_ref, topic_key)
);

CREATE INDEX idx_profile_candidates_observed
    ON profile_candidates (observed_at DESC);

-- How far the harvester has read each project, so a pass only scans what is
-- new: the newest user-prompt observation and the newest curated-page update
-- it has already seen (microseconds, the V01 convention).
-- Every profile page the harvester wrote, in the profile scope that holds it,
-- with the topic it covers and when it was last written. A ledger row whose
-- page no longer exists means the user removed the entry (`ai-memory profile
-- forget`, or a page delete): convergence then leaves that topic alone until
-- the user states it again after `written_at`, instead of recreating it from
-- the same evidence on the next pass.
CREATE TABLE profile_entry_ledger (
    workspace_id  BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id    BLOB NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
    path          TEXT NOT NULL,
    topic_key     TEXT NOT NULL,
    written_at    INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, project_id, path)
);

CREATE TABLE profile_harvest_marks (
    workspace_id        BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id          BLOB NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
    observations_until  INTEGER NOT NULL DEFAULT 0,
    pages_until         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workspace_id, project_id)
);
