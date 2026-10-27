import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
	loadPromptFromMarkdown,
	loadServerInstructions,
	listPromptFiles,
	refreshPromptCache
} from "../../prompts/loader";

// ---------------------------------------------------------------------------
// src/mcp/prompts/loader.ts — disk → LoadedPrompt loader with in-memory caches.
//
// The loader resolves its prompt/server directories against its OWN __dirname
// at import time, so the directory cannot be injected. This suite therefore
// mocks the "fs" module and redirects every filesystem access under
// src/mcp/prompts into a throwaway temp directory (fs.mkdtemp inside
// os.tmpdir, removed in afterAll — .agents/documents/testing.md §5). All other fs paths
// (git-config reads, native addon loading, …) pass through to the real
// filesystem untouched. Fixture files are written inside the mock factory
// (which runs before the loader module body), so PROMPT_DIR selection is
// deterministic.
// ---------------------------------------------------------------------------

const fixture = vi.hoisted(() => {
	const state: { root: string | null } = { root: null };
	return {
		getRoot: (): string | null => state.root,
		setRoot: (root: string) => {
			state.root = root;
		}
	};
});

vi.mock("fs", async (importOriginal) => {
	const realFs = await importOriginal<typeof import("node:fs")>();
	const { default: pathMod } = await import("node:path");
	const { fileURLToPath } = await import("node:url");
	const { default: osMod } = await import("node:os");

	// Anchor: this test file lives in src/mcp/tests/prompts/, the subject
	// module root is src/mcp/prompts/.
	const realPromptsRoot = pathMod.resolve(pathMod.dirname(fileURLToPath(import.meta.url)), "../../prompts");
	const fixtureRoot = realFs.mkdtempSync(pathMod.join(realFs.realpathSync(osMod.tmpdir()), "prompt-loader-fixtures-"));
	fixture.setRoot(fixtureRoot);

	const writeFixture = (relPath: string, content: string): void => {
		const target = pathMod.join(fixtureRoot, relPath);
		realFs.mkdirSync(pathMod.dirname(target), { recursive: true });
		realFs.writeFileSync(target, content, "utf8");
	};

	writeFixture(
		"definitions/alpha.md",
		[
			"---",
			"name: Alpha Prompt",
			"description: Alpha prompt description",
			"arguments:",
			"  - name: source",
			"    description: The source URL",
			"    required: true",
			"  - name: format",
			"    description: Output format",
			"agent: backend",
			"---",
			"You are an alpha analyst.",
			"Investigate {{source}} thoroughly."
		].join("\n") + "\n"
	);
	writeFixture(
		"definitions/beta.md",
		["---", "name: Beta Prompt", "---", "Beta body line one.", "  Beta body line two with trailing spaces.   "].join(
			"\n"
		) + "\n"
	);
	writeFixture("definitions/minimal.md", "Just plain markdown content for minimal.\n");
	writeFixture(
		"definitions/special.md",
		[
			"---",
			"name: custom-name",
			"description: Override prompt description",
			"---",
			"Body for the override prompt."
		].join("\n") + "\n"
	);
	writeFixture(
		"server/instructions.md",
		[
			"---",
			"title: Server Instructions",
			"---",
			"Operate as a careful senior engineer.",
			"Keep responses concise and cite sources."
		].join("\n") + "\n"
	);

	const translate = (p: string): string => {
		const prefix = realPromptsRoot + pathMod.sep;
		return p.startsWith(prefix) ? pathMod.join(fixtureRoot, p.slice(prefix.length)) : p;
	};

	const existsSync = (p: string): boolean => realFs.existsSync(translate(p));
	const readdirSync = (p: string): string[] => realFs.readdirSync(translate(p));
	const readFileSync = (p: string, encoding?: BufferEncoding | null): string | Buffer =>
		realFs.readFileSync(translate(p), encoding ?? undefined);

	const mockFs = { ...realFs, existsSync, readdirSync, readFileSync };
	return { ...realFs, ...mockFs, default: mockFs };
});

const FIXTURES: Record<string, string> = {
	"alpha.md":
		[
			"---",
			"name: Alpha Prompt",
			"description: Alpha prompt description",
			"arguments:",
			"  - name: source",
			"    description: The source URL",
			"    required: true",
			"  - name: format",
			"    description: Output format",
			"agent: backend",
			"---",
			"You are an alpha analyst.",
			"Investigate {{source}} thoroughly."
		].join("\n") + "\n",
	"beta.md":
		["---", "name: Beta Prompt", "---", "Beta body line one.", "  Beta body line two with trailing spaces.   "].join(
			"\n"
		) + "\n",
	"minimal.md": "Just plain markdown content for minimal.\n",
	"special.md":
		[
			"---",
			"name: custom-name",
			"description: Override prompt description",
			"---",
			"Body for the override prompt."
		].join("\n") + "\n"
};

const ALPHA_UPDATED =
	[
		"---",
		"name: Alpha Prompt",
		"description: Alpha prompt description (updated)",
		"agent: backend",
		"---",
		"You are an alpha analyst (v2)."
	].join("\n") + "\n";

const SERVER_INSTRUCTIONS =
	[
		"---",
		"title: Server Instructions",
		"---",
		"Operate as a careful senior engineer.",
		"Keep responses concise and cite sources."
	].join("\n") + "\n";

beforeEach(() => {
	const root = fixture.getRoot();
	if (!root) throw new Error("fixture root was not created");
	fs.mkdirSync(path.join(root, "definitions"), { recursive: true });
	for (const [file, content] of Object.entries(FIXTURES)) {
		fs.writeFileSync(path.join(root, "definitions", file), content, "utf8");
	}
	fs.mkdirSync(path.join(root, "server"), { recursive: true });
	fs.writeFileSync(path.join(root, "server", "instructions.md"), SERVER_INSTRUCTIONS, "utf8");
	refreshPromptCache();
});

