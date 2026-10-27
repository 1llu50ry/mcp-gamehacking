/**
 * FEAT-DAEMON-002E — failure-isolated startup auto-index kickoff.
 *
 * The startup auto-index must NEVER abort readiness. Before this module its
 * synchronous prologue (`evaluateAutoIndexTarget`, `registerRepo`) had no outer
 * catch — a throw there could reject the awaited boot AFTER the listener bound
 * (server.ts would then `process.exit(1)` on an otherwise-healthy server). These
 * tests pin that every failure mode (sync prologue throw, `ensure("indexing")`
 * non-ready, `autoIndexIfStale` rejection) is contained and observable, and that
 * readiness is never aborted.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	evaluateAutoIndexTarget: vi.fn(),
	registerRepo: vi.fn(),
	autoIndexIfStale: vi.fn(),
	getCodebaseParserPool: vi.fn(() => ({ initialize: vi.fn() }))
}));

vi.mock("../../codebase-index/services/project-detection", () => ({
	evaluateAutoIndexTarget: mocks.evaluateAutoIndexTarget
}));
vi.mock("../../codebase-index/services/file-watcher", () => ({
	registerRepo: mocks.registerRepo
}));
vi.mock("../../codebase-index/services/indexing-service", () => ({
	autoIndexIfStale: mocks.autoIndexIfStale
}));
vi.mock("../../codebase-index/parser/singleton", () => ({
	getCodebaseParserPool: mocks.getCodebaseParserPool
}));

import { RuntimeCapabilityRegistry } from "../../runtime-capabilities";
import { kickOffStartupAutoIndex } from "../../services/startup-auto-index";

const { evaluateAutoIndexTarget, registerRepo, autoIndexIfStale } = mocks;

function makeRegistry(): RuntimeCapabilityRegistry {
	const registry = new RuntimeCapabilityRegistry("full");
	// The kickoff only calls ensure("indexing")/ensure("watcher"); register
	// no-op loaders so ensure resolves (a real server registers them).
	registry.register("indexing", () => {});
	registry.register("watcher", () => {});
	return registry;
}

/** Poll until `predicate` is true (bounded), so fire-and-forget settles. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
		await new Promise((r) => setTimeout(r, 5));
	}
}

describe("kickOffStartupAutoIndex (FEAT-DAEMON-002E)", () => {
	afterEach(() => {
		vi.clearAllMocks();
		delete process.env.CODEBASE_AUTO_INDEX;
	});

	it("is a no-op when CODEBASE_AUTO_INDEX=false (never touches the DB)", () => {
		process.env.CODEBASE_AUTO_INDEX = "false";
		const registry = makeRegistry();
		kickOffStartupAutoIndex({} as never, registry, { logTag: "[Test]" });
		expect(evaluateAutoIndexTarget).not.toHaveBeenCalled();
		expect(registerRepo).not.toHaveBeenCalled();
	});

	it("skips a non-project CWD without registering or indexing", () => {
		evaluateAutoIndexTarget.mockReturnValue({ eligible: false, reason: "non_project_root", markers: [] });
		const registry = makeRegistry();
		kickOffStartupAutoIndex({} as never, registry, { logTag: "[Test]", cwd: "/" });
		expect(evaluateAutoIndexTarget).toHaveBeenCalledWith("/");
		expect(registerRepo).not.toHaveBeenCalled();
		expect(autoIndexIfStale).not.toHaveBeenCalled();
	});

	it("happy path: registers the repo and runs autoIndexIfStale without degrading", async () => {
		evaluateAutoIndexTarget.mockReturnValue({ eligible: true, reason: "ok", markers: ["package.json"] });
		autoIndexIfStale.mockResolvedValue({ status: "started" });
		const registry = makeRegistry();

		kickOffStartupAutoIndex({} as never, registry, { logTag: "[Test]", cwd: "/work/proj" });

		await waitFor(() => autoIndexIfStale.mock.calls.length > 0);
		expect(registerRepo).toHaveBeenCalledWith("proj", "/work/proj");
		// ensure("indexing") resolved → the capability is ready, not degraded.
		expect(registry.snapshot().capabilities.indexing.state).toBe("ready");
	});

	it("contains a SYNCHRONOUS prologue throw and degrades indexing (never throws)", () => {
		evaluateAutoIndexTarget.mockImplementation(() => {
			throw new Error("detection blew up");
		});
		const registry = makeRegistry();

		// Must not throw out of the kickoff (the pre-fix bug: this escaped into
		// the awaited boot and exited the process after the listener bound).
		expect(() => kickOffStartupAutoIndex({} as never, registry, { logTag: "[Test]", cwd: "/work/proj" })).not.toThrow();
		expect(registry.snapshot().capabilities.indexing.state).toBe("degraded");
	});

	it("contains a non-ready ensure('indexing') (loader failure) and never runs the index", async () => {
		evaluateAutoIndexTarget.mockReturnValue({ eligible: true, reason: "ok", markers: [] });
		const registry = new RuntimeCapabilityRegistry("full");
		registry.register("indexing", () => Promise.reject(new Error("loader exploded")));

		kickOffStartupAutoIndex({} as never, registry, { logTag: "[Test]", cwd: "/work/proj" });

		// ensure() never rejects; a failed loader leaves the capability in a
		// non-ready ('failed') state and the kickoff returns early.
		await waitFor(() => registry.snapshot().capabilities.indexing.state !== "loading");
		expect(["failed", "degraded"]).toContain(registry.snapshot().capabilities.indexing.state);
		expect(autoIndexIfStale).not.toHaveBeenCalled();
	});

	it("contains an autoIndexIfStale rejection and degrades indexing", async () => {
		evaluateAutoIndexTarget.mockReturnValue({ eligible: true, reason: "ok", markers: [] });
		autoIndexIfStale.mockRejectedValue(new Error("index prologue exploded"));
		const registry = makeRegistry();

		kickOffStartupAutoIndex({} as never, registry, { logTag: "[Test]", cwd: "/work/proj" });

		await waitFor(() => registry.snapshot().capabilities.indexing.state === "degraded");
		// Readiness for OTHER capabilities is untouched.
		expect(registry.snapshot().capabilities.semantic.state).toBe("idle");
	});
});
