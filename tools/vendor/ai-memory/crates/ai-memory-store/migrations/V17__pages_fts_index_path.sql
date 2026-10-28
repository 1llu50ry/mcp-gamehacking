-- Index the page PATH (slug/filename) in the FTS table so a search for a
-- distinctive slug like `followup-bulk-rename-runbook-titles` finds the page
-- even when the slug never appears in the prose body or title.
--
-- The FTS tokenizer keeps `/`, `_`, `-` as token characters (so identifiers
-- stay whole), which means a raw path `notes/foo-bar.md` tokenizes as the
-- single glued token `notes/foo-bar` plus `md`. We index a NORMALISED copy of
-- the path in BOTH forms so either query style hits:
--   * segments — `/` and `.` → space, KEEPING `-`/`_` (so the whole hyphenated
--     slug stays one token: `"foo-bar"` matches);
--   * words — also split `-`/`_` (so `bar` alone matches).
-- `notes/foo-bar.md` → `notes foo-bar md notes foo bar md`. That text lives in
-- a real `pages.path_search` column so the FTS stays content-backed (external
-- content; no body duplication) and the writer keeps it in sync. This SQL MUST
-- match `ops::path_search_text` byte-for-byte.

ALTER TABLE pages ADD COLUMN path_search TEXT NOT NULL DEFAULT '';

UPDATE pages
   SET path_search =
       replace(replace(path, '/', ' '), '.', ' ')
       || ' '
       || replace(replace(replace(replace(path, '/', ' '), '.', ' '), '-', ' '), '_', ' ');

-- Recreate the FTS table + triggers with the extra column. The old triggers
-- reference the 2-column shape, so they must be dropped first.
DROP TRIGGER IF EXISTS pages_fts_ai;
DROP TRIGGER IF EXISTS pages_fts_ad;
DROP TRIGGER IF EXISTS pages_fts_au;
DROP TABLE IF EXISTS pages_fts;

CREATE VIRTUAL TABLE pages_fts USING fts5(
    title, body, path_search,
    content='pages',
    content_rowid='rowid',
    tokenize="unicode61 remove_diacritics 2 tokenchars '/_-'"
);

CREATE TRIGGER pages_fts_ai AFTER INSERT ON pages BEGIN
    INSERT INTO pages_fts(rowid, title, body, path_search)
        VALUES (new.rowid, new.title, new.body, new.path_search);
END;

CREATE TRIGGER pages_fts_ad AFTER DELETE ON pages BEGIN
    INSERT INTO pages_fts(pages_fts, rowid, title, body, path_search)
        VALUES ('delete', old.rowid, old.title, old.body, old.path_search);
END;

CREATE TRIGGER pages_fts_au AFTER UPDATE OF title, body, path_search ON pages BEGIN
    INSERT INTO pages_fts(pages_fts, rowid, title, body, path_search)
        VALUES ('delete', old.rowid, old.title, old.body, old.path_search);
    INSERT INTO pages_fts(rowid, title, body, path_search)
        VALUES (new.rowid, new.title, new.body, new.path_search);
END;

-- Repopulate the FTS index from the (now path_search-bearing) content table.
INSERT INTO pages_fts(pages_fts) VALUES('rebuild');
