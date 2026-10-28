-- DB-authoritative pending auto-improvement proposal state.

CREATE TABLE auto_improve_runs (
    id                        BLOB PRIMARY KEY NOT NULL,
    workspace_id              BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id                BLOB NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id                BLOB REFERENCES sessions(id) ON DELETE SET NULL,
    provider                  TEXT,
    model                     TEXT,
    summary                   TEXT,
    warnings_json             TEXT NOT NULL DEFAULT '[]',
    rejected_candidates_json  TEXT NOT NULL DEFAULT '[]',
    config_json               TEXT NOT NULL DEFAULT '{}',
    proposal_actor_json       TEXT NOT NULL,
    created_at                INTEGER NOT NULL
);

CREATE TABLE auto_improve_proposals (
    id                              BLOB PRIMARY KEY NOT NULL,
    run_id                          BLOB NOT NULL REFERENCES auto_improve_runs(id) ON DELETE CASCADE,
    workspace_id                    BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id                      BLOB NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status                          TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','conflict','failed')),
    operation                       TEXT NOT NULL CHECK (operation IN ('create','update')),
    target_path                     TEXT NOT NULL,
    kind                            TEXT NOT NULL,
    title                           TEXT NOT NULL,
    confidence                      REAL NOT NULL,
    rationale                       TEXT NOT NULL,
    evidence_json                   TEXT NOT NULL DEFAULT '[]',
    body_markdown                   TEXT NOT NULL,
    body_sha256                     BLOB NOT NULL,
    artifact_path                   TEXT NOT NULL,
    artifact_sha256                 BLOB,
    target_latest_page_id_at_stage  BLOB REFERENCES pages(id) ON DELETE SET NULL,
    target_body_sha256_at_stage     BLOB,
    target_updated_at_at_stage      INTEGER,
    staged_at                       INTEGER NOT NULL,
    decided_at                      INTEGER,
    decision_reason                 TEXT,
    decided_by_author_id            BLOB REFERENCES users(id) ON DELETE SET NULL,
    decided_by_actor_json           TEXT,
    applied_page_id                 BLOB REFERENCES pages(id) ON DELETE SET NULL,
    checkpoint                      TEXT
);

CREATE TABLE auto_improve_proposal_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id  BLOB NOT NULL REFERENCES auto_improve_proposals(id) ON DELETE CASCADE,
    event        TEXT NOT NULL,
    actor_json   TEXT NOT NULL,
    author_id    BLOB REFERENCES users(id) ON DELETE SET NULL,
    detail_json  TEXT NOT NULL DEFAULT '{}',
    at           INTEGER NOT NULL
);

CREATE INDEX idx_auto_improve_runs_scope_recent
    ON auto_improve_runs(workspace_id, project_id, created_at DESC);
CREATE INDEX idx_auto_improve_proposals_scope_status_recent
    ON auto_improve_proposals(workspace_id, project_id, status, staged_at DESC);
CREATE INDEX idx_auto_improve_proposals_run
    ON auto_improve_proposals(run_id);
CREATE INDEX idx_auto_improve_proposal_events_proposal_recent
    ON auto_improve_proposal_events(proposal_id, at ASC, id ASC);

CREATE UNIQUE INDEX idx_auto_improve_one_pending_target
    ON auto_improve_proposals(workspace_id, project_id, target_path)
    WHERE status = 'pending';

CREATE TRIGGER auto_improve_runs_ws_proj_pairing_ai
BEFORE INSERT ON auto_improve_runs
FOR EACH ROW
WHEN NEW.workspace_id IS NOT (SELECT workspace_id FROM projects WHERE id = NEW.project_id)
BEGIN
    SELECT RAISE(ABORT, 'auto_improve_runs.workspace_id does not match the project''s workspace');
END;

CREATE TRIGGER auto_improve_proposals_ws_proj_pairing_ai
BEFORE INSERT ON auto_improve_proposals
FOR EACH ROW
WHEN NEW.workspace_id IS NOT (SELECT workspace_id FROM projects WHERE id = NEW.project_id)
BEGIN
    SELECT RAISE(ABORT, 'auto_improve_proposals.workspace_id does not match the project''s workspace');
END;
