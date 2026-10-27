import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * PERF-002 — ONNX inference thread cap.
 *
 * `@xenova/transformers` runs ORT with its defaults, so every embed wakes an
 * all-core thread pool (~2-3 core burst on a busy daemon). These tests pin:
 *   1. the env-overridable `EMBEDDING_ONNX_THREADS` constant (default 1, clamp
 *      >= 1, override honored);
 *   2. the pure `applyOnnxThreadConfig` helper that sets the wasm
 *      (`wasm.numThreads`) and native (`intraOpNumThreads` /
 *      `interOpNumThreads`) knobs defensively; and
 *   3. the `RealVectorStore.getTransformers` wiring — `OMP_NUM_THREADS` set
 *      BEFORE the dynamic import and the env object capped after it — with a
 *      mocked `@xenova/transformers` so the real model is never downloaded.
 *
 * Thread count affects only ORT scheduling, never embedding values, so all of
 * this is output-neutral (recall is unchanged).
 */

/** Stable reference to the mocked `env.backends.onnx` object (hoisted so the
 * `vi.mock` factory and the assertions share ONE instance). */
const { onnxEnvMock } = vi.hoisted(() => {
	return {
		onnxEnvMock: {
			wasm: {} as { numThreads?: number },
			logLevel: ""
		} as {
			wasm: { numThreads?: number };
			intraOpNumThreads?: number;
			interOpNumThreads?: number;
			logLevel: string;
		}
	};
});

// Never load the real ONNX runtime / model: the only surface getTransformers
// touches is `env.backends.onnx` (+ `pipeline`, unused by these tests).
vi.mock("@xenova/transformers", () => ({
	env: { backends: { onnx: onnxEnvMock } },
	pipeline: vi.fn()
}));

const ENV_THREADS = "EMBEDDING_ONNX_THREADS";
const ENV_OMP = "OMP_NUM_THREADS";
const ENV_MCP_SERVER = "MCP_SERVER";

const ORIGINAL = {
	threads: process.env[ENV_THREADS],
	omp: process.env[ENV_OMP],
	mcpServer: process.env[ENV_MCP_SERVER]
};

/** Re-evaluate a module from scratch so its top-level env reads run again. */
async function freshConstants(): Promise<typeof import("../utils/constants")> {
	vi.resetModules();
	return import("../utils/constants");
}

async function freshVectors(): Promise<typeof import("../storage/vectors")> {
	vi.resetModules();
	return import("../storage/vectors");
}

beforeEach(() => {
	// Reset the shared mock object between tests (the `wasm` object identity is
	// stable, so clear its own keys and the optional native fields).
	delete onnxEnvMock.wasm.numThreads;
	delete onnxEnvMock.intraOpNumThreads;
	delete onnxEnvMock.interOpNumThreads;
	onnxEnvMock.logLevel = "";
	delete process.env[ENV_THREADS];
	delete process.env[ENV_OMP];
	delete process.env[ENV_MCP_SERVER];
});

afterEach(() => {
	if (ORIGINAL.threads === undefined) delete process.env[ENV_THREADS];
	else process.env[ENV_THREADS] = ORIGINAL.threads;
	if (ORIGINAL.omp === undefined) delete process.env[ENV_OMP];
	else process.env[ENV_OMP] = ORIGINAL.omp;
	if (ORIGINAL.mcpServer === undefined) delete process.env[ENV_MCP_SERVER];
	else process.env[ENV_MCP_SERVER] = ORIGINAL.mcpServer;
	vi.resetModules();
});

describe("EMBEDDING_ONNX_THREADS constant (PERF-002)", () => {
	it("defaults to 1 when the env var is unset", async () => {
		const constants = await freshConstants();
		expect(constants.EMBEDDING_ONNX_THREADS).toBe(1);
	});

	it("honors the env override", async () => {
		process.env[ENV_THREADS] = "4";
		const constants = await freshConstants();
		expect(constants.EMBEDDING_ONNX_THREADS).toBe(4);
	});

	it("clamps non-positive and non-numeric values to 1", async () => {
		process.env[ENV_THREADS] = "0";
		expect((await freshConstants()).EMBEDDING_ONNX_THREADS).toBe(1);

		process.env[ENV_THREADS] = "-3";
		expect((await freshConstants()).EMBEDDING_ONNX_THREADS).toBe(1);

		// envInt falls back to the default (1) for an unparseable value.
		process.env[ENV_THREADS] = "not-a-number";
		expect((await freshConstants()).EMBEDDING_ONNX_THREADS).toBe(1);
	});
});

