-- Operator-level attribution on the audit log.
--
-- V15 added `pages.author_id` so the latest version of every page
-- can be JOINed to its author for read paths (`/api/v1`, `/web`).
-- The audit log is a separate, append-only trail: every mutating op
-- (page upserts including supersession, retention soft-delete, etc.)
-- writes one row tagged with workspace/project/page + op + timestamp.
--
-- Without an author column on `audit_log`, queries like "who
-- expired alice's token last week?" or "which user soft-deleted the
-- gotcha page about X?" have to cross-reference the page row's
-- current author — but that's the LATEST author, not the one at the
-- time of the op (a page that was anonymous when soft-deleted but
-- since attributed to alice would falsely surface alice). Putting
-- the author on the audit row itself preserves point-in-time truth.
--
-- ON DELETE SET NULL matches V15: if an operator ever hard-deletes
-- a `users` row (which `ai-memory user expire` does NOT do — see
-- docs/users.md — but a future `purge` op could), the audit trail's
-- timestamp + op + page reference all survive; only the
-- "who did it" anchor becomes NULL, which the API surfaces by
-- omitting the `author` field rather than emitting `null`.

ALTER TABLE audit_log
    ADD COLUMN author_id BLOB
    REFERENCES users(id) ON DELETE SET NULL;

-- Lookup pattern used by future "events by author" queries:
-- `WHERE author_id = ? ORDER BY at DESC LIMIT N`. Partial index
-- keeps the cost off the (overwhelming majority of) NULL-author
-- rows, matching the V15 idx_pages_author shape.
CREATE INDEX idx_audit_log_author
    ON audit_log(author_id, at DESC)
    WHERE author_id IS NOT NULL;
