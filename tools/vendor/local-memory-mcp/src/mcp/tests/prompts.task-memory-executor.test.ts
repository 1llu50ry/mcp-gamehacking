import { describe, expect, it } from "vitest";
import { createRouter } from "../router";

describe("task-memory-executor prompt", () => {
	it("is listed through prompts/list", async () => {
		const router = createRouter({} as never, {} as never);

		const result = (await router("prompts/list", { limit: 50 })) as {
			prompts: Array<{ name: string; description: string }>;
		};

		expect(result.prompts.some((prompt) => prompt.name === "task-memory-executor")).toBe(true);
	});

	it("enforces dependency-aware execution order in prompt text", async () => {
		const router = createRouter({} as never, {} as never);

		const result = (await router("prompts/get", {
			name: "task-memory-executor",
			arguments: {}
		})) as {
			messages: Array<{ content: { text: string } }>;
		};

		const promptText = result.messages[0].content.text;
		expect(promptText).toContain("dependency readiness");
		expect(promptText).toContain("memory-read");
		expect(promptText).toContain("standard-read");
		expect(promptText).toContain("blocker");
	});
});
