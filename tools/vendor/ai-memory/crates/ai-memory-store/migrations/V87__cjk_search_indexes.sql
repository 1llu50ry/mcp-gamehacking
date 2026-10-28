-- Auxiliary indexes for unspaced Han, Kana, and Hangul text. The regular
-- unicode61 indexes remain the source for every non-CJK query; Rust writes
-- bounded unigram/bigram terms here and repairs missing rows at startup.
CREATE VIRTUAL TABLE pages_cjk_fts USING fts5(
    title,
    body,
    path_search,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE observations_cjk_fts USING fts5(
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- Content changes are not part of the runtime model (pages are versioned and
-- observations immutable). Delete stale derived rows defensively if direct
-- maintenance SQL changes that assumption; startup repair recreates them.
CREATE TRIGGER pages_cjk_fts_ad AFTER DELETE ON pages BEGIN
    DELETE FROM pages_cjk_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER pages_cjk_fts_au AFTER UPDATE OF title, body, path_search ON pages BEGIN
    DELETE FROM pages_cjk_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER observations_cjk_fts_ad AFTER DELETE ON observations BEGIN
    DELETE FROM observations_cjk_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER observations_cjk_fts_au AFTER UPDATE OF title, body ON observations BEGIN
    DELETE FROM observations_cjk_fts WHERE rowid = old.rowid;
END;
