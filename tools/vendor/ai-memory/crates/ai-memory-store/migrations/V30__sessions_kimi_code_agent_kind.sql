-- Expand sessions.agent_kind CHECK for Kimi Code CLI (Moonshot AI).
--
-- V09/V11/V20/V25/V26/V28 intentionally enumerated every supported agent.
-- Adding a concrete AgentKind must update the persisted CHECK too, or
-- Kimi Code hook events fail at begin_session on upgraded databases (the
-- hook router would WARN and drop the session, silently breaking Kimi Code
-- capture server-side). V28 (the Devin CLI) landed first, so this
-- migration's CHECK list carries 'devin' forward in addition to adding
-- 'kimi-code' — dropping it here would silently break Devin the same way
-- omitting 'kimi-code' would break us.

PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS auto_improve_scheduler_claims_session_pairing_ai;

CREATE TABLE sessions_new (
    id               BLOB PRIMARY KEY NOT NULL,
    workspace_id     BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id       BLOB NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
    agent_kind       TEXT NOT NULL CHECK (agent_kind IN ('claude-code','codex','open-code','cursor','gemini-cli','claude-desktop','openclaw','antigravity-cli','omp','pi','grok','zero','devin','kimi-code','other')),
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
CREATE INDEX idx_sessions_scope_ended
    ON sessions(workspace_id, project_id, ended_at ASC)
    WHERE ended_at IS NOT NULL;

-- Recreate the V18 pairing-enforcement trigger: dropping the old `sessions`
-- table above also dropped its triggers. Every sessions-table rebuild after
-- V18 must reinstate it or the (workspace_id, project_id) pairing invariant
-- silently stops being enforced on inserts.
CREATE TRIGGER sessions_ws_proj_pairing_ai
BEFORE INSERT ON sessions
FOR EACH ROW
WHEN NEW.workspace_id IS NOT (SELECT workspace_id FROM projects WHERE id = NEW.project_id)
BEGIN
    SELECT RAISE(ABORT, 'sessions.workspace_id does not match the project''s workspace');
END;

-- Recreate the V22 claim/session pairing trigger, which references `sessions`
-- and must be dropped before the table rebuild above.
CREATE TRIGGER auto_improve_scheduler_claims_session_pairing_ai
BEFORE INSERT ON auto_improve_scheduler_claims
FOR EACH ROW
WHEN NEW.workspace_id IS NOT (SELECT workspace_id FROM sessions WHERE id = NEW.session_id)
  OR NEW.project_id IS NOT (SELECT project_id FROM sessions WHERE id = NEW.session_id)
BEGIN
    SELECT RAISE(ABORT, 'auto_improve_scheduler_claims scope does not match the session scope');
END;

PRAGMA foreign_keys = ON;
