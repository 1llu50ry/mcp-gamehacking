-- Bi-temporal-lite (2.0 item 4, docs/temporal.md): entity links inherit
-- their page version's ingestion-time timeline. Additive columns +
-- one-shot backfill; no row is deleted or rewritten beyond the two new
-- columns.
--
-- valid_from    = created_at of the page version the link belongs to
-- superseded_at = created_at of the version that superseded it
--                 (NULL while the version is latest)

ALTER TABLE entity_page_links ADD COLUMN valid_from INTEGER;
ALTER TABLE entity_page_links ADD COLUMN superseded_at INTEGER;

UPDATE entity_page_links
SET valid_from = (SELECT p.created_at FROM pages p WHERE p.id = page_id);

UPDATE entity_page_links
SET superseded_at = (
    SELECT p2.created_at FROM pages p2 WHERE p2.supersedes = page_id
)
WHERE page_id IN (SELECT id FROM pages WHERE is_latest = 0);

-- The as_of window scan: (entity, window) probes ride this.
CREATE INDEX idx_entity_page_links_validity
    ON entity_page_links(entity_id, valid_from, superseded_at);
