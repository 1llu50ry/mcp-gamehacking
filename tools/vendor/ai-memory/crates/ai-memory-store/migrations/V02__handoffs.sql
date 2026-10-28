-- Handoff table. A handoff is a typed snapshot of "where we are" so
-- the next agent CLI can pick up. Created on SessionEnd (auto) or
-- explicitly via the memory_handoff_begin MCP tool. Accepted by the
-- next agent via memory_handoff_accept.

CREATE TABLE handoffs (
    id              BLOB PRIMARY KEY NOT NULL,
    workspace_id    BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id      BLOB NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
    from_session_id BLOB,                                   -- references sessions(id), nullable for manual ones
    from_agent      TEXT NOT NULL,
    to_agent        TEXT,                                   -- optional target hint
    cwd             TEXT,
    summary         TEXT NOT NULL,
    open_questions  TEXT NOT NULL DEFAULT '[]',             -- JSON array of strings
    next_steps      TEXT NOT NULL DEFAULT '[]',
    files_touched   TEXT NOT NULL DEFAULT '[]',
    state           TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','accepted','expired')),
    created_at      INTEGER NOT NULL,
    accepted_by     TEXT,
    accepted_at     INTEGER,
    accepted_by_session BLOB,
    FOREIGN KEY (from_session_id) REFERENCES sessions(id) ON DELETE SET NULL,
    FOREIGN KEY (accepted_by_session) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX idx_handoffs_open_recent
    ON handoffs(workspace_id, project_id, created_at DESC)
    WHERE state = 'open';

CREATE INDEX idx_handoffs_cwd_open
    ON handoffs(workspace_id, project_id, cwd, created_at DESC)
    WHERE state = 'open';
