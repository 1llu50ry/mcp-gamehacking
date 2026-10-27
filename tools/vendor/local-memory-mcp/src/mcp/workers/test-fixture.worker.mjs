/**
 * Deterministic test-fixture worker for the generic WorkerPool
 * (FEAT-DAEMON-002B). NOT part of the production daemon — it exists so the pool
 * unit tests can exercise the full message protocol (echo, compute, error,
 * timeout-by-delay, and hard crash) without depending on a real indexer or
 * embedding worker.
 *
 * Protocol (mirrors pool.ts):
 *   in : { id: number, payload: { op, ... } }
 *   out: { id, ok: true, result } | { id, ok: false, error: { message, stack } }
 *
 * Supported ops:
 *   echo   { value }        → value
 *   add    { a, b }         → a + b
 *   delay  { ms, value }    → value (after ms) — drives timeout tests
 *   throw  { message }      → ok:false (application error)
 *   crash  {}               → process.exit(1) with NO reply — drives respawn
 */

import { parentPort } from "node:worker_threads";

const port = parentPort;
if (!port) throw new Error("test-fixture worker must be started via worker_threads");

port.on("message", (message) => {
	const { id, payload } = message ?? {};
	const op = payload?.op;

	switch (op) {
		case "echo":
			port.postMessage({ id, ok: true, result: payload.value });
			return;
		case "add":
			port.postMessage({ id, ok: true, result: payload.a + payload.b });
			return;
		case "delay":
			setTimeout(() => port.postMessage({ id, ok: true, result: payload.value }), payload.ms ?? 0);
			return;
		case "throw":
			port.postMessage({
				id,
				ok: false,
				error: { message: payload.message ?? "boom", stack: "fixture:throw" }
			});
			return;
		case "crash":
			// Abrupt exit with an open request: the pool must reject the in-flight
			// task and respawn. No reply is sent on purpose.
			process.exit(1);
			return;
		default:
			port.postMessage({ id, ok: false, error: { message: `unknown op: ${String(op)}` } });
	}
});
