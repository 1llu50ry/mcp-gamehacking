import { describe, it, expect, beforeEach } from "vitest";
import { SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { handleStandardWrite } from "../tools/standard.write";
import { handleStandardRead } from "../tools/standard.read";
import type { VectorStore } from "../types";

// ─── standard-read scope hint on code not-found (FIX-026) ─────────────────
// A code is unique per (owner, repo). A scoped miss previously surfaced a bare
// "Coding standard not found: STD-017" with no scope, so a caller holding a
// valid code could not tell which scope the lookup ran against. The not-found
// path now names the searched scope and — via a cross-scope lookup — the scope
// that actually holds the code.

describe("CSL — standard-read scope hint (FIX-026)", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(() => {
		db = new SQLiteStore(":memory:");
		vectors = new StubVectorStore(db);
	});

	it("positive: a valid scoped lookup still resolves (no regression)", async () => {
		await handleStandardWrite(
			{
				owner: "vheins",
				repo: "favori-app",
				name: "Scoped Standard",
				content: "Scoped content that is long enough.",
				tags: ["scoped"],
				metadata: { source: "scope-test" },
				json: true
			},
			db,
			vectors
		);
		const stored = db.standards.search({ repo: "favori-app", limit: 1, offset: 0 })[0];
		expect(stored.code).toBeDefined();

		const result = (await handleStandardRead(
			{ code: stored.code, owner: "vheins", repo: "favori-app", json: true },
			db,
			vectors
		)) as any;
		expect(result.structuredContent.mode).toBe("detail");
		expect(result.structuredContent.standard.code).toBe(stored.code);
	});

	it("negative: a code that exists in another scope hints the matching scope", async () => {
		await handleStandardWrite(
			{
				owner: "vheins",
				repo: "favori-app",
				name: "Scoped Standard",
				content: "Scoped content that is long enough.",
				tags: ["scoped"],
				metadata: { source: "scope-test" },
				json: true
			},
			db,
			vectors
		);
		const stored = db.standards.search({ repo: "favori-app", limit: 1, offset: 0 })[0];

		await expect(
			handleStandardRead({ code: stored.code, owner: "vheins", repo: "other-repo", json: true }, db, vectors)
		).rejects.toThrow(
			new RegExp(
				`Coding standard not found: ${stored.code} .*searched owner="vheins", repo="other-repo".*` +
					`exists in owner="vheins" repo="favori-app".*retry with that scope`
			)
		);
	});

	it("negative: a code that does not exist anywhere states the searched scope only", async () => {
		await expect(
			handleStandardRead({ code: "STD-999", owner: "vheins", repo: "favori-app", json: true }, db, vectors)
		).rejects.toThrow(/Coding standard not found: STD-999 \(searched owner="vheins", repo="favori-app"\)/);
	});

	it("negative: an unknown UUID id reports the searched scope without a cross-scope hint", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		let message = "";
		try {
			await handleStandardRead({ id: fakeId, owner: "vheins", repo: "favori-app", json: true }, db, vectors);
		} catch (err) {
			message = (err as Error).message;
		}
		expect(message).toContain(`Coding standard not found: ${fakeId}`);
		expect(message).toContain('searched owner="vheins", repo="favori-app"');
		expect(message).not.toContain("retry with that scope");
	});
});
