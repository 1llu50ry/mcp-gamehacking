-- Background auto-improvement scheduler state and lookup indexes.

CREATE TABLE auto_improve_scheduler_state (
    workspace_id        BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id          BLOB NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    watermark_ended_at  INTEGER NOT NULL,
    initialized_at      INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, project_id)
);

CREATE TABLE auto_improve_scheduler_claims (
    workspace_id        BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id          BLOB NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id          BLOB NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    claimed_at          INTEGER NOT NULL,
    PRIMARY KEY (session_id)
);

CREATE INDEX idx_auto_improve_scheduler_claims_scope_session
    ON auto_improve_scheduler_claims(workspace_id, project_id, session_id);

CREATE INDEX idx_sessions_scope_ended
    ON sessions(workspace_id, project_id, ended_at ASC)
    WHERE ended_at IS NOT NULL;

CREATE INDEX idx_auto_improve_runs_scope_session
    ON auto_improve_runs(workspace_id, project_id, session_id)
    WHERE session_id IS NOT NULL;

CREATE TRIGGER auto_improve_scheduler_state_ws_proj_pairing_ai
BEFORE INSERT ON auto_improve_scheduler_state
FOR EACH ROW
WHEN NEW.workspace_id IS NOT (SELECT workspace_id FROM projects WHERE id = NEW.project_id)
BEGIN
    SELECT RAISE(ABORT, 'auto_improve_scheduler_state.workspace_id does not match the project''s workspace');
END;

CREATE TRIGGER auto_improve_scheduler_claims_ws_proj_pairing_ai
BEFORE INSERT ON auto_improve_scheduler_claims
FOR EACH ROW
WHEN NEW.workspace_id IS NOT (SELECT workspace_id FROM projects WHERE id = NEW.project_id)
BEGIN
    SELECT RAISE(ABORT, 'auto_improve_scheduler_claims.workspace_id does not match the project''s workspace');
END;

CREATE TRIGGER auto_improve_scheduler_claims_session_pairing_ai
BEFORE INSERT ON auto_improve_scheduler_claims
FOR EACH ROW
WHEN NEW.workspace_id IS NOT (SELECT workspace_id FROM sessions WHERE id = NEW.session_id)
  OR NEW.project_id IS NOT (SELECT project_id FROM sessions WHERE id = NEW.session_id)
BEGIN
    SELECT RAISE(ABORT, 'auto_improve_scheduler_claims scope does not match the session scope');
END;
