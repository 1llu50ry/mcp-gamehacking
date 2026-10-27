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

describe("handleCodebaseRead (file mode)", () => {
	it("returns all symbols in a known file", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo: REPO, filePath: "index.ts" },
			store,
			vectors
		);
		const d = data(resp);

		expect(d.error).toBeUndefined();
		expect(d.file).toBeDefined();
		const file = d.file as Record<string, unknown>;
		expect(file.path).toBe("index.ts");
		expect(file.language).toBe("typescript");

		const symbols = d.symbols as Array<Record<string, unknown>>;
		expect(symbols.length).toBe(5);

		const names = symbols.map((s) => s.name);
		expect(names).toContain("AppConfig");
		expect(names).toContain("initializeApp");
		expect(names).toContain("Application");
		expect(names).toContain("DEFAULT_CONFIG");
		expect(names).toContain("createAppRunner");
	});

	it("returns symbols in declaration order (by start_line)", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo: REPO, filePath: "index.ts" },
			store,
			vectors
		);
		const d = data(resp);
		const symbols = d.symbols as Array<Record<string, unknown>>;

		// Symbols should be ordered by start_line ASC
		expect(symbols[0].name).toBe("AppConfig"); // line 6
		expect(symbols[1].name).toBe("initializeApp"); // line 13
		expect(symbols[2].name).toBe("Application"); // line 17
		expect(symbols[3].name).toBe("DEFAULT_CONFIG"); // line 35
		expect(symbols[4].name).toBe("createAppRunner"); // line 42
	});

	it("returns error for non-indexed file", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo: REPO, filePath: "nonexistent.ts" },
			store,
			vectors
		);
		const d = data(resp);

		expect(d.error).toBe("File not indexed. Run index_repository first.");
		expect(d.code).toBe("FILE_NOT_INDEXED");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// codebase-read: architecture mode (via depth)
// ═══════════════════════════════════════════════════════════════════════
