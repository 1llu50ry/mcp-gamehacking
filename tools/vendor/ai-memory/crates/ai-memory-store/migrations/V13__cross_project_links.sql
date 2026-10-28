-- Cross-project links.
--
-- A `[[project:path]]` / `[[workspace/project:path]]` wikilink carries an
-- explicit scope; `to_workspace` / `to_project` are NULL for the common case
-- (a link within the source page's own project). The scope joins the PRIMARY
-- KEY so one page can link to the same `to_path` in two different projects
-- without colliding. `to_page_id` stays a global PageId, so a resolved
-- cross-project link already surfaces as a backlink on its target with no
-- query change — the per-project wikis become one graph.
--
-- SQLite cannot alter a PRIMARY KEY in place, so rebuild the table. No other
-- table references `links`, so the drop/rename is safe with FKs enabled.

CREATE TABLE links_new (
    from_page_id  BLOB NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    to_page_id    BLOB REFERENCES pages(id) ON DELETE SET NULL,
    to_workspace  TEXT,                                  -- NULL = source page's workspace
    to_project    TEXT,                                  -- NULL = source page's project
    to_path       TEXT NOT NULL,                         -- root-relative path in the target project
    link_type     TEXT NOT NULL DEFAULT 'references',
    PRIMARY KEY (from_page_id, to_workspace, to_project, to_path, link_type)
);

INSERT INTO links_new (from_page_id, to_page_id, to_workspace, to_project, to_path, link_type)
    SELECT from_page_id, to_page_id, NULL, NULL, to_path, link_type FROM links;

DROP TABLE links;
ALTER TABLE links_new RENAME TO links;

-- Recreate the indexes the dropped table carried (V01/V07/V08) ...
CREATE INDEX idx_links_to ON links(to_page_id) WHERE to_page_id IS NOT NULL;
CREATE INDEX idx_links_unresolved_path ON links(to_path) WHERE to_page_id IS NULL;
CREATE INDEX idx_links_to_path ON links(to_path);
-- ... plus one for scoped (cross-project) resolution + refresh.
CREATE INDEX idx_links_scope ON links(to_project, to_path);
