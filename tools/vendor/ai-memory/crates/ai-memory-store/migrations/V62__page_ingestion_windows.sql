-- Page-grain ingestion windows (issue #656,
-- docs/design-page-ingestion-windows.md): materialize each page version's
-- ingestion window so `as_of` can run version-filtered FTS alongside the
-- V56 entity-link windows. Same dimension, same predicate shape, page
-- grain: `valid_from` is the version's own `created_at`; `valid_to` is the
-- superseding version's `created_at` (NULL while the version is latest).
--
-- DDL-only by design (issue #776). This migration used to backfill the two
-- windows in a single in-migration transaction (`UPDATE pages SET
-- valid_from = created_at`, plus the two `valid_to` supersession rules).
-- On a large store that one transaction ran for hours and grew the WAL to
-- roughly the size of the database, with no progress and no way to bound
-- it — refinery runs a migration as one transaction before the server
-- accepts traffic. The backfill now lives in a chunked, resumable,
-- WAL-bounded boot-path step (`ops::backfill_page_windows`, invoked from
-- `Store::open`), which reproduces the identical end state (`valid_from =
-- created_at`; `valid_to` per the two rules below) in bounded batches with
-- a checkpoint between each. A store that already applied the ORIGINAL V62
-- has these columns fully populated; the boot step detects that (no page
-- has a NULL `valid_from`) and is a fast no-op. Such stores recorded the
-- original migration's checksum, so the runner tolerates this reshape via
-- `set_abort_divergent(false)` (see `migrations::run`).
--
-- `valid_to`, not `superseded_at`: `pages.superseded_at` already means
-- the V03 decay-tombstone eviction marker (written exactly when
-- `supersedes IS NULL`), so reusing the name would conflate "evicted by
-- the forget sweep" with "replaced by a newer version".
--
-- The boot backfill reproduces exactly these rules over every page whose
-- `valid_from` is still NULL:
--   * `valid_from` = the version's own `created_at`.
--   * Ordinary supersession: `valid_to` = the earliest successor's
--     `created_at` (MIN over pages whose `supersedes` is this page).
--   * Successor-less retirement (is_latest = 0, no successor): `valid_to`
--     = COALESCE(superseded_at, MIN(entity_page_links.superseded_at),
--     updated_at) — decay marker, then the existing link-window close,
--     then the updated_at fallback.
--   * A latest version with no successor stays open (`valid_to` NULL).

ALTER TABLE pages ADD COLUMN valid_from INTEGER;
ALTER TABLE pages ADD COLUMN valid_to INTEGER;

-- The as_of window scan over page versions: (scope, window) probes ride
-- this, mirroring idx_entity_page_links_validity at link grain.
CREATE INDEX idx_pages_validity
    ON pages(workspace_id, project_id, valid_from, valid_to);
