/**
 * C1 (FEAT-DAEMON-002 review) — process-owned worker pools must be closed on
 * graceful shutdown.
 *
 * Two layers of proof:
 *
 *   1. UNIT — `closeProcessPools` closes BOTH the process-wide parser pool and
 *      the vector store's embedding pool, contains a failure from either, and is
 *      safe when no vector store is supplied.
 *   2. INTEGRATION — a child process boots the REAL parser pool (worker
 *      threads), runs the production teardown, and must EXIT ON ITS OWN (the
 *      worker threads released). A leaked worker would keep the event loop
 *      alive and the test would kill the child — the "no open handles" proof.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";

// ── Unit layer: closeProcessPools orchestration ─────────────────────────────

const { parserCloseSpy } = vi.hoisted(() => ({ parserCloseSpy: vi.fn(async () => {}) }));

vi.mock("../codebase-index/parser/singleton", () => ({
	closeCodebaseParserPool: parserCloseSpy
}));

import { closeProcessPools } from "../services/shutdown-teardown";

describe("closeProcessPools (C1)", () => {
	beforeEach(() => {
		parserCloseSpy.mockClear();
	});

	it("closes the parser pool and the vector store", async () => {
		const vectorClose = vi.fn(async () => {});
		await closeProcessPools({ vectors: { close: vectorClose }, logTag: "[test]" });

		expect(parserCloseSpy).toHaveBeenCalledTimes(1);
		expect(vectorClose).toHaveBeenCalledTimes(1);
	});

	it("is safe when no vector store is supplied", async () => {
		await expect(closeProcessPools({ logTag: "[test]" })).resolves.toBeUndefined();
		expect(parserCloseSpy).toHaveBeenCalledTimes(1);
	});

	it("is safe when the vector store has no close()", async () => {
		await expect(closeProcessPools({ vectors: {}, logTag: "[test]" })).resolves.toBeUndefined();
		expect(parserCloseSpy).toHaveBeenCalledTimes(1);
	});

	it("contains a parser-pool close failure and still closes the vector store", async () => {
		parserCloseSpy.mockRejectedValueOnce(new Error("parser boom"));
		const vectorClose = vi.fn(async () => {});
		await expect(closeProcessPools({ vectors: { close: vectorClose }, logTag: "[test]" })).resolves.toBeUndefined();
		expect(vectorClose).toHaveBeenCalledTimes(1);
	});

	it("contains a vector-store close failure (never throws)", async () => {
		const vectorClose = vi.fn(async () => {
			throw new Error("vectors boom");
		});
		await expect(closeProcessPools({ vectors: { close: vectorClose }, logTag: "[test]" })).resolves.toBeUndefined();
		expect(parserCloseSpy).toHaveBeenCalledTimes(1);
		expect(vectorClose).toHaveBeenCalledTimes(1);
	});
});

// ── Integration layer: no open handles remain after teardown ────────────────

/** Run the probe to completion; resolve the exit code (null = killed by timeout). */
function runProbe(timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const entry = path.resolve(process.cwd(), "src", "mcp", "tests", "fixtures", "parser-pool-teardown-probe.ts");
		const child = spawn(process.execPath, ["--import", "tsx", entry], {
			cwd: process.cwd(),
			stdio: ["ignore", "pipe", "pipe"]
		});

		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (d: Buffer) => (stdout += String(d)));
		child.stderr?.on("data", (d: Buffer) => (stderr += String(d)));

		// "No open handles": if a parser worker leaked, the child would hang past
		// the timeout; kill it and report null so the assertion fails loudly.
		const killTimer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve({ code: null, stdout, stderr });
		}, timeoutMs);

		child.on("exit", (code) => {
			clearTimeout(killTimer);
			resolve({ code, stdout, stderr });
		});
		child.on("error", (err) => {
			clearTimeout(killTimer);
			resolve({ code: -1, stdout, stderr: `${stderr}\nspawn error: ${err.message}` });
		});
	});
}

describe("parser pool teardown releases worker threads (C1)", () => {
	it("exits on its own after closeProcessPools (no worker keeps the loop alive)", { timeout: 60_000 }, async () => {
		const { code, stdout, stderr } = await runProbe(45_000);
		expect(stdout).toContain("TEARDOWN_DONE");
		expect(code, `probe must exit cleanly, not hang (stderr: ${stderr.slice(-500)})`).toBe(0);
	});
});
