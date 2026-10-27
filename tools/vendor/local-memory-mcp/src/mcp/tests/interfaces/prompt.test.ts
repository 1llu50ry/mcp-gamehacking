import { describe, it, expect, expectTypeOf } from "vitest";
import type { LoadedPrompt } from "../../interfaces/prompt";

// ---------------------------------------------------------------------------
// src/mcp/interfaces/prompt.ts — LoadedPrompt is a pure type contract consumed
// by src/mcp/prompts/loader.ts (producer), src/mcp/prompts/registry.ts and
// src/mcp/prompts/sdk-index.ts (consumers). Positive cases assert the exact
// structural contract via expectTypeOf (enforced by `tsc -p tsconfig.test.json`);
// negative cases pin rejection via @ts-expect-error directives.
// ---------------------------------------------------------------------------

describe("LoadedPrompt", () => {
	it("is exactly the documented field contract", () => {
		expectTypeOf<LoadedPrompt>().toEqualTypeOf<{
			name: string;
			description: string;
			arguments: Record<string, unknown>[];
			content: string;
			agent?: string;
		}>();
	});

	it("accepts a minimal prompt (agent omitted)", () => {
		const prompt: LoadedPrompt = {
			name: "task-memory-executor",
			description: "Executes MCP tasks from task memory.",
			arguments: [],
			content: "You are responsible for executing the following task."
		};
		expect(prompt.name).toBe("task-memory-executor");
		expect(prompt.description).toContain("Executes MCP tasks");
		expect(prompt.arguments).toEqual([]);
		expect(prompt.agent).toBeUndefined();
	});

	it("accepts a fully populated prompt with agent metadata", () => {
		const prompt: LoadedPrompt = {
			name: "task-memory-executor",
			description: "Executes MCP tasks from task memory.",
			arguments: [
				{ name: "task_code", required: true, description: "Task code to execute" },
				{ name: "phase", description: "Optional phase override" }
			],
			content: "You are responsible for executing the following task.",
			agent: "backend"
		};
		expect(prompt.agent).toBe("backend");
		expect(prompt.arguments).toHaveLength(2);
	});

	it("allows an empty arguments array (loader defaults to [])", () => {
		const prompt: LoadedPrompt = {
			name: "no-args",
			description: "Prompt without arguments",
			arguments: [],
			content: "Body"
		};
		expect(prompt.arguments.length).toBe(0);
	});

	it("rejects an object missing required fields", () => {
		// @ts-expect-error — description, arguments and content are required
		const bad: LoadedPrompt = { name: "task-memory-executor" };
		expect(bad).toBeDefined();
	});

	it("rejects a non-string name", () => {
		// @ts-expect-error — name must be a string
		const bad: LoadedPrompt = { name: 42, description: "d", arguments: [], content: "c" };
		expect(bad).toBeDefined();
	});

	it("rejects a non-array arguments value", () => {
		// @ts-expect-error — arguments must be an array
		const bad: LoadedPrompt = { name: "n", description: "d", arguments: "nope", content: "c" };
		expect(bad).toBeDefined();
	});

	it("rejects non-object entries inside arguments", () => {
		// @ts-expect-error — array entries must be Record<string, unknown>
		const bad: LoadedPrompt = { name: "n", description: "d", arguments: ["plain-string"], content: "c" };
		expect(bad).toBeDefined();
	});

	it("rejects a non-string content value", () => {
		// @ts-expect-error — content must be a string
		const bad: LoadedPrompt = { name: "n", description: "d", arguments: [], content: 42 };
		expect(bad).toBeDefined();
	});

	it("rejects a non-string agent value", () => {
		// @ts-expect-error — agent must be a string when present
		const bad: LoadedPrompt = { name: "n", description: "d", arguments: [], content: "c", agent: 42 };
		expect(bad).toBeDefined();
	});
});

describe("LoadedPrompt consumer contracts", () => {
	it("supports the field accesses made by prompts/loader.ts and prompts/registry.ts", () => {
		const loaded: LoadedPrompt = {
			name: "task-memory-executor",
			description: "Executes MCP tasks.",
			arguments: [{ name: "task_code", required: true }],
			content: "Body",
			agent: "backend"
		};

		// Mirrors createPromptDefinition() in prompts/registry.ts
		const definition = {
			name: loaded.name,
			description: loaded.description,
			arguments: loaded.arguments,
			agent: loaded.agent,
			messages: [
				{
					role: "user" as const,
					content: { type: "text" as const, text: loaded.content }
				}
			]
		};
		expectTypeOf(definition).toMatchTypeOf<{
			name: string;
			description: string;
			arguments: Record<string, unknown>[];
			agent?: string;
			messages: { role: "user"; content: { type: "text"; text: string } }[];
		}>();
	});

	it("yields unknown for arbitrary argument-entry fields (sdk-index.ts reads)", () => {
		const loaded: LoadedPrompt = {
			name: "task-memory-executor",
			description: "Executes MCP tasks.",
			arguments: [{ name: "task_code", description: "Task code", required: true }],
			content: "Body"
		};
		expectTypeOf(loaded.arguments).toEqualTypeOf<Record<string, unknown>[]>();
		for (const arg of loaded.arguments) {
			expectTypeOf(arg).toEqualTypeOf<Record<string, unknown>>();
			expectTypeOf(arg.name).toEqualTypeOf<unknown>();
		}
	});
});
