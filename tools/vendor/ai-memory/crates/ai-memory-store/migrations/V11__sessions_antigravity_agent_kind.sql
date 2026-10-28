-- Expand sessions.agent_kind CHECK for Antigravity CLI (`agy`).
--
-- V09 intentionally enumerated every supported agent. Adding a concrete
-- AgentKind must update the persisted CHECK too, or Antigravity hook events
-- fail at begin_session on upgraded databases.

PRAGMA foreign_keys = OFF;

CREATE TABLE sessions_new (
    id               BLOB PRIMARY KEY NOT NULL,
    workspace_id     BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id       BLOB NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
    agent_kind       TEXT NOT NULL CHECK (agent_kind IN ('claude-code','codex','open-code','cursor','gemini-cli','claude-desktop','openclaw','antigravity-cli','omp','other')),
    cwd              TEXT,
    started_at       INTEGER NOT NULL,
    ended_at         INTEGER,
    summary_page_id  BLOB REFERENCES pages(id) ON DELETE SET NULL
);

INSERT INTO sessions_new SELECT * FROM sessions;

DROP TABLE sessions;

ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_sessions_recent ON sessions(workspace_id, project_id, started_at DESC);
CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_started_at ON sessions(started_at DESC);

PRAGMA foreign_keys = ON;
