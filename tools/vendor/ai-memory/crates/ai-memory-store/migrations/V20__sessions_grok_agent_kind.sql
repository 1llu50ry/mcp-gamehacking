-- Expand sessions.agent_kind CHECK for xAI Grok Build CLI (`grok`).
--
-- V09/V11 intentionally enumerated every supported agent. Adding a concrete
-- AgentKind must update the persisted CHECK too, or Grok hook events
-- fail at begin_session on upgraded databases (the hook router would WARN
-- and drop the session, silently breaking Grok capture server-side).

PRAGMA foreign_keys = OFF;

CREATE TABLE sessions_new (
    id               BLOB PRIMARY KEY NOT NULL,
    workspace_id     BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id       BLOB NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
    agent_kind       TEXT NOT NULL CHECK (agent_kind IN ('claude-code','codex','open-code','cursor','gemini-cli','claude-desktop','openclaw','antigravity-cli','omp','grok','other')),
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

-- Recreate the V18 pairing-enforcement trigger: dropping the old `sessions`
-- table above also dropped its triggers. V11 did not need this (it predates
-- V18), but every later sessions-table rebuild must reinstate it or the
-- (workspace_id, project_id) pairing invariant silently stops being enforced
-- on inserts — breaking the hook router's split-brain self-heal.
CREATE TRIGGER sessions_ws_proj_pairing_ai
BEFORE INSERT ON sessions
FOR EACH ROW
WHEN NEW.workspace_id IS NOT (SELECT workspace_id FROM projects WHERE id = NEW.project_id)
BEGIN
    SELECT RAISE(ABORT, 'sessions.workspace_id does not match the project''s workspace');
END;

PRAGMA foreign_keys = ON;
