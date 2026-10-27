import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import type { SessionContext } from "../../session";
import { completePromptArgument, getPrompt, listPrompts, PROMPTS } from "../../prompts/registry";

// ---------------------------------------------------------------------------
// src/mcp/prompts/registry.ts — indexes loader output into PROMPTS and serves
// the MCP prompts/list + prompts/get surface.
//
// PROMPTS is populated at module import from the (mocked) filesystem, so this
// suite redirects every fs access under src/mcp/prompts into a throwaway temp
// directory — same technique as loader.test.ts. The fixture files are written
// inside the mock factory, before the registry module body evaluates, so all
// four PROMPTS entries are deterministic. Non-prompts fs paths (git-config
// reads, native addon loading) pass through to the real filesystem.
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
	const fixtureRoot = realFs.mkdtempSync(
		pathMod.join(realFs.realpathSync(osMod.tmpdir()), "prompt-registry-fixtures-")
	);
	fixture.setRoot(fixtureRoot);

	const writeFixture = (relPath: string, content: string): void => {
		const target = pathMod.join(fixtureRoot, relPath);
		realFs.mkdirSync(pathMod.dirname(target), { recursive: true });
		realFs.writeFileSync(target, content, "utf8");
	};

	writeFixture(
		"definitions/plato.md",
		[
			"---",
			"name: plato-republic",
			"description: Philosophy prompt",
			"arguments:",
			"  - name: dialog",
			"    description: Dialogue to analyze",
			"    required: true",
			"agent: philosopher",
			"---",
			"Discuss {{dialog}} for {{current_repo}} by {{current_owner}}."
		].join("\n") + "\n"
	);
	writeFixture(
		"definitions/socrates.md",
		["---", "name: socrates", "---", "Socratic questioning for {{current_repo}}."].join("\n") + "\n"
	);
	writeFixture("definitions/zeno.md", ["---", "name: zeno", "---", "Zeno paradox analysis."].join("\n") + "\n");
	writeFixture(
		"definitions/placeholder.md",
		[
			"---",
			"name: placeholder",
			"description: Placeholder prompt",
			"---",
			"Paren: {{(}}",
			"Dot: {{a.b}}",
			"Repo={{current_repo}} Owner={{current_owner}}"
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

afterAll(() => {
	const root = fixture.getRoot();
	if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("PROMPTS (loader → registry round-trip)", () => {
	it("indexes every prompt file under its filename, exactly once", () => {
		expect(Object.keys(PROMPTS).sort()).toEqual(["placeholder", "plato", "socrates", "zeno"]);
		expect(new Set(Object.keys(PROMPTS)).size).toBe(Object.keys(PROMPTS).length);
	});

	it("builds an MCP prompt definition from the loaded prompt", () => {
		const plato = PROMPTS.plato;
		expect(plato.name).toBe("plato-republic");
		expect(plato.description).toBe("Philosophy prompt");
		expect(plato.arguments).toEqual([{ name: "dialog", description: "Dialogue to analyze", required: true }]);
		expect(plato.agent).toBe("philosopher");
		expect(plato.messages).toEqual([
			{
				role: "user",
				content: { type: "text", text: "Discuss {{dialog}} for {{current_repo}} by {{current_owner}}." }
			}
		]);
	});

	it("preserves the frontmatter name override through the registry", () => {
		expect(PROMPTS.plato.name).toBe("plato-republic");
		expect(PROMPTS.plato.name).not.toBe("plato");
	});
});

describe("listPrompts", () => {
	it("returns all prompts with metadata and no cursor when everything fits", async () => {
		const result = await listPrompts({} as never);
		expect(result.prompts.map((p) => p.name)).toEqual(["placeholder", "plato-republic", "socrates", "zeno"]);
		expect(result.nextCursor).toBeUndefined();

		const plato = result.prompts.find((p) => p.name === "plato-republic");
		expect(plato?.description).toBe("Philosophy prompt");
		expect(plato?.metadata).toEqual({ agent: "philosopher" });

		const socrates = result.prompts.find((p) => p.name === "socrates");
		expect(socrates?.description).toBe("");
		expect(socrates?.metadata).toBeUndefined();
	});

	it("paginates with limit and a round-trip cursor", async () => {
		const page1 = await listPrompts({} as never, undefined, { limit: 2 });
		expect(page1.prompts.map((p) => p.name)).toEqual(["placeholder", "plato-republic"]);
		expect(page1.nextCursor).toBeDefined();
		expect(typeof page1.nextCursor).toBe("string");

		const page2 = await listPrompts({} as never, undefined, { cursor: page1.nextCursor, limit: 10 });
		expect(page2.prompts.map((p) => p.name)).toEqual(["socrates", "zeno"]);
		expect(page2.nextCursor).toBeUndefined();
	});

	it("clamps the limit to the [1, 100] range and defaults non-integers to 50", async () => {
		expect((await listPrompts({} as never, undefined, { limit: 0 })).prompts).toHaveLength(1);
		expect((await listPrompts({} as never, undefined, { limit: -3 })).prompts).toHaveLength(1);
		// Non-integer limits are rejected entirely (fall back to the default 50).
		expect((await listPrompts({} as never, undefined, { limit: 2.9 })).prompts).toHaveLength(4);
		// Above the clamp: 100, which still covers the whole fixture set.
		expect((await listPrompts({} as never, undefined, { limit: 1000 })).prompts).toHaveLength(4);
	});

	it("rejects a malformed cursor with the MCP invalid-params code", async () => {
		const badCursor = Buffer.from("abc").toString("base64"); // decodes to the non-numeric string "abc"
		await expect(listPrompts({} as never, undefined, { cursor: badCursor })).rejects.toMatchObject({ code: -32602 });
	});
});

describe("getPrompt", () => {
	// The root lives under a plausible, non-reserved parent segment so owner
	// inference (parent-directory fallback) yields a real owner. A bare
	// `file:///tmp/fake-repo` root would resolve its owner to the reserved OS
	// segment `tmp`, which FIX-029's `isPlausibleScopeSegment` rejects.
	const session = {
		roots: [{ uri: "file:///tmp/alice-project/fake-repo", name: "fake-repo" }]
	} as unknown as SessionContext;

	it("substitutes arguments and auto-injected repo/owner context", async () => {
		const result = await getPrompt("plato", { dialog: "Phaedo" }, {} as never, session);
		expect(result.description).toBe("Philosophy prompt");
		expect(result.metadata).toEqual({ agent: "philosopher" });
		expect(result.messages).toEqual([
			{
				role: "user",
				content: { type: "text", text: "Discuss Phaedo for fake-repo by alice-project." }
			}
		]);
	});

	it("falls back to unknown-repo/unknown-owner when no session is provided", async () => {
		const result = await getPrompt("socrates", {}, {} as never);
		expect(result.messages[0].content.text).toBe("Socratic questioning for unknown-repo.");
		expect(result.metadata).toBeUndefined();
	});

	it("defaults missing arguments to an empty substitution map", async () => {
		const result = await getPrompt("plato", undefined, {} as never, session);
		expect(result.messages[0].content.text).toContain("{{dialog}}");
	});

	it("escapes regex metacharacters in client-supplied argument keys", async () => {
		// Keys like "(" or "a.b" must never throw a RegExp SyntaxError
		// (parity with sdk-index.ts prompt substitution).
		const result = await getPrompt("placeholder", { "(": "open", "a.b": "dot" }, {} as never);
		const text = result.messages[0].content.text;
		expect(text).toContain("Paren: open");
		expect(text).toContain("Dot: dot");
	});

	it("leaves unmatched templates untouched while still auto-injecting context", async () => {
		const result = await getPrompt("placeholder", { "[x": "y" }, {} as never);
		const text = result.messages[0].content.text;
		expect(text).toContain("{{(}}");
		expect(text).toContain("{{a.b}}");
		expect(text).toContain("Repo=unknown-repo Owner=unknown-owner");
	});

	it("throws for an unknown prompt name", async () => {
		await expect(getPrompt("no-such-prompt", {}, {} as never)).rejects.toThrow("Prompt not found: no-such-prompt");
	});
});

describe("completePromptArgument", () => {
	const tasks = { tasks: [{ id: "task-2" }, { id: "task-1" }, { id: "task-2" }, { id: "task-10" }] };

	it("ranks task ids for the task_id argument", async () => {
		const result = await completePromptArgument("task-memory-executor", "task_id", "task-1", {}, tasks);
		expect(result).toEqual(["task-1", "task-10"]);
	});

	it("returns every unique task id when the input is empty", async () => {
		const result = await completePromptArgument("task-memory-executor", "task_id", "", {}, tasks);
		expect(result).toEqual(["task-2", "task-1", "task-10"]);
	});

	it("returns no completions for unknown arguments", async () => {
		const result = await completePromptArgument("task-memory-executor", "memory_id", "x", {}, tasks);
		expect(result).toEqual([]);
	});

	it("returns no completions when there are no tasks", async () => {
		const result = await completePromptArgument("task-memory-executor", "task_id", "task", {}, { tasks: [] });
		expect(result).toEqual([]);
	});
});
