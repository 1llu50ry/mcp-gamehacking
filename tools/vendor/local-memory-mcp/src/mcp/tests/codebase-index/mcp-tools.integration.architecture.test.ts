import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { REPO, data, setupIntegrationFixture } from "./mcp-tools.integration.shared.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { VectorStore } from "../../types.js";

let store: SQLiteStore;
let vectors: VectorStore;

beforeAll(async () => {
	const fixture = await setupIntegrationFixture();
	store = fixture.store;
	vectors = fixture.vectors;
});

afterAll(() => {
	store.close();
});

describe("handleCodebaseRead (architecture mode)", () => {
	it("returns directory tree with correct depth", async () => {
		const resp = await handleCodebaseRead({ owner: "vheins", json: true, repo: REPO, depth: 2 }, store, vectors);
		const d = data(resp);

		// Root
		expect(d.root).toBeDefined();
		const root = d.root as Record<string, unknown>;
		expect(root.name).toBe(".");
		expect(root.type).toBe("directory");

		const children = root.children as Array<Record<string, unknown>>;
		expect(children.length).toBeGreaterThanOrEqual(4); // 3 root files + components/

		// Root-level files should be present
		const fileNames = children.filter((c) => c.type === "file").map((c) => c.name);
		expect(fileNames).toContain("index.ts");
		expect(fileNames).toContain("utils.ts");
		expect(fileNames).toContain("types.ts");

		// components/ directory should be expanded at depth 2
		const compDir = children.find((c) => c.name === "components");
		expect(compDir).toBeDefined();
		expect(compDir!.type).toBe("directory");
		expect(compDir!.children).toBeDefined();
	});

	it("symbol counts are accurate", async () => {
		const resp = await handleCodebaseRead({ owner: "vheins", json: true, repo: REPO, depth: 2 }, store, vectors);
		const d = data(resp);

		const summary = d.summary as Record<string, unknown>;
		expect(summary.totalFiles).toBe(4);
		expect(summary.totalSymbols).toBe(22);

		// Top-level exports (exported + no parent) = all exported symbols
		const topExports = summary.topLevelExports as Array<Record<string, unknown>>;
		expect(topExports.length).toBeGreaterThan(0);
	});

	it("language breakdown shows TypeScript and TSX", async () => {
		const resp = await handleCodebaseRead({ owner: "vheins", json: true, repo: REPO, depth: 2 }, store, vectors);
		const d = data(resp);

		const summary = d.summary as Record<string, unknown>;
		const langBreakdown = summary.languageBreakdown as Record<string, number>;

		expect(langBreakdown["typescript"]).toBe(3);
		expect(langBreakdown["tsx"]).toBe(1);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// codebase-read: trace mode (via name)
// ═══════════════════════════════════════════════════════════════════════
