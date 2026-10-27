import { describe, expect, it } from "vitest";
import type { SessionContext } from "../session";
import { handlePromptRead } from "../tools/prompt.read";
import { toErrorResponse, type ToolErrorEnvelope } from "../utils/mcp-error";
import { getPrimaryTextContent } from "../utils/mcp-response";

/**
 * prompt-read coverage (mirrors src/mcp/tools/prompt.read.ts).
 *
 * The handler is a pure read over the loader cache — it never touches a DB —
 * so these tests exercise `handlePromptRead` directly. The loader resolves the
 * dev candidate `./definitions` (next to loader.ts) at import time, so the
 * real src/mcp/prompts/definitions/ fixtures are read without any setup.
 *
 * Error classification is asserted through `toErrorResponse` (the exact
 * conversion the router / SDK transport applies to a thrown handler error).
 */

/** Minimal session context that makes owner/repo inference deterministic. */
const SESSION: SessionContext = {
	roots: [{ uri: "file:///tmp/vheins/local-memory-mcp", name: "local-memory-mcp" }],
	owner: "vheins",
	repo: "local-memory-mcp",
	supportsRoots: true,
	supportsSampling: false,
	supportsSamplingTools: false,
	supportsElicitation: false,
	supportsElicitationForm: false,
	supportsElicitationUrl: false
};

type PromptEnvelope = {
	schema: "prompt-read";
	mode: "list" | "detail";
	prompts?: Array<{ name: string; description: string; agent?: string; arguments: unknown }>;
	count?: number;
	prompt?: { name: string; description: string; agent?: string; content: string };
};

describe("prompt-read — LIST mode", () => {
	it("returns the full catalog with name/description/agent/arguments per entry", () => {
		const res = handlePromptRead({ json: true });
		const data = res.structuredContent as PromptEnvelope | undefined;

		expect(data?.schema).toBe("prompt-read");
		expect(data?.mode).toBe("list");
		expect(data?.prompts).toBeDefined();
		expect(data?.count).toBeGreaterThan(0);
		expect(data?.count).toBe(data?.prompts?.length);

		const prompts = data?.prompts ?? [];
		for (const entry of prompts) {
			expect(entry).toHaveProperty("name");
			expect(entry).toHaveProperty("description");
			expect(entry).toHaveProperty("agent");
			expect(entry).toHaveProperty("arguments");
		}
	});

	it("catalog text content lists every prompt with a usage hint", () => {
		const res = handlePromptRead({});
		const text = getPrimaryTextContent(res);

		expect(text).toContain("### Prompts (");
		expect(text).toContain("Use prompt-read with name for full content.");
	});

	it("does not emit structuredContent unless json:true is passed", () => {
		const plain = handlePromptRead({});
		expect(plain.structuredContent).toBeUndefined();
		expect(getPrimaryTextContent(plain).length).toBeGreaterThan(0);

		const withJson = handlePromptRead({ json: true });
		const data = withJson.structuredContent as PromptEnvelope;
		expect(data.schema).toBe("prompt-read");
		expect(data.mode).toBe("list");
	});
});

describe("prompt-read — DETAIL mode", () => {
	it("returns {name, description, agent, content} for a known prompt", () => {
		const res = handlePromptRead({ name: "csl-scraper", json: true });
		const data = res.structuredContent as PromptEnvelope;

		expect(data.schema).toBe("prompt-read");
		expect(data.mode).toBe("detail");
		expect(data.prompt?.name).toBe("csl-scraper");
		expect(data.prompt?.description).toContain("atomic CSL");
		expect(data.prompt?.agent).toBe("Documentation Scraper");
		expect(typeof data.prompt?.content).toBe("string");
	});

	it("renders DETAIL text content with the substituted body (no raw placeholders)", () => {
		const res = handlePromptRead({ name: "session-planner", args: { objective: "Plan the release" } });
		const text = getPrimaryTextContent(res);
		expect(text).toContain("Objective: Plan the release");
		expect(text).not.toContain("{{objective}}");
	});

	it("substitutes {{var}} placeholders from args in DETAIL content", () => {
		const res = handlePromptRead({
			name: "session-planner",
			args: { objective: "Ship the prompt-read PR" },
			json: true
		});
		const data = res.structuredContent as PromptEnvelope;
		expect(data.prompt?.content).toContain("Objective: Ship the prompt-read PR");
		expect(data.prompt?.content).not.toContain("{{objective}}");
	});

	it("keeps unmatched placeholders and strips args that are not in the body", () => {
		const res = handlePromptRead({
			name: "session-planner",
			args: { not_in_body: "x" },
			json: true
		});
		const data = res.structuredContent as PromptEnvelope;
		expect(data.prompt?.content).toContain("Objective: {{objective}}");
	});

	it("trims surrounding whitespace from the requested name", () => {
		const res = handlePromptRead({ name: "  session-planner  ", json: true });
		const data = res.structuredContent as PromptEnvelope;
		expect(data.prompt?.name).toBe("session-planner");
	});
});

