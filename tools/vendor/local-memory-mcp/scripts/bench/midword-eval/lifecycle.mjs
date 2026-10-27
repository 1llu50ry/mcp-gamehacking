/**
 * DB lifecycle + unambiguous revision manifest for the mid-word fallback
 * benchmark (TASK-483). Mirrors scripts/bench/embedding-eval/lifecycle.mjs.
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import Database from "better-sqlite3";

export function createBenchDb(dbPath) {
	const dir = path.dirname(dbPath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	db.pragma("busy_timeout = 5000");
	db.pragma("wal_autocheckpoint = 1000");
	db.exec(`
		CREATE TABLE IF NOT EXISTS memories (
			id INTEGER PRIMARY KEY,
			title TEXT,
			content TEXT NOT NULL,
			tags TEXT,
			owner TEXT NOT NULL DEFAULT '',
			repo TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'active'
		);
		CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
			title, content, tags,
			content='memories', content_rowid='id', tokenize='unicode61'
		);
		CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
			INSERT INTO memories_fts(rowid, title, content, tags) VALUES (new.id, new.title, new.content, new.tags);
		END;
		CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
			INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES('delete', old.id, old.title, old.content, old.tags);
		END;
		CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
			INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES('delete', old.id, old.title, old.content, old.tags);
			INSERT INTO memories_fts(rowid, title, content, tags) VALUES (new.id, new.title, new.content, new.tags);
		END;
	`);
	return db;
}

export function withBenchDb(tmpDir, label, fn) {
	const dbPath = `${tmpDir}/${label}-${randomUUID()}.db`;
	const db = createBenchDb(dbPath);
	try {
		return fn({ db, dbPath });
	} finally {
		try {
			db.close();
		} catch {
			// Best-effort benchmark cleanup.
		}
		for (const suffix of ["", "-wal", "-shm"]) {
			try {
				fs.unlinkSync(`${dbPath}${suffix}`);
			} catch {
				// Best-effort benchmark cleanup.
			}
		}
	}
}

/**
 * Unambiguous revision manifest: hash every file in the midword-eval/ module
 * directory plus the entrypoint, concatenate the per-file sha1 hashes into a
 * manifest string, then sha256 the manifest. Deterministic given the git tree;
 * falls back to raw-content hashing when a file is untracked.
 */
export function collectBenchRevision() {
	const entrypoint = "scripts/bench/midword-fallback-bench.mjs";
	const evalRoot = path.resolve("scripts/bench/midword-eval");
	const discovered = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const ent of entries) {
			const full = path.join(dir, ent.name);
			if (ent.isDirectory()) walk(full);
			else if (ent.isFile()) {
				const rel = path.relative(process.cwd(), full).replaceAll(path.sep, "/");
				discovered.push(rel);
			}
		}
	};
	walk(evalRoot);
	discovered.sort();
	const files = [entrypoint, ...discovered.filter((f) => f !== entrypoint)];
	const seen = new Set();
	const ordered = [];
	for (const f of files) {
		if (!seen.has(f)) {
			seen.add(f);
			ordered.push(f);
		}
	}
	ordered.sort();
	const perFile = {};
	let manifest = "";
	for (const f of ordered) {
		try {
			const h = execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim();
			perFile[f] = h;
			manifest += `${h}  ${f}\n`;
		} catch {
			try {
				const content = fs.readFileSync(f);
				const h = createHash("sha1").update(content).digest("hex");
				perFile[f] = h;
				manifest += `${h}  ${f}\n`;
			} catch {
				perFile[f] = null;
				manifest += `missing  ${f}\n`;
			}
		}
	}
	const manifestHash = createHash("sha256").update(manifest).digest("hex");
	return { perFile, manifest, manifestHash };
}
