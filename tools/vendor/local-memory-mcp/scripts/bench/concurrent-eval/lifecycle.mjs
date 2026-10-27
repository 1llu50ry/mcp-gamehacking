import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { execFileSync } from "child_process";
import { createConcurrentBenchDb } from "./schema.mjs";

export function withConcurrentBenchDb(tmpDir, label, fn) {
	const dbPath = `${tmpDir}/${label}-${randomUUID()}.db`;
	const db = createConcurrentBenchDb(dbPath);
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

export async function withConcurrentBenchDbAsync(tmpDir, label, fn) {
	const dbPath = `${tmpDir}/${label}-${randomUUID()}.db`;
	const db = createConcurrentBenchDb(dbPath);
	try {
		return await fn({ db, dbPath });
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

export function collectBenchRevision() {
	const entrypoint = "scripts/bench/concurrent-workload-bench.mjs";
	const evalRoot = path.resolve("scripts/bench/concurrent-eval");
	const corpusRoot = path.resolve("scripts/bench/memory-eval");
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
			else if (ent.isFile()) discovered.push(path.relative(process.cwd(), full).replaceAll(path.sep, "/"));
		}
	};
	walk(evalRoot);
	walk(corpusRoot);
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

export function seedConcurrentDb(primaryDb, seedOpts = {}) {
	const { buildMemoryCorpus } = seedOpts;
	if (!buildMemoryCorpus) return { seeded: 0 };
	return { seeded: 0 };
}

export function isBusyError(err) {
	const msg = String(err?.message || err || "");
	const code = err?.code ? String(err.code) : "";
	if (/SQLITE_BUSY/i.test(code) || /SQLITE_BUSY/i.test(msg)) return true;
	if (/database is locked/i.test(msg)) return true;
	if (/busy/i.test(msg) && /sqlite/i.test(msg)) return true;
	return false;
}

export function isTimeoutError(err) {
	const msg = String(err?.message || err || "");
	if (/timeout/i.test(msg) && /busy/i.test(msg)) return true;
	return false;
}
