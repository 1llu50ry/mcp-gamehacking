-- V76: indexed derived project-name keys for identity-aware static scope resolution (#1033).
--
-- The full hostful repository identity remains authoritative. These two columns
-- are derived lookup keys, not user aliases: canonical_name is the hostless
-- path spelling and legacy_name is the v2 repository basename. Existing rows
-- are backfilled by the bounded Rust startup pass before traffic is accepted.

ALTER TABLE projects ADD COLUMN canonical_name TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN legacy_name TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_projects_canonical_name
    ON projects(workspace_id, canonical_name)
 WHERE canonical_name <> '';

CREATE INDEX idx_projects_legacy_name
    ON projects(workspace_id, legacy_name)
 WHERE legacy_name <> '';

CREATE INDEX idx_projects_coordinate_backfill
    ON projects(identity_source)
 WHERE identity_source = 'git_remote'
   AND identity <> ''
   AND (canonical_name = '' OR legacy_name = '');
