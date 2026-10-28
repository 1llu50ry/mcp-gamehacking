-- V41: support the handoff listing added alongside ownership.
--
-- Every existing handoffs index is partial (`WHERE state = 'open'`), including
-- V39's. The listing endpoint's default call asks for EVERY state — that is how
-- an operator finds a baton that was already consumed — so it had no usable
-- index and made SQLite scan the project's entire handoff history and build a
-- temp B-tree to sort it, on every request.
--
-- Non-partial and ordered to match the root recovery query's
-- `ORDER BY created_at DESC`, so that scan is bounded by the LIMIT instead of
-- by the table.
CREATE INDEX idx_handoffs_project_recent
    ON handoffs (workspace_id, project_id, created_at DESC);

-- The normal listing is owner-scoped. Keep a separate owner-first index so a
-- project with a high volume of other operators' rows does not have to scan
-- their history before finding the caller's own/shared rows.
CREATE INDEX idx_handoffs_project_owner_recent
    ON handoffs (workspace_id, project_id, owner_user, created_at DESC);
