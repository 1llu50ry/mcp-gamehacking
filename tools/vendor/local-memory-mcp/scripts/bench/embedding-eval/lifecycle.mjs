import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { execFileSync, execSync } from "child_process";
import { createBenchDb } from "./schema.mjs";
import { contentHash } from "./fixtures.mjs";
import { BATCH_SIZE, LEASE_MS, POISON_THRESHOLD, BACKOFF_BASE_MS, BACKOFF_MAX_MS } from "./constants.mjs";

export function withBenchDb(tmpDir, label, fn) {
	const dbPath = `${tmpDir}/${label}-${randomUUID()}.db`;
	const db = createBenchDb(dbPath);
	try {
		return fn({ db, dbPath });
	} finally {
		try {
			db.close();
		} catch {
			// Best-effort benchmark cleanup or callback isolation.
		}
		for (const suffix of ["", "-wal", "-shm"]) {
			try {
				fs.unlinkSync(`${dbPath}${suffix}`);
			} catch {
				// Best-effort benchmark cleanup or callback isolation.
			}
		}
	}
}

export async function withBenchDbAsync(tmpDir, label, fn) {
	const dbPath = `${tmpDir}/${label}-${randomUUID()}.db`;
	const db = createBenchDb(dbPath);
	try {
		return await fn({ db, dbPath });
	} finally {
		try {
			db.close();
		} catch {
			// Best-effort benchmark cleanup or callback isolation.
		}
		for (const suffix of ["", "-wal", "-shm"]) {
			try {
				fs.unlinkSync(`${dbPath}${suffix}`);
			} catch {
				// Best-effort benchmark cleanup or callback isolation.
			}
		}
	}
}

export function enqueueMemory(db, memory) {
	const payload = JSON.stringify({
		v: 1,
		text: memory.content,
		owner: memory.owner,
		repo: memory.repo,
		updatedAt: memory.updated_at
	});
	const hash = contentHash(memory.content);
	const existing = db
		.prepare("SELECT content_hash, status FROM queue_jobs WHERE entity_kind='memory' AND entity_id=?")
		.get(memory.id);
	if (existing && existing.content_hash !== null && existing.content_hash === hash && existing.status !== "poison")
		return false;
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO queue_jobs (id, entity_kind, entity_id, entity_repo, payload, content_hash, status, attempts, created_at, updated_at) VALUES (?, 'memory', ?, ?, ?, ?, 'pending', 0, ?, ?)
		 ON CONFLICT(entity_kind, entity_id) DO UPDATE SET payload=excluded.payload, content_hash=excluded.content_hash, status='pending', attempts=0, lease_until=NULL, locked_by=NULL, backoff_until=NULL, last_error=NULL, updated_at=excluded.updated_at`
	).run(randomUUID(), memory.id, memory.repo, payload, hash, now, now);
	return true;
}

export function writeWithEnqueue(db, memory) {
	const tx = db.transaction(() => {
		db.prepare(
			`INSERT INTO memories (id, code, repo, owner, type, title, content, importance, created_at, updated_at, tags, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			memory.id,
			`MEM-${memory.id.slice(-6)}`,
			memory.repo,
			memory.owner,
			memory.type,
			memory.title,
			memory.content,
			memory.importance,
			memory.created_at,
			memory.updated_at,
			JSON.stringify(memory.tags),
			JSON.stringify(memory.metadata)
		);
		enqueueMemory(db, memory);
	});
	tx();
}

export function claimBatch(db, max, leaseMs, clock) {
	const nowIso = clock ? clock.nowIso() : new Date().toISOString();
	const nowMs = clock ? clock.now().getTime() : Date.now();
	const leaseUntil = new Date(nowMs + leaseMs).toISOString();
	const batchId = `bench-${randomUUID()}`;
	const result = db
		.prepare(
			`UPDATE queue_jobs SET status='claimed', lease_until=?, locked_by=?, updated_at=? WHERE id IN (SELECT id FROM queue_jobs WHERE (status='pending' AND (backoff_until IS NULL OR backoff_until <= ?)) OR (status='claimed' AND lease_until IS NOT NULL AND lease_until < ?) ORDER BY created_at ASC LIMIT ?)`
		)
		.run(leaseUntil, batchId, nowIso, nowIso, nowIso, max);
	if (result.changes === 0) return [];
	return db.prepare("SELECT * FROM queue_jobs WHERE locked_by=? ORDER BY created_at ASC").all(batchId);
}

export function completeJob(db, id, lockedBy, clock) {
	const nowIso = clock ? clock.nowIso() : new Date().toISOString();
	const r = db
		.prepare(
			"UPDATE queue_jobs SET status='done', updated_at=?, last_error=NULL WHERE id=? AND status='claimed' AND locked_by=?"
		)
		.run(nowIso, id, lockedBy);
	return r.changes > 0;
}

