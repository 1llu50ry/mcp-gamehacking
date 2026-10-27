import { describe, expect, it } from "vitest";
import { createRouter } from "../router";

describe("csl-scraper prompt", () => {
	it("is listed through prompts/list", async () => {
		const router = createRouter({} as never, {} as never);

		const result = (await router("prompts/list", {})) as {
			prompts: Array<{ name: string; description: string }>;
		};

		expect(result.prompts.some((prompt) => prompt.name === "csl-scraper")).toBe(true);
	});

	it("returns substituted prompt text through prompts/get", async () => {
		const router = createRouter({} as never, {} as never);

		const result = (await router("prompts/get", {
			name: "csl-scraper",
			arguments: {
				source_url: "https://react.dev/reference/rules/rules-of-hooks"
			}
		})) as {
			description: string;
			messages: Array<{ content: { text: string } }>;
		};

		expect(result.description).toContain("atomic CSL");
		expect(result.messages[0].content.text).toContain("https://react.dev/reference/rules/rules-of-hooks");
		expect(result.messages[0].content.text).toContain("standard-store");
		expect(result.messages[0].content.text).toContain("Fetch URL");
		expect(result.messages[0].content.text).toContain("standard-search");
	});

	it("includes refusal guidance for unverifiable sources", async () => {
		const router = createRouter({} as never, {} as never);

		const result = (await router("prompts/get", {
			name: "csl-scraper",
			arguments: {
				source_url: "https://example.com/unknown"
			}
		})) as {
			messages: Array<{ content: { text: string } }>;
		};

		const promptText = result.messages[0].content.text;
		expect(promptText).toContain("Refuse if");
		expect(promptText).toContain("standard-store");
	});
});
