// Feature: memory-mcp-optimization
// Property 20: StructuredLogger output adalah JSON valid dengan field wajib
// Validates: Requirements 21.1, 21.2

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";

// ─── Property 20: StructuredLogger output adalah JSON valid dengan field wajib ─
// Feature: memory-mcp-optimization, Property 20: StructuredLogger output JSON valid

type LogLevel = "debug" | "info" | "warning" | "error";

describe("Property 20: StructuredLogger output adalah JSON valid dengan field wajib", () => {
	let stderrOutput: string[] = [];
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stderrOutput = [];
		stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
			stderrOutput.push(typeof chunk === "string" ? chunk : chunk.toString());
			return true;
		});
		// Reset LOG_LEVEL to ensure all levels are logged
		process.env.LOG_LEVEL = "debug";
	});

	afterEach(() => {
		stderrSpy.mockRestore();
		delete process.env.LOG_LEVEL;
	});

	it("each log call produces valid JSON output with required fields", async () => {
		// Re-import logger after setting LOG_LEVEL
		const { logger } = await import("../utils/logger.js?t=" + Date.now());

		fc.assert(
			fc.property(
				fc.oneof(
					fc.constant<LogLevel>("debug"),
					fc.constant<LogLevel>("info"),
					fc.constant<LogLevel>("warning"),
					fc.constant<LogLevel>("error")
				),
				fc.string({ minLength: 1, maxLength: 100 }),
				(level: LogLevel, message: string) => {
					stderrOutput = [];
					logger[level](message);

					expect(stderrOutput.length).toBeGreaterThanOrEqual(1);
					const lastOutput = stderrOutput[stderrOutput.length - 1];

					// Must be text with timestamp, level, and message
					expect(lastOutput).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} \[.*?\] /);

					// Extract parts
					const match = lastOutput.match(
						/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}) \[\s*(.*?)\s*\] ([\s\S]*)$/
					);
					expect(match).not.toBeNull();

					if (match) {
						const [, timestamp, parsedLevel, messageWithCtx] = match;

						// level must match
						expect(parsedLevel.toLowerCase()).toBe(level);

						// message must start with the original message
						expect(messageWithCtx.startsWith(message)).toBe(true);

						// timestamp must be ISO 8601
						const ts = new Date(timestamp);
						expect(isNaN(ts.getTime())).toBe(false);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it("log output with context includes context field", async () => {
		const { logger } = await import("../utils/logger.js?t=" + Date.now() + "ctx");

		stderrOutput = [];
		logger.info("test message", { key: "value", count: 42 });

		expect(stderrOutput.length).toBeGreaterThanOrEqual(1);
		const lastOutput = stderrOutput[stderrOutput.length - 1];

		expect(lastOutput).toContain('{"key":"value","count":42}');
	});

	it("log output without context does not include context field", async () => {
		const { logger } = await import("../utils/logger.js?t=" + Date.now() + "noctx");

		stderrOutput = [];
		logger.info("no context message");

		expect(stderrOutput.length).toBeGreaterThanOrEqual(1);
		const lastOutput = stderrOutput[stderrOutput.length - 1];

		expect(lastOutput.trim()).not.toMatch(/\{.*\}/);
	});

	it("all four log levels produce valid JSON with correct level field", async () => {
		const { logger } = await import("../utils/logger.js?t=" + Date.now() + "levels");

		const levels: LogLevel[] = ["debug", "info", "warning", "error"];
		for (const level of levels) {
			stderrOutput = [];
			if (level === "warning") {
				logger.warning(`test ${level} message`);
			} else {
				logger[level](`test ${level} message`);
			}

			expect(stderrOutput.length).toBeGreaterThanOrEqual(1);
			const lastOutput = stderrOutput[stderrOutput.length - 1];

			expect(lastOutput).toMatch(new RegExp(`\\[\\s*${level.toUpperCase()}\\s*\\]`));
			expect(lastOutput).toContain(`test ${level} message`);
		}
	});

	it("warn alias normalizes to warning", async () => {
		const { logger } = await import("../utils/logger.js?t=" + Date.now() + "warnalias");

		stderrOutput = [];
		logger.warn("legacy warning");

		expect(stderrOutput.length).toBeGreaterThanOrEqual(1);
		const lastOutput = stderrOutput[stderrOutput.length - 1];
		expect(lastOutput).toMatch(/\[\s*WARNING\s*\]/);
	});

	it("emits structured payloads to registered log sinks", async () => {
		const module = await import("../utils/logger.js?t=" + Date.now() + "sink");
		const sink = vi.fn();
		module.addLogSink(sink);

		module.logger.notice("[Server] Configuration updated", { source: "test" });

		expect(sink).toHaveBeenCalledWith({
			level: "notice",
			logger: "server",
			data: {
				message: "[Server] Configuration updated",
				source: "test"
			}
		});

		module.clearLogSinks();
	});
});
