import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager } from "../storage/migrations";
import { createTestStore } from "../storage/sqlite";

/**
 * Regression net for migration v14 "normalized-tag-indexes" (OPT-PERF-07).
 *
 * v14 creates the index child tables (memory_tags, standard_tags,
 * standard_stack), AFTER-INSERT/UPDATE sync triggers, and a backfill from the
 * parent JSON columns. These tests pin the contract that TASK-163 would have
 * broken: duplicate / case-variant tags must NOT fail the parent write, and
 * both the backfill and the triggers must produce deduplicated child rows.
 */
describe("migration v14 normalized tag indexes", () => {
	it("seed-at-v13 → v14 backfills child rows, deduping exact + case-variant duplicates", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-tags-migrate-"));
		const dbPath = path.join(tempDir, "tags.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		// Full v1..v14 apply on a fresh DB.
		new MigrationManager(db).migrate();

		// ── TASK-163 regression: previously-valid writes must still succeed even
		// with duplicate tags — the write does NOT dedupe (zod
		// z.array(z.string()), entities persist JSON.stringify verbatim). The
		// NOCASE child PK must dedupe child rows WITHOUT failing the parent
		// INSERT/UPDATE.
		db.prepare(
			`INSERT INTO memories (id, repo, owner, type, content, importance, created_at, updated_at, tags)
			 VALUES ('m-dup', 'r', 'o', 'code_fact', 'dup content', 3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?)`
		).run(JSON.stringify(["foo", "foo", "TypeScript", "typescript", "bar"])); // must not throw

		db.prepare(
			`INSERT INTO coding_standards (id, title, content, created_at, updated_at, tags, stack)
			 VALUES ('s-dup', 't', 'c', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?, ?)`
		).run(JSON.stringify(["hook", "hook", "Go", "go"]), JSON.stringify(["react", "React", "backend"])); // must not throw

		// Simulate rows that predate v14: wipe the child tables so the v14
		// backfill runs against empty child rows (the trigger-synced rows would
		// otherwise mask the backfill). Then remove the v14 migration record and
		// re-run — v14's CREATE TABLE IF NOT EXISTS + DROP/CREATE triggers are
		// idempotent, and the INSERT OR IGNORE backfill re-populates children.
		db.exec("DELETE FROM memory_tags; DELETE FROM standard_tags; DELETE FROM standard_stack;");
		db.prepare("DELETE FROM _schema_version WHERE version = 14").run();
		new MigrationManager(db).migrate();

		// Tags deduped case-insensitively: ["foo","foo","TypeScript","typescript","bar"]
		// → { foo, TypeScript, bar } (foo duplicated, TypeScript/typescript collapsed).
		const memTags = db
			.prepare("SELECT tag FROM memory_tags WHERE memory_id = 'm-dup' ORDER BY tag COLLATE NOCASE")
			.all() as { tag: string }[];
		expect(memTags.map((r) => r.tag)).toEqual(["bar", "foo", "TypeScript"]);

		const stdTags = db
			.prepare("SELECT tag FROM standard_tags WHERE standard_id = 's-dup' ORDER BY tag COLLATE NOCASE")
			.all() as { tag: string }[];
		expect(stdTags.map((r) => r.tag)).toEqual(["Go", "hook"]);

		const stdStack = db
			.prepare("SELECT stack FROM standard_stack WHERE standard_id = 's-dup' ORDER BY stack COLLATE NOCASE")
			.all() as { stack: string }[];
		expect(stdStack.map((r) => r.stack)).toEqual(["backend", "react"]); // React deduped against react (first-wins)

		// NOCASE equality matches both ways.
		expect(
			(
				db.prepare("SELECT COUNT(*) AS c FROM memory_tags WHERE memory_id='m-dup' AND tag = 'typescript'").get() as {
					c: number;
				}
			).c
		).toBe(1);
		expect(
			(
				db.prepare("SELECT COUNT(*) AS c FROM memory_tags WHERE memory_id='m-dup' AND tag = 'TYPESCRIPT'").get() as {
					c: number;
				}
			).c
		).toBe(1);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("UPDATE parent re-syncs child rows and DELETE cascades", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-tags-update-"));
		const dbPath = path.join(tempDir, "tags.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		db.prepare(
			`INSERT INTO memories (id, repo, owner, type, content, importance, created_at, updated_at, tags)
			 VALUES ('m-1', 'r', 'o', 'code_fact', 'c', 3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?)`
		).run(JSON.stringify(["filament"]));

		// UPDATE to a new set of tags → child rows replaced.
		db.prepare("UPDATE memories SET tags = ? WHERE id = 'm-1'").run(JSON.stringify(["Go", "GO", "laravel"]));
		const afterUpdate = db
			.prepare("SELECT tag FROM memory_tags WHERE memory_id = 'm-1' ORDER BY tag COLLATE NOCASE")
			.all() as { tag: string }[];
		expect(afterUpdate.map((r) => r.tag)).toEqual(["Go", "laravel"]); // GO deduped against Go

		// UPDATE without a tags change (WHEN guard) must not corrupt child rows.
		db.prepare("UPDATE memories SET status = 'active' WHERE id = 'm-1'").run();
		const afterNoop = db
			.prepare("SELECT tag FROM memory_tags WHERE memory_id = 'm-1' ORDER BY tag COLLATE NOCASE")
			.all() as { tag: string }[];
		expect(afterNoop.map((r) => r.tag)).toEqual(["Go", "laravel"]);

		// DELETE cascades child rows.
		db.prepare("DELETE FROM memories WHERE id = 'm-1'").run();
		expect((db.prepare("SELECT COUNT(*) AS c FROM memory_tags WHERE memory_id = 'm-1'").get() as { c: number }).c).toBe(
			0
		);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("write-then-filter hits indexed child tables for standard + dashboard tag filters", async () => {
		const db = await createTestStore();
		const repo = "tags-filter-repo";
		const now = new Date().toISOString();

		// Standard write → filter by stack + tag.
		db.standards.insert({
			id: "std-1",
			title: "React Hooks Rule",
			content: "Use hooks for state management in React applications.",
			parent_id: null,
			context: "guide",
			version: "1.0.0",
			language: "typescript",
			stack: ["react"],
			is_global: false,
			owner: "test",
			repo,
			tags: ["react", "hooks"],
			metadata: {},
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: "test",
			model: "test"
		});

		const byStack = db.standards.search({ repo, stack: "REACT", limit: 10, offset: 0 });
		expect(byStack.some((s) => s.id === "std-1")).toBe(true);
		const byTag = db.standards.search({ repo, tag: "Hooks", limit: 10, offset: 0 });
		expect(byTag.some((s) => s.id === "std-1")).toBe(true);

		// Memory write → dashboard tag filter (LIKE-free fallback path).
		db.memories.insert({
			id: "mem-1",
			type: "code_fact",
			title: "Filament Knowledge",
			content: "Filament framework knowledge for Laravel apps.",
			importance: 3,
			agent: "test",
			role: "dev",
			model: "test",
			scope: { owner: "test", repo },
			created_at: now,
			updated_at: now,
			completed_at: null,
			hit_count: 0,
			recall_count: 0,
			last_used_at: null,
			expires_at: null,
			supersedes: null,
			status: "active",
			tags: ["Filament", "laravel"],
			metadata: {},
			is_global: false
		});

		// Case-insensitive tag filter, non-search dashboard path.
		const dash = db.memories.listMemoriesForDashboard({ repo, tag: "filament", limit: 10, offset: 0 });
		expect(dash.total).toBeGreaterThanOrEqual(1);
		expect(dash.items.some((m) => m.id === "mem-1")).toBe(true);

		// Search + tag filter → exercises the FTS fast-path tag branch too.
		const dash2 = db.memories.listMemoriesForDashboard({
			repo,
			tag: "Filament",
			search: "knowledge",
			limit: 10,
			offset: 0
		});
		expect(dash2.items.some((m) => m.id === "mem-1")).toBe(true);

		db.close();
	});
});