describe("applyOnnxThreadConfig helper (PERF-002)", () => {
	it("sets wasm.numThreads and intraOpNumThreads", async () => {
		const { applyOnnxThreadConfig } = await freshVectors();
		const env = { wasm: {} as { numThreads?: number } };
		applyOnnxThreadConfig(env, 2);
		expect(env.wasm.numThreads).toBe(2);
		expect((env as { intraOpNumThreads?: number }).intraOpNumThreads).toBe(2);
	});

	it("sets interOpNumThreads to 1 only when the field is present", async () => {
		const { applyOnnxThreadConfig } = await freshVectors();

		const withInter = { wasm: {} as { numThreads?: number }, interOpNumThreads: 99 };
		applyOnnxThreadConfig(withInter, 3);
		expect(withInter.interOpNumThreads).toBe(1);

		// Absent field must NOT be introduced (native runtimes that do not read
		// it stay untouched — no throw, no stray property).
		const withoutInter: { wasm: { numThreads?: number } } = { wasm: {} };
		applyOnnxThreadConfig(withoutInter, 3);
		expect("interOpNumThreads" in withoutInter).toBe(false);
	});

	it("clamps threads below 1 to 1", async () => {
		const { applyOnnxThreadConfig } = await freshVectors();
		const env = { wasm: {} as { numThreads?: number } };
		applyOnnxThreadConfig(env, 0);
		expect(env.wasm.numThreads).toBe(1);
		expect((env as { intraOpNumThreads?: number }).intraOpNumThreads).toBe(1);
	});

	it("never throws when no wasm object is present", async () => {
		const { applyOnnxThreadConfig } = await freshVectors();
		const env: Record<string, unknown> = {};
		expect(() => applyOnnxThreadConfig(env, 2)).not.toThrow();
		expect(env.intraOpNumThreads).toBe(2);
		expect(env.wasm).toBeUndefined();
	});
});

describe("RealVectorStore.getTransformers wiring (PERF-002)", () => {
	it("sets OMP_NUM_THREADS before import and caps the onnx env", async () => {
		process.env[ENV_THREADS] = "3";
		const { RealVectorStore } = await freshVectors();
		const store = new RealVectorStore({} as never);

		const tf = await (store as unknown as { getTransformers(): Promise<unknown> }).getTransformers();
		expect(tf).toBeDefined();

		// OMP_NUM_THREADS must be set (native OpenMP pool), matching the constant.
		expect(process.env[ENV_OMP]).toBe("3");
		// Both backend shapes capped to the configured thread count.
		expect(onnxEnvMock.wasm.numThreads).toBe(3);
		expect(onnxEnvMock.intraOpNumThreads).toBe(3);
		// interOpNumThreads was absent on the mock env → not introduced.
		expect("interOpNumThreads" in onnxEnvMock).toBe(false);
	});

	it("does not overwrite an operator-provided OMP_NUM_THREADS", async () => {
		process.env[ENV_THREADS] = "2";
		process.env[ENV_OMP] = "7";
		const { RealVectorStore } = await freshVectors();
		const store = new RealVectorStore({} as never);

		await (store as unknown as { getTransformers(): Promise<unknown> }).getTransformers();

		expect(process.env[ENV_OMP]).toBe("7");
		// The env-object cap still uses the constant (only the OpenMP env var is
		// left to the operator).
		expect(onnxEnvMock.intraOpNumThreads).toBe(2);
	});

	it("keeps the existing MCP_SERVER logLevel=error behavior", async () => {
		process.env[ENV_MCP_SERVER] = "true";
		const { RealVectorStore } = await freshVectors();
		const store = new RealVectorStore({} as never);

		await (store as unknown as { getTransformers(): Promise<unknown> }).getTransformers();

		expect(onnxEnvMock.logLevel).toBe("error");
	});
});
