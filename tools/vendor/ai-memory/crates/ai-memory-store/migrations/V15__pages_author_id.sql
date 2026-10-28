-- Page-level attribution.
--
-- Records which registered user (from V14's `users` table) made each
-- write. `NULL` is the rule, not the exception:
--
--   * Rung 0 (anonymous) writes → NULL.
--   * Rung 1 (root token) writes → NULL. Root isn't a `users` row; the
--     bearer-token user's displayed identity comes from
--     `[auth].root_username` and lands in the page's frontmatter
--     `last_modified_by` block — not here.
--   * Rung 2 (DB user) writes → the user's id.
--
-- `ON DELETE SET NULL` keeps historical attribution stable when an
-- operator hard-deletes a user row (which `ai-memory user expire` does
-- NOT do — see docs/users.md — but a future `purge` op could). The
-- `last_modified_by` frontmatter on disk is the canonical historical
-- record; this column is the JOIN key the web UI / `/api/v1` use to
-- surface a user's current name + email next to their old writes.

ALTER TABLE pages
    ADD COLUMN author_id BLOB
    REFERENCES users(id) ON DELETE SET NULL;

-- Lookup pattern used by the web UI / `/api/v1` "pages by author":
-- typical query is `WHERE author_id = ? AND is_latest = 1 ORDER BY
-- updated_at DESC`, the latest-version filter is already covered by
-- idx_pages_latest_path. A partial index makes the author scan cheap
-- without bloating the index for the (common) NULL-author rows.
CREATE INDEX idx_pages_author
    ON pages(author_id, updated_at DESC)
    WHERE author_id IS NOT NULL;
