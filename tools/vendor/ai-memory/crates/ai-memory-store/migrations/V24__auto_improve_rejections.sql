-- Persistent rejection buffer for auto-improvement review feedback.

CREATE TABLE auto_improve_rejections (
    id                         BLOB PRIMARY KEY NOT NULL,
    workspace_id               BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id                 BLOB NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target_path                TEXT,
    kind                       TEXT,
    operation                  TEXT,
    edit_mode                  TEXT,
    reason                     TEXT NOT NULL,
    normalized_fingerprint     TEXT NOT NULL,
    summary                    TEXT NOT NULL,
    evidence_json              TEXT NOT NULL DEFAULT '{}',
    source_run_id              BLOB REFERENCES auto_improve_runs(id) ON DELETE SET NULL,
    source_proposal_id         BLOB REFERENCES auto_improve_proposals(id) ON DELETE SET NULL,
    created_at                 INTEGER NOT NULL
);

CREATE INDEX idx_auto_improve_rejections_scope_recent
    ON auto_improve_rejections(workspace_id, project_id, created_at DESC);
CREATE INDEX idx_auto_improve_rejections_scope_fingerprint
    ON auto_improve_rejections(workspace_id, project_id, normalized_fingerprint, created_at DESC);
CREATE INDEX idx_auto_improve_rejections_scope_path_recent
    ON auto_improve_rejections(workspace_id, project_id, target_path, created_at DESC)
    WHERE target_path IS NOT NULL;

CREATE TRIGGER auto_improve_rejections_ws_proj_pairing_ai
BEFORE INSERT ON auto_improve_rejections
FOR EACH ROW
WHEN NEW.workspace_id IS NOT (SELECT workspace_id FROM projects WHERE id = NEW.project_id)
BEGIN
    SELECT RAISE(ABORT, 'auto_improve_rejections.workspace_id does not match the project''s workspace');
END;
