-- Per-project cross-project profile settings, forwarded from the nearest
-- `.ai-memory.toml` `[profile]` section at session start
-- (docs/design-cross-project-profile.md). `profile_contribute = 0` keeps the
-- project out of profile harvesting (client or NDA work); `profile_consume =
-- 0` keeps the profile out of the project's session-start digest and query
-- union. Both default to on: a project without a marker behaves as before.

ALTER TABLE projects ADD COLUMN profile_contribute INTEGER NOT NULL DEFAULT 1
    CHECK (profile_contribute IN (0, 1));
ALTER TABLE projects ADD COLUMN profile_consume INTEGER NOT NULL DEFAULT 1
    CHECK (profile_consume IN (0, 1));
