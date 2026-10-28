-- Data-repair migration: re-run the V19 orphan-attribution repair.
--
-- V19 fixed the historical fragment-project class and v0.12.2 added the
-- runtime prefix-match guard — but that guard keys on `projects.repo_path`,
-- and #103 deliberately never records a repo_path for NON-GIT parents (a
-- bare cwd as a prefix key turned $HOME into a catch-all). So sessions
-- rooted in plain directories kept scattering mid-session subdirectory
-- events into basename fragments ("sources", "desktop", …) after V19 ran.
-- The runtime fix that closes the class for good is session-sticky
-- attribution in the hook router (an existing session's scope wins over
-- per-event cwd derivation); this migration drains what accumulated
-- between V19 and that fix.
--
-- Same idempotent shape as V19: re-running on a repaired DB updates zero
-- rows and deletes zero rows. The session is the source of truth.

-- Step 1: re-attribute observations to their session's scope.

UPDATE observations
SET project_id   = (SELECT project_id   FROM sessions WHERE sessions.id = observations.session_id),
    workspace_id = (SELECT workspace_id FROM sessions WHERE sessions.id = observations.session_id)
WHERE EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = observations.session_id
      AND sessions.project_id != observations.project_id
);

-- Step 2: re-attribute handoffs that carry a from_session_id. Standalone
-- handoffs (from_session_id IS NULL) were deliberately scoped and stay put.

UPDATE handoffs
SET project_id   = (SELECT project_id   FROM sessions WHERE sessions.id = handoffs.from_session_id),
    workspace_id = (SELECT workspace_id FROM sessions WHERE sessions.id = handoffs.from_session_id)
WHERE from_session_id IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = handoffs.from_session_id
        AND sessions.project_id != handoffs.project_id
  );

-- Step 3: delete project rows that are now truly empty. Unlike V19's
-- check, "empty" here also requires zero auto-improve runs, proposals,
-- and rejections — those tables didn't exist when V19 was written, and a
-- project holding staged proposals is NOT empty (deleting it would
-- cascade the proposals away). The per-project scheduler-state row is
-- deliberately NOT counted: ensure_scheduler_state creates one for every
-- project, so it is bookkeeping, not data. Reserved names are exempt:
-- `scratch` is the documented cwd-less fallback (V19's carve-out), and
-- `_global` is the reserved preferences scope added in v1.9.0 — it holds
-- pages so it would survive anyway, but the explicit carve-out is
-- defensive against any future code that assumes it is always present.

DELETE FROM projects
WHERE name NOT IN ('scratch', '_global')
  AND NOT EXISTS (SELECT 1 FROM pages        WHERE project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM sessions     WHERE project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM observations WHERE project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM handoffs     WHERE project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM auto_improve_runs      WHERE project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM auto_improve_proposals WHERE project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM auto_improve_rejections WHERE project_id = projects.id);
