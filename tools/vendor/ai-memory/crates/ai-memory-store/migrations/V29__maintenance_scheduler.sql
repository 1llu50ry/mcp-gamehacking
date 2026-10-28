-- Global cadence state for maintenance jobs that operate across all scopes.
CREATE TABLE maintenance_scheduler_state (
    job             TEXT PRIMARY KEY,
    last_success_at INTEGER NOT NULL
);
