// Feature: mcp-transport-factory
// Per-session isolation tests for createServerFactory (TASK-419).
//
// The factory is invoked once per serving unit — one stdio connection, or one
// HTTP request/session — over the process-wide (intentionally shared) store and
// vector store. Every invocation MUST build a fresh McpServer AND a fresh
// SessionContext, so no per-connection state (owner/repo/roots/client info)
// can leak between sessions.
//
// The factory returns only the McpServer (its SessionContext is internal), so
// these tests spy on createSessionContext() to capture the two contexts the
// factory constructs and assert they are distinct objects with distinct
// sessionIds.
//
// Convention follows session.test.ts / sdk-resources.test.ts: pure TS, no
// jsdom, in-memory SQLite (createTestStore) + StubVectorStore.

import { describe, it, expect, vi, afterEach } from "vitest";
import * as sessionModule from "../session";
import type { SessionContext } from "../session";
import { createServerFactory } from "../transport/factory";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createServerFactory per-session isolation (TASK-419)", () => {
	it("builds a distinct SessionContext for each factory invocation", async () => {
		const db = await createTestStore();
		const vectors: VectorStore = new StubVectorStore(db);

		// Capture every SessionContext the factory constructs by wrapping the
		// real factory function (delegating so production behavior is intact).
		const captured: SessionContext[] = [];
		const realCreateSessionContext = sessionModule.createSessionContext;
		const spy = vi.spyOn(sessionModule, "createSessionContext").mockImplementation(() => {
			const ctx = realCreateSessionContext();
			captured.push(ctx);
			return ctx;
		});

		try {
			const factory = createServerFactory(db, vectors);

			const serverA = factory({ era: "legacy" });
			const serverB = factory({ era: "legacy" });

			// One fresh context per invocation — no shared/cached context.
			expect(spy).toHaveBeenCalledTimes(2);
			expect(captured).toHaveLength(2);

			const [ctxA, ctxB] = captured;
			// Object identity differs (not the same reference).
			expect(ctxA).not.toBe(ctxB);
			// sessionId is populated and unique per session.
			expect(ctxA.sessionId).toBeTruthy();
			expect(ctxB.sessionId).toBeTruthy();
			expect(ctxA.sessionId).not.toBe(ctxB.sessionId);

			// The servers themselves are also distinct instances.
			expect(serverA).not.toBe(serverB);
		} finally {
			db.close();
		}
	});

	it("keeps per-session state isolated (mutating one context does not affect the other)", async () => {
		const db = await createTestStore();
		const vectors: VectorStore = new StubVectorStore(db);

		const captured: SessionContext[] = [];
		const realCreateSessionContext = sessionModule.createSessionContext;
		vi.spyOn(sessionModule, "createSessionContext").mockImplementation(() => {
			const ctx = realCreateSessionContext();
			captured.push(ctx);
			return ctx;
		});

		try {
			const factory = createServerFactory(db, vectors);
			factory({ era: "legacy" });
			factory({ era: "legacy" });

			const [ctxA, ctxB] = captured;
			ctxA.repo = "repo-a";
			ctxA.owner = "owner-a";
			ctxA.roots = [{ uri: "file:///tmp/repo-a" }];

			expect(ctxB.repo).not.toBe("repo-a");
			expect(ctxB.owner).not.toBe("owner-a");
			expect(ctxB.roots).not.toEqual([{ uri: "file:///tmp/repo-a" }]);
		} finally {
			db.close();
		}
	});

	// TASK-420 regression: the transport discriminator must reach the session so
	// the write fail-loud guard can be HTTP-only (stdio CWD = client project).
	it("threads the transport discriminator into each session context", async () => {
		const db = await createTestStore();
		const vectors: VectorStore = new StubVectorStore(db);

		const transports: Array<string | undefined> = [];
		const realCreateSessionContext = sessionModule.createSessionContext;
		vi.spyOn(sessionModule, "createSessionContext").mockImplementation((transport?: "stdio" | "http") => {
			transports.push(transport);
			return realCreateSessionContext(transport);
		});

		try {
			createServerFactory(db, vectors, "http")({ era: "legacy" });
			createServerFactory(db, vectors, "stdio")({ era: "legacy" });
			createServerFactory(db, vectors)({ era: "legacy" }); // default

			expect(transports).toEqual(["http", "stdio", "stdio"]);
		} finally {
			db.close();
		}
	});
});
