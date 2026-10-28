-- Accent-insensitive full-text search (Portuguese-friendly).
--
-- The FTS5 tables were created with `unicode61 tokenchars '/_-'`, which keeps
-- diacritics: a query for "descricao" never matches stored "descrição". The
-- tokenizer is fixed at CREATE time, so the only way to change it is to drop
-- and recreate the FTS table (+ its sync triggers) and rebuild from the
-- content table. `remove_diacritics 2` folds diacritics across the full
-- Unicode range, so "descricao"/"descrição", "sessao"/"sessão", etc. unify.
--
-- Both FTS tables are contentless (`content='pages'` / `content='observations'`),
-- so the source rows are untouched; only the derived index is rebuilt.

-- ── pages_fts ────────────────────────────────────────────────────────────
DROP TRIGGER pages_fts_ai;
DROP TRIGGER pages_fts_ad;
DROP TRIGGER pages_fts_au;
DROP TABLE pages_fts;

CREATE VIRTUAL TABLE pages_fts USING fts5(
    title, body,
    content='pages',
    content_rowid='rowid',
    tokenize="unicode61 remove_diacritics 2 tokenchars '/_-'"
);
INSERT INTO pages_fts(pages_fts) VALUES('rebuild');

CREATE TRIGGER pages_fts_ai AFTER INSERT ON pages BEGIN
    INSERT INTO pages_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER pages_fts_ad AFTER DELETE ON pages BEGIN
    INSERT INTO pages_fts(pages_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
END;
-- Matches the V08 narrowing: only re-index on title/body updates.
CREATE TRIGGER pages_fts_au AFTER UPDATE OF title, body ON pages BEGIN
    INSERT INTO pages_fts(pages_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
    INSERT INTO pages_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
END;

-- ── observations_fts ──────────────────────────────────────────────────────
DROP TRIGGER observations_fts_ai;
DROP TRIGGER observations_fts_ad;
DROP TRIGGER observations_fts_au;
DROP TABLE observations_fts;

CREATE VIRTUAL TABLE observations_fts USING fts5(
    title, body,
    content='observations',
    content_rowid='rowid',
    tokenize="unicode61 remove_diacritics 2 tokenchars '/_-'"
);
INSERT INTO observations_fts(observations_fts) VALUES('rebuild');

CREATE TRIGGER observations_fts_ai AFTER INSERT ON observations BEGIN
    INSERT INTO observations_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER observations_fts_ad AFTER DELETE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER observations_fts_au AFTER UPDATE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
    INSERT INTO observations_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
END;
