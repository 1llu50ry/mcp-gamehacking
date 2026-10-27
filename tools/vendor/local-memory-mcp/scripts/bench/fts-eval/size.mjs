/**
 * Index-size concern for the FTS5 tokenizer evaluation harness.
 *
 * Measures FTS-only index footprint by building three identical DBs
 * (base corpus only / +unicode FTS / +trigram FTS) and checkpointing,
 * then taking the whole-file size delta. This mirrors the original logic
 * exactly — SQLite exposes no reliable per-table page count.
 */

import path from "path";

function dbFileSize(fs, p) {
	let bytes = fs.statSync(p).size;
	const wal = `${p}-wal`;
	if (fs.existsSync(wal)) bytes += fs.statSync(wal).size;
	return bytes;
}

function buildSizeDb(Database, fs, tmpDir, tokenizer, rows, tag) {
	const p = path.join(tmpDir, `size-${tag}-${tokenizer || "base"}.db`);
	const d = new Database(p);
	d.pragma("journal_mode = WAL");
	d.pragma("synchronous = NORMAL");
	d.pragma("busy_timeout = 5000");
	d.pragma("wal_autocheckpoint = 1000");
	d.exec(`
		CREATE TABLE memories (id INTEGER PRIMARY KEY, title TEXT, content TEXT NOT NULL, tags TEXT);
	`);
	const ins = d.prepare("INSERT INTO memories (id, title, content, tags) VALUES (@id, @title, @content, @tags)");
	d.transaction((rs) => {
		for (const r of rs) ins.run(r);
	})(rows);
	if (tokenizer) {
		d.exec(
			`CREATE VIRTUAL TABLE fts_index USING fts5(title, content, tags, content='memories', content_rowid='id', tokenize='${tokenizer}');
			 INSERT INTO fts_index(rowid, title, content, tags) SELECT id, title, content, tags FROM memories;`
		);
	}
	d.pragma("wal_checkpoint(TRUNCATE)");
	d.close();
	return dbFileSize(fs, p);
}

export function measureSizes(Database, fs, tmpDir, corpus, uniqueCorpus) {
	const sizeFor = (rows, tag) => {
		const sizeBase = buildSizeDb(Database, fs, tmpDir, null, rows, tag);
		const unicodeBytes = buildSizeDb(Database, fs, tmpDir, "unicode61", rows, tag) - sizeBase;
		const trigramBytes = buildSizeDb(Database, fs, tmpDir, "trigram", rows, tag) - sizeBase;
		return { tag, unicodeBytes, trigramBytes, ratio: unicodeBytes ? trigramBytes / unicodeBytes : null };
	};
	const sizeRepetitive = sizeFor(corpus, "repetitive-recall-corpus");
	const sizeUnique = sizeFor(uniqueCorpus, "unique-content-corpus");
	const sizeUnicode = { bytes: sizeRepetitive.unicodeBytes, baseTotal: null };
	const sizeTrigram = { bytes: sizeRepetitive.trigramBytes, baseTotal: null };
	return { sizeRepetitive, sizeUnique, sizeUnicode, sizeTrigram };
}