describe("prompt-read — session context injection", () => {
	it("injects current_repo/current_owner from the session into DETAIL content", () => {
		const res = handlePromptRead(
			{ name: "csl-scraper", args: { source_url: "https://example.com/docs" }, json: true },
			SESSION
		);
		const data = res.structuredContent as PromptEnvelope;
		const content = data.prompt?.content ?? "";

		expect(content).toContain("Source: https://example.com/docs");
		expect(content).toContain("Owner: vheins");
		expect(content).toContain("Repo: local-memory-mcp");
	});

	it("never lets args override the reserved current_repo/current_owner keys", () => {
		const res = handlePromptRead(
			{
				name: "csl-scraper",
				args: {
					source_url: "https://example.com/docs",
					current_repo: "spoofed-repo",
					current_owner: "spoofed-owner"
				},
				json: true
			},
			SESSION
		);
		const data = res.structuredContent as PromptEnvelope;
		const content = data.prompt?.content ?? "";

		expect(content).toContain("Owner: vheins");
		expect(content).toContain("Repo: local-memory-mcp");
		expect(content).not.toContain("spoofed-repo");
		expect(content).not.toContain("spoofed-owner");
	});

	it("uses unknown-owner/unknown-repo fallbacks when no session context resolves", () => {
		const res = handlePromptRead({ name: "csl-scraper", json: true });
		const data = res.structuredContent as PromptEnvelope;
		const content = data.prompt?.content ?? "";
		expect(content).toContain("Owner: unknown-owner");
		expect(content).toContain("Repo: unknown-repo");
	});
});

describe("prompt-read — substitution hardening", () => {
	it("treats $-prefixed replacement patterns in values as literal text", () => {
		const res = handlePromptRead({
			name: "session-planner",
			args: { objective: "cost $100 and $1 per item & $& total" },
			json: true
		});
		const data = res.structuredContent as PromptEnvelope;
		expect(data.prompt?.content).toContain("Objective: cost $100 and $1 per item & $& total");
	});

	it("escapes regex metacharacters in substitution keys", () => {
		const res = handlePromptRead({
			name: "session-planner",
			args: { "obje(ct": "v" },
			json: true
		});
		const data = res.structuredContent as PromptEnvelope;
		// No RegExp SyntaxError — the unmatched placeholder stays literal.
		expect(data.prompt?.content).toContain("Objective: {{objective}}");
	});
});

describe("prompt-read — unknown / traversal names", () => {
	const envelopeFor = (name: string): ToolErrorEnvelope => {
		let response;
		try {
			response = handlePromptRead({ name });
		} catch (err) {
			response = toErrorResponse(err);
		}
		const envelope = response?.structuredContent as ToolErrorEnvelope;
		expect(envelope).toBeDefined();
		return envelope;
	};

	it("rejects a traversal name without touching the filesystem", () => {
		const envelope = envelopeFor("../../../etc/passwd");
		expect(envelope.schema).toBe("tool-error");
		expect(envelope.code).toBe("NOT_FOUND");
		expect(envelope.retryable).toBe(false);
	});

	it("rejects an unknown prompt name with a NOT_FOUND envelope", () => {
		const envelope = envelopeFor("nonexistent-prompt-xyz");
		expect(envelope.schema).toBe("tool-error");
		expect(envelope.code).toBe("NOT_FOUND");
		expect(envelope.message).toContain("nonexistent-prompt-xyz");
	});

	it("classifies the handler's NOT_FOUND throw identically at the transport", () => {
		// Direct-call contract: the handler throws a NOT_FOUND-classified Error.
		expect(() => handlePromptRead({ name: "csl-scraper-missing" })).toThrow(/not found/i);

		// Transport conversion of that same throw yields the canonical envelope.
		const envelope = toErrorResponse(
			(() => {
				try {
					handlePromptRead({ name: "csl-scraper-missing" });
					return undefined;
				} catch (err) {
					return err;
				}
			})()
		).structuredContent as ToolErrorEnvelope;
		expect(envelope.code).toBe("NOT_FOUND");
	});
});

describe("prompt-read — schema bounds", () => {
	const envelopeFor = (params: Record<string, unknown>): ToolErrorEnvelope => {
		let response;
		try {
			response = handlePromptRead(params);
		} catch (err) {
			response = toErrorResponse(err);
		}
		const envelope = response?.structuredContent as ToolErrorEnvelope;
		expect(envelope).toBeDefined();
		return envelope;
	};

	it("rejects a name longer than 120 chars", () => {
		const envelope = envelopeFor({ name: "x".repeat(121) });
		expect(envelope.schema).toBe("tool-error");
		expect(envelope.code).toBe("VALIDATION_ERROR");
	});

	it("accepts a name of exactly 120 chars", () => {
		// Exactly 120 chars passes the schema, then fails the allowlist as NOT_FOUND.
		const envelope = envelopeFor({ name: "x".repeat(120) });
		expect(envelope.code).toBe("NOT_FOUND");
	});

	it("rejects more than 50 substitution keys", () => {
		const args: Record<string, string> = {};
		for (let i = 0; i < 51; i += 1) {
			args[`key${i}`] = "v";
		}
		const envelope = envelopeFor({ name: "session-planner", args });
		expect(envelope.schema).toBe("tool-error");
		expect(envelope.code).toBe("VALIDATION_ERROR");
		expect(envelope.message).toContain("args must contain at most 50 substitution keys");
	});

	it("accepts exactly 50 substitution keys", () => {
		const args: Record<string, string> = {};
		for (let i = 0; i < 50; i += 1) {
			args[`key${i}`] = "v";
		}
		// Schema passes → DETAIL runs and ignores keys absent from the body.
		const res = handlePromptRead({ name: "session-planner", args, json: true });
		const data = res.structuredContent as PromptEnvelope;
		expect(data.mode).toBe("detail");
		expect(data.prompt?.content).toContain("Objective: {{objective}}");
	});

	it("rejects blank / whitespace-only names", () => {
		const envelope = envelopeFor({ name: "   " });
		expect(envelope.code).toBe("VALIDATION_ERROR");
	});
});