afterAll(() => {
	const root = fixture.getRoot();
	if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("listPromptFiles", () => {
	it("lists prompt names without the .md extension, sorted", () => {
		expect(listPromptFiles()).toEqual(["alpha", "beta", "minimal", "special"]);
	});

	it("ignores non-markdown files", () => {
		const root = fixture.getRoot();
		if (!root) throw new Error("fixture root was not created");
		fs.writeFileSync(path.join(root, "definitions", "notes.txt"), "not a prompt", "utf8");
		fs.writeFileSync(path.join(root, "definitions", "image.png"), "not a prompt", "utf8");
		refreshPromptCache();
		expect(listPromptFiles()).toEqual(["alpha", "beta", "minimal", "special"]);
	});

	it("returns an empty list when the prompt directory is absent", () => {
		const root = fixture.getRoot();
		if (!root) throw new Error("fixture root was not created");
		fs.rmSync(path.join(root, "definitions"), { recursive: true, force: true });
		refreshPromptCache();
		expect(listPromptFiles()).toEqual([]);
		// Loading from a missing directory fails with the documented error.
		expect(() => loadPromptFromMarkdown("alpha")).toThrow(/Prompt file not found/);
	});

	it("dedupes repeated reads through the file-list cache", () => {
		expect(listPromptFiles()).toBe(listPromptFiles());
	});

	it("reflects newly added files only after refreshPromptCache", () => {
		expect(listPromptFiles()).not.toContain("gamma");
		const root = fixture.getRoot();
		if (!root) throw new Error("fixture root was not created");
		fs.writeFileSync(path.join(root, "definitions", "gamma.md"), "---\nname: Gamma\n---\nGamma body.\n", "utf8");
		// The cached list is intentionally stale until refresh.
		expect(listPromptFiles()).not.toContain("gamma");
		refreshPromptCache();
		expect(listPromptFiles()).toContain("gamma");
		expect(listPromptFiles()).toEqual(["alpha", "beta", "gamma", "minimal", "special"]);
		// Restore the pristine fixture set for sibling tests.
		fs.rmSync(path.join(root, "definitions", "gamma.md"), { force: true });
		refreshPromptCache();
	});
});

describe("loadPromptFromMarkdown", () => {
	it("round-trips a fully-annotated markdown prompt into a LoadedPrompt", () => {
		const loaded = loadPromptFromMarkdown("alpha");
		expect(loaded).toEqual({
			name: "Alpha Prompt",
			description: "Alpha prompt description",
			arguments: [
				{ name: "source", description: "The source URL", required: true },
				{ name: "format", description: "Output format" }
			],
			agent: "backend",
			content: "You are an alpha analyst.\nInvestigate {{source}} thoroughly."
		});
	});

	it("falls back to the filename and empty defaults when frontmatter is sparse", () => {
		const loaded = loadPromptFromMarkdown("minimal");
		expect(loaded.name).toBe("minimal");
		expect(loaded.description).toBe("");
		expect(loaded.arguments).toEqual([]);
		expect(loaded.agent).toBeUndefined();
		expect(loaded.content).toBe("Just plain markdown content for minimal.");
	});

	it("prefers the frontmatter name over the filename", () => {
		const loaded = loadPromptFromMarkdown("special");
		expect(loaded.name).toBe("custom-name");
		expect(loaded.description).toBe("Override prompt description");
	});

	it("trims leading and trailing whitespace from the prompt body", () => {
		const loaded = loadPromptFromMarkdown("beta");
		expect(loaded.content).toBe("Beta body line one.\n  Beta body line two with trailing spaces.");
		expect(loaded.content.endsWith("trailing spaces.")).toBe(true);
	});

	it("throws a descriptive error for an unknown prompt file", () => {
		expect(() => loadPromptFromMarkdown("missing-prompt")).toThrow(/Prompt file not found/);
	});

	it("dedupes repeated loads through the per-prompt cache", () => {
		expect(loadPromptFromMarkdown("alpha")).toBe(loadPromptFromMarkdown("alpha"));
	});

	it("keeps serving the cached object until refreshPromptCache forces a reload", () => {
		const first = loadPromptFromMarkdown("alpha");
		expect(first.description).toBe("Alpha prompt description");
		const root = fixture.getRoot();
		if (!root) throw new Error("fixture root was not created");
		fs.writeFileSync(path.join(root, "definitions", "alpha.md"), ALPHA_UPDATED, "utf8");
		// Cache is still warm — the mutated file is not observed yet.
		expect(loadPromptFromMarkdown("alpha")).toBe(first);
		refreshPromptCache();
		const reloaded = loadPromptFromMarkdown("alpha");
		expect(reloaded).not.toBe(first);
		expect(reloaded.description).toBe("Alpha prompt description (updated)");
		expect(reloaded.content).toBe("You are an alpha analyst (v2).");
	});
});

describe("loadServerInstructions", () => {
	it("loads the server instructions, stripping frontmatter and trimming", () => {
		const text = loadServerInstructions();
		expect(text).toBe("Operate as a careful senior engineer.\nKeep responses concise and cite sources.");
		expect(text).not.toContain("---");
	});

	it("dedupes repeated reads through the server-instructions cache", () => {
		expect(loadServerInstructions()).toBe(loadServerInstructions());
	});

	it("throws a descriptive error when the instructions file is missing", () => {
		const root = fixture.getRoot();
		if (!root) throw new Error("fixture root was not created");
		fs.rmSync(path.join(root, "server"), { recursive: true, force: true });
		refreshPromptCache();
		expect(() => loadServerInstructions()).toThrow(/Server instructions file not found/);
	});
});
