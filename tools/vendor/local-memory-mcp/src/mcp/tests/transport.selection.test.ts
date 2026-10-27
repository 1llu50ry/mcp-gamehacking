/**
 * Transport selection + HTTP config resolution tests.
 *
 * Verifies the `MCP_TRANSPORT` contract: stdio is the default when unset, the
 * `http` value selects HTTP, and any other value fails fast with a clear
 * error. Also verifies `resolveHttpTransportConfig` defaults and env overrides.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	resolveTransportMode,
	resolveHttpTransportConfig,
	MCP_HTTP_DEFAULT_HOST,
	MCP_HTTP_DEFAULT_PATH
} from "../transport/http";
import { MCP_HTTP_PORT } from "../utils/constants";

const HTTP_ENV_KEYS = ["MCP_TRANSPORT", "MCP_HTTP_HOST", "MCP_HTTP_PATH", "MCP_HTTP_TOKEN"] as const;

describe("resolveTransportMode", () => {
	it("defaults to stdio when the value is undefined (env unset)", () => {
		expect(resolveTransportMode(undefined)).toBe("stdio");
	});

	it("returns stdio for an explicit 'stdio' value", () => {
		expect(resolveTransportMode("stdio")).toBe("stdio");
	});

	it("returns http for the 'http' value (case/whitespace insensitive)", () => {
		expect(resolveTransportMode("http")).toBe("http");
		expect(resolveTransportMode(" HTTP ")).toBe("http");
	});

	it("rejects an unknown value with a clear error naming the valid options", () => {
		expect(() => resolveTransportMode("sse")).toThrow(/Invalid MCP_TRANSPORT value "sse"/);
		expect(() => resolveTransportMode("sse")).toThrow(/stdio/);
		expect(() => resolveTransportMode("sse")).toThrow(/http/);
	});

	it("rejects an empty string rather than silently defaulting", () => {
		expect(() => resolveTransportMode("")).toThrow(/Invalid MCP_TRANSPORT value/);
	});
});

describe("resolveHttpTransportConfig", () => {
	beforeEach(() => {
		for (const key of HTTP_ENV_KEYS) delete process.env[key];
	});
	afterEach(() => {
		for (const key of HTTP_ENV_KEYS) delete process.env[key];
	});

	it("uses the documented defaults when the environment is unset", () => {
		const config = resolveHttpTransportConfig();
		expect(config.host).toBe(MCP_HTTP_DEFAULT_HOST);
		expect(config.host).toBe("127.0.0.1");
		expect(config.port).toBe(MCP_HTTP_PORT);
		expect(config.port).toBe(3457);
		expect(config.path).toBe(MCP_HTTP_DEFAULT_PATH);
		expect(config.path).toBe("/mcp");
		expect(config.token).toBeUndefined();
	});

	it("reads host/path/token overrides from the environment", () => {
		process.env.MCP_HTTP_HOST = "0.0.0.0";
		process.env.MCP_HTTP_PATH = "custom/endpoint/";
		process.env.MCP_HTTP_TOKEN = "s3cret";
		const config = resolveHttpTransportConfig();
		expect(config.host).toBe("0.0.0.0");
		expect(config.path).toBe("/custom/endpoint");
		expect(config.token).toBe("s3cret");
	});

	it("normalizes a path without a leading slash and collapses a bare slash", () => {
		process.env.MCP_HTTP_PATH = "mcp";
		expect(resolveHttpTransportConfig().path).toBe("/mcp");
		process.env.MCP_HTTP_PATH = "/";
		expect(resolveHttpTransportConfig().path).toBe("/");
	});
});
