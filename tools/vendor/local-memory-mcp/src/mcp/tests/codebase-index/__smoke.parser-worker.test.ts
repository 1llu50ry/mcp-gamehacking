import { describe, it, expect } from "vitest";
import { WorkerPool } from "../../workers/pool.js";
import { resolveParserWorkerPath } from "../../workers/resolve-parser-worker.js";

describe("smoke: parser worker pool", () => {
	it("parses a TS file off-thread and returns symbols", { timeout: 60_000 }, async () => {
		const pool = new WorkerPool({ workerPath: resolveParserWorkerPath(), size: 2, taskTimeoutMs: 30_000 });
		try {
			const warm = await pool.run<{ op: string }, { warmed: boolean }>({ op: "warmup" });
			expect(warm.warmed).toBe(true);

			const result = await pool.run<
				{ op: string; filePath: string; sourceCode: string; parseTimeoutMs: number },
				{ symbols: Array<{ name: string; kind: string }>; references?: unknown[]; error: string | null }
			>({
				op: "parse",
				filePath: "sample.ts",
				sourceCode: "export function fetchUser(id: string): Promise<void> {}\nexport class Svc {}\n",
				parseTimeoutMs: 10_000
			});

			console.log("SMOKE RESULT:", JSON.stringify(result));
			expect(result.error).toBeNull();
			const names = result.symbols.map((s) => s.name).sort();
			expect(names).toContain("fetchUser");
			expect(names).toContain("Svc");
		} finally {
			await pool.close({ mode: "cancel" });
		}
	});
});
