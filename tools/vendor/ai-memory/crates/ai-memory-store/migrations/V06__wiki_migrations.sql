-- Tracks applied wiki-structure migrations (parallel to refinery's
-- _refinery_schema_history for SQL-level migrations). Each row is
-- one wiki migration that has been run against this data dir.
CREATE TABLE wiki_migrations (
    name        TEXT PRIMARY KEY,
    applied_at  INTEGER NOT NULL  -- unix microseconds, UTC
);
