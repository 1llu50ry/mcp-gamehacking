/**
 * Server startup guard tests (TASK-051 guard, TASK-054 coverage).
 *
 * server.ts installs unhandledRejection / uncaughtException handlers BEFORE
 * the top-level awaits (SQLiteStore.create, vector init). `serverStarted`
 * flips to true only immediately before serveStdio(), so ANY rejection during
 * startup (e.g. DB create failure) must terminate the process with a clean
 * non-zero exit — never hang with no server and no stdio listener.
 *
 * Testing approach: spawn the REAL server entry (src/mcp/server.ts via tsx)
 * as a child process with MEMORY_DB_PATH forced to an unopenable location.
 * SQLiteStore.create() rejects in the top-level await, and the guard must
 * exit(1). A hang (guard missing / handler swallowing) fails the test via the
 * kill timer.
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Run server.ts and resolve its exit code (null = killed by timeout). */
function runServerWithDbPath(dbPath: string): Promise<{ code: number | null; stderr: string }> {
	return new Promise((resolve) => {
		const serverEntry = path.resolve(process.cwd(), "src", "mcp", "server.ts");
		const child = spawn(process.execPath, ["--import", "tsx", serverEntry], {
			cwd: process.cwd(),
			env: { ...process.env, MEMORY_DB_PATH: dbPath },
			stdio: ["ignore", "pipe", "pipe"]
		});

		let stderr = "";
		child.stderr?.on("data", (d: Buffer) => {
			stderr += String(d);
		});
		child.stdout?.on("data", () => {
			// drained to keep the pipe from blocking the child
		});

		// "Not hang": if the process is still alive after 20s, kill it and
		// report null so the assertion fails loudly instead of hanging the suite.
		const killTimer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve({ code: null, stderr });
		}, 20_000);

		child.on("exit", (code) => {
			clearTimeout(killTimer);
			resolve({ code, stderr });
		});
		child.on("error", (err) => {
			clearTimeout(killTimer);
			resolve({ code: -1, stderr: `${stderr}\nspawn error: ${err.message}` });
		});
	});
}

describe("server startup guard", () => {
	it("exits non-zero (not hang) when a top-level await fails before serverStarted", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-server-startup-"));
		try {
			// Put a plain FILE where the DB directory would be created:
			// fs.mkdirSync(dirname(path), {recursive:true}) throws, so
			// SQLiteStore.create() rejects → top-level await in server.ts
			// rejects → unhandledRejection handler sees serverStarted=false
			// → process.exit(1).
			const blocker = path.join(tempDir, "blocker");
			fs.writeFileSync(blocker, "i am a file, not a directory", "utf-8");

			const { code, stderr } = await runServerWithDbPath(path.join(blocker, "memory.db"));

			expect(code, `startup failure must exit non-zero, not hang (stderr tail: ${stderr.slice(-500)})`).toBe(1);
		} finally {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
