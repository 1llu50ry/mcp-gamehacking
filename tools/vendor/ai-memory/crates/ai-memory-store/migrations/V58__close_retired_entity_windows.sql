-- Post-audit fix (docs/temporal.md): pages retired WITHOUT a
-- superseding version (decay tombstones, purge-regenerate, graveyard
-- merges) left their entity-link windows open, so `as_of` resurrected
-- retired knowledge for every later instant. Close them retroactively
-- at the page's own updated_at (the best available retirement instant).
-- The runtime paths now close windows at retire time.
UPDATE entity_page_links
SET superseded_at = (SELECT p.updated_at FROM pages p WHERE p.id = page_id)
WHERE superseded_at IS NULL
  AND page_id IN (
      SELECT p.id FROM pages p
      WHERE p.is_latest = 0
        AND NOT EXISTS (SELECT 1 FROM pages s WHERE s.supersedes = p.id)
  );