export function failJob(db, id, lockedBy, error, poisonThreshold, backoffBaseMs, backoffMaxMs, clock) {
	const row = db
		.prepare("SELECT attempts FROM queue_jobs WHERE id=? AND status='claimed' AND locked_by=?")
		.get(id, lockedBy);
	if (!row) return;
	const nextAttempts = (row.attempts ?? 0) + 1;
	const poison = nextAttempts >= poisonThreshold;
	const baseNow = clock ? clock.now().getTime() : Date.now();
	const backoffUntil = poison
		? null
		: new Date(baseNow + Math.min(backoffBaseMs * 2 ** (nextAttempts - 1), backoffMaxMs)).toISOString();
	const nowIso = clock ? clock.nowIso() : new Date().toISOString();
	db.prepare(
		`UPDATE queue_jobs SET attempts=attempts+1, status=?, last_error=?, lease_until=NULL, locked_by=NULL, backoff_until=?, updated_at=? WHERE id=? AND status='claimed' AND locked_by=?`
	).run(poison ? "poison" : "pending", String(error).slice(0, 500), backoffUntil, nowIso, id, lockedBy);
}

export function reconcileExpiredLeases(db, clock) {
	const nowIso = clock ? clock.nowIso() : new Date().toISOString();
	const r = db
		.prepare(
			`UPDATE queue_jobs SET status='pending', lease_until=NULL, locked_by=NULL, updated_at=? WHERE status='claimed' AND lease_until IS NOT NULL AND lease_until < ?`
		)
		.run(nowIso, nowIso);
	return r.changes;
}

export function countByStatus(db) {
	const rows = db.prepare("SELECT status, COUNT(*) as c FROM queue_jobs GROUP BY status").all();
	const out = { pending: 0, claimed: 0, done: 0, poison: 0, total: 0 };
	for (const r of rows) {
		if (r.status in out) out[r.status] = r.c;
		out.total += r.c;
	}
	return out;
}

export function reopenDb(dbPath) {
	return createBenchDb(dbPath);
}

export function collectBenchRevision() {
	const entrypoint = "scripts/bench/embedding-queue-availability-bench.mjs";
	const evalRoot = path.resolve("scripts/bench/embedding-eval");
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

export function collectBenchRevisionLegacyFallback() {
	try {
		return execSync(
			"git hash-object scripts/bench/embedding-queue-availability-bench.mjs scripts/bench/memory-eval/metrics.mjs",
			{ encoding: "utf8" }
		).trim();
	} catch {
		return null;
	}
}

export async function drainAll(db, opts = {}) {
	const embedDelayMs = opts.embedDelayMs ?? 1;
	const batchSize = opts.batchSize ?? BATCH_SIZE;
	const injectVectorErrorForIds = opts.injectVectorErrorForIds ?? null;
	const clock = opts.clock ?? null;
	const onVisible = opts.onVisible ?? null;
	let totalProcessed = 0;
	let iterations = 0;
	let vectorFailures = 0;
	while (iterations++ < 200) {
		const jobs = claimBatch(db, batchSize, LEASE_MS, clock);
		if (jobs.length === 0) break;
		if (embedDelayMs > 0) await new Promise((r) => setTimeout(r, embedDelayMs));
		for (const job of jobs) {
			let vector;
			try {
				vector = JSON.parse(job.payload);
			} catch {
				vector = { text: job.payload };
			}
			if (injectVectorErrorForIds && injectVectorErrorForIds.has(job.entity_id)) {
				failJob(
					db,
					job.id,
					job.locked_by,
					"injected vector write failure",
					POISON_THRESHOLD,
					BACKOFF_BASE_MS,
					BACKOFF_MAX_MS,
					clock
				);
				vectorFailures++;
				continue;
			}
			const vecPayload = JSON.stringify({ dim: 8, text: vector.text || "" });
			try {
				db.prepare(
					"INSERT INTO memory_vectors (memory_id, vector, updated_at) VALUES (?, ?, ?) ON CONFLICT(memory_id) DO UPDATE SET vector=excluded.vector, updated_at=excluded.updated_at"
				).run(job.entity_id, vecPayload, clock ? clock.nowIso() : new Date().toISOString());
			} catch (e) {
				failJob(db, job.id, job.locked_by, e, POISON_THRESHOLD, BACKOFF_BASE_MS, BACKOFF_MAX_MS, clock);
				vectorFailures++;
				continue;
			}
			completeJob(db, job.id, job.locked_by, clock);
			if (onVisible) {
				try {
					onVisible(job.entity_id, Date.now());
				} catch {
					// Best-effort benchmark cleanup or callback isolation.
				}
			}
			totalProcessed++;
		}
		if (clock) {
			const progressed = clock.waitUntilDue(db);
			if (progressed === 0 && jobs.length === 0) break;
		}
	}
	return { totalProcessed, vectorFailures };
}

export function visibilityLatencyForIds(db, ids, visibilityMap) {
	const out = [];
	let failures = 0;
	for (const id of ids) {
		const hasVector = !!db.prepare("SELECT 1 FROM memory_vectors WHERE memory_id=?").get(id);
		if (!hasVector) failures++;
		else if (visibilityMap && visibilityMap.has(id)) out.push(visibilityMap.get(id));
	}
	return { samples: out, failures };
}
