-- Data-repair migration: re-attribute observations & handoffs whose
-- project_id was set by the hook router's per-event cwd resolution
-- rather than inherited from the session's project_id.
--
-- Root cause:
-- Prior to v0.12.x, `ai-memory-hooks::router::resolve_project_ids`
-- derived the project name from `basename(cwd)` (or `basename(repo-root)`)
-- on every event, ignoring whether any existing project's `repo_path`
-- already contained the event's cwd. When an agent's tool calls
-- reported a cwd inside a subdirectory of the session's actual
-- project (a Read of `manga-plus/reader/src/main.rs`, a Bash call
-- in `manga-plus/jadx_output/`, ...), the observation landed in a
-- separate, auto-created "fragment" project (`reader`, `jadx_output`,
-- ...) rather than the session's project (`manga-plus`). The session
-- row itself stayed correctly attributed; only per-event rows
-- migrated.
--
-- This migration repairs the historical mismatch deterministically:
-- the session is the source of truth (an agent started one and owns
-- the observations under it; the FK already enforces session
-- existence). The runtime fix that prevents recurrence lives in the
-- hook router (`find_project_by_cwd_prefix`).
--
-- The migration is idempotent: re-running on a repaired DB updates
-- zero rows in steps 1+2 and deletes zero rows in step 3.

-- Step 1: re-attribute observations.
--
-- The CASCADE FK guarantees `sessions.id = observations.session_id`
-- exists, so the subselects always resolve. Updating workspace_id
-- alongside project_id keeps the V18 pair-trigger invariant after
-- this migration runs (V18's trigger fires on INSERT only, so this
-- UPDATE is unaffected by it).

UPDATE observations
SET project_id   = (SELECT project_id   FROM sessions WHERE sessions.id = observations.session_id),
    workspace_id = (SELECT workspace_id FROM sessions WHERE sessions.id = observations.session_id)
WHERE EXISTS (
    SELECT 1 FROM sessions
    WHERE sessions.id = observations.session_id
      AND sessions.project_id != observations.project_id
);

-- Step 2: re-attribute handoffs that carry a from_session_id.
--
-- Standalone handoffs (from_session_id IS NULL) are documented
-- behaviour: CLAUDE.md invariant #15a names `scratch` as the
-- defensive default for hook events that arrive without a usable
-- cwd. Those handoffs were intentionally written to scratch and
-- stay there — the WHERE clause skips them.

UPDATE handoffs
SET project_id   = (SELECT project_id   FROM sessions WHERE sessions.id = handoffs.from_session_id),
    workspace_id = (SELECT workspace_id FROM sessions WHERE sessions.id = handoffs.from_session_id)
WHERE from_session_id IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = handoffs.from_session_id
        AND sessions.project_id != handoffs.project_id
  );

-- Step 3: delete project rows that are now truly empty.
--
-- An empty project has no pages, no sessions, no observations, and
-- no handoffs. After steps 1+2, the fragment projects that existed
-- only because of the misattribution bug match this profile and
-- nothing points at them. The CASCADE FKs do nothing here because
-- the row IS empty by definition.
--
-- `scratch` is preserved because of its documented escape-hatch role
-- — even if it transiently looks empty, the hook router relies on
-- its existence for cwd-less fallback. (`scratch` will be re-created
-- by `get_or_create_project` on the next cwd-less hook anyway, so
-- deleting it is harmless in practice; the explicit carve-out is
-- defensive against any future code that assumes `scratch` is
-- always present.)

DELETE FROM projects
WHERE name != 'scratch'
  AND NOT EXISTS (SELECT 1 FROM pages        WHERE project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM sessions     WHERE project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM observations WHERE project_id = projects.id)
  AND NOT EXISTS (SELECT 1 FROM handoffs     WHERE project_id = projects.id);
