-- Initial ai-memory schema.
-- Identity is the 3-tuple (workspace_id, project_id, path) on every domain
-- table, baked in from M1 so we never inherit basic-memory's v0.20 retrofit
-- pain (issues #783, #834 and friends).

CREATE TABLE workspaces (
    id            BLOB PRIMARY KEY NOT NULL,
    name          TEXT NOT NULL UNIQUE,
    created_at    INTEGER NOT NULL                       -- microseconds since epoch
);

CREATE TABLE projects (
    id            BLOB PRIMARY KEY NOT NULL,
    workspace_id  BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    repo_path     TEXT,                                  -- absolute filesystem path, for cwd matching
    created_at    INTEGER NOT NULL,
    UNIQUE (workspace_id, name)
);

CREATE INDEX idx_projects_workspace ON projects(workspace_id);

CREATE TABLE pages (
    id                  BLOB PRIMARY KEY NOT NULL,
    workspace_id        BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id          BLOB NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
    path                TEXT NOT NULL,                  -- POSIX path relative to wiki/
    title               TEXT NOT NULL,
    tier                TEXT NOT NULL CHECK (tier IN ('working','episodic','semantic','procedural')),
    body                TEXT NOT NULL,
    body_sha256         BLOB NOT NULL,                  -- 32 bytes
    frontmatter_json    TEXT NOT NULL DEFAULT '{}',
    is_latest           INTEGER NOT NULL DEFAULT 1 CHECK (is_latest IN (0,1)),
    supersedes          BLOB REFERENCES pages(id) ON DELETE SET NULL,
    pinned              INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    -- Embedding columns are NULL through v1 (M9 fills them in).
    embedding_provider  TEXT,
    embedding_model     TEXT,
    embedding_dim       INTEGER
);

-- One latest version per (workspace, project, path). Older versions stay in
-- the table with is_latest=0, linked via supersedes.
CREATE UNIQUE INDEX idx_pages_latest_path
    ON pages(workspace_id, project_id, path)
    WHERE is_latest = 1;

CREATE INDEX idx_pages_updated ON pages(updated_at DESC);
CREATE INDEX idx_pages_supersedes ON pages(supersedes) WHERE supersedes IS NOT NULL;

-- FTS5 over title + body. `content='pages'` keeps the FTS table contentless
-- (the source row owns the text); the triggers below propagate changes.
CREATE VIRTUAL TABLE pages_fts USING fts5(
    title, body,
    content='pages',
    content_rowid='rowid',
    tokenize="unicode61 tokenchars '/_-'"
);

CREATE TRIGGER pages_fts_ai AFTER INSERT ON pages BEGIN
    INSERT INTO pages_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER pages_fts_ad AFTER DELETE ON pages BEGIN
    INSERT INTO pages_fts(pages_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER pages_fts_au AFTER UPDATE ON pages BEGIN
    INSERT INTO pages_fts(pages_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
    INSERT INTO pages_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
END;

CREATE TABLE sessions (
    id               BLOB PRIMARY KEY NOT NULL,
    workspace_id     BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id       BLOB NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
    agent_kind       TEXT NOT NULL CHECK (agent_kind IN ('claude-code','codex','open-code','other')),
    cwd              TEXT,
    started_at       INTEGER NOT NULL,
    ended_at         INTEGER,
    summary_page_id  BLOB REFERENCES pages(id) ON DELETE SET NULL
);

CREATE INDEX idx_sessions_recent ON sessions(workspace_id, project_id, started_at DESC);

CREATE TABLE observations (
    id            BLOB PRIMARY KEY NOT NULL,
    session_id    BLOB NOT NULL REFERENCES sessions(id)   ON DELETE CASCADE,
    workspace_id  BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id    BLOB NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
    kind          TEXT NOT NULL,
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    importance    INTEGER NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
    created_at    INTEGER NOT NULL
);

CREATE INDEX idx_observations_session ON observations(session_id, created_at);

CREATE TABLE links (
    from_page_id  BLOB NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    to_page_id    BLOB REFERENCES pages(id) ON DELETE SET NULL,
    to_path       TEXT NOT NULL,                       -- raw target, may be unresolved
    link_type     TEXT NOT NULL DEFAULT 'references',
    PRIMARY KEY (from_page_id, to_path, link_type)
);

CREATE INDEX idx_links_to ON links(to_page_id) WHERE to_page_id IS NOT NULL;

CREATE TABLE audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    at            INTEGER NOT NULL,
    op            TEXT NOT NULL,
    workspace_id  BLOB,
    project_id    BLOB,
    page_id       BLOB,
    detail        TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_audit_recent ON audit_log(at DESC);
