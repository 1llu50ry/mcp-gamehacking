import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { get, writable } from "svelte/store";
import { createGraphLoader, SHOW_MORE_STEP, MAX_GRAPH_LIMIT, type GraphLoaderDeps } from "../graphLoader";
import type { KGNode, KGEdge } from "../../interfaces";

// Mock the api module with a RELATIVE path so it resolves identically under
// both configs (the root vitest.config.ts does not define the $lib alias).
// Shared fn must come from vi.hoisted (hoisted above imports).
const { kgGraphMock } = vi.hoisted(() => ({ kgGraphMock: vi.fn() }));

vi.mock("../../api", () => ({
	api: {
		kgGraph: kgGraphMock
	}
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const nodeA: KGNode = { id: "n-a", name: "Node A", type: "concept" };
const nodeB: KGNode = { id: "n-b", name: "Node B", type: "concept" };
const nodeC: KGNode = { id: "n-c", name: "Node C", type: "concept" };
const edgeAB: KGEdge = { source: "n-a", target: "n-b", relation_type: "related" };
const edgeCD: KGEdge = { source: "n-c", target: "n-d", relation_type: "related" };

/** Server response shaped like GET /api/kg/graph (jsonApiRes envelope → data). */
function graphResponse(
	overrides: { nodes?: KGNode[]; edges?: KGEdge[]; truncated?: boolean; totalItems?: number } = {}
) {
	// Default totalItems is 1000 so 'Show more' can grow (300→600→900→1000)
	// without being prematurely capped; tests that exercise the cap override it.
	const totalItems = overrides.totalItems ?? 1000;
	return {
		nodes: overrides.nodes ?? [nodeA],
		edges: overrides.edges ?? [edgeAB],
		truncated: overrides.truncated ?? false,
		pagination: { page: 1, pageSize: 300, graphLimit: 300, totalItems, totalPages: Math.ceil(totalItems / 300) }
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// ─── Deps harness ─────────────────────────────────────────────────────────────

interface TestHarness {
	deps: GraphLoaderDeps;
	setRepo: (repo: string) => void;
}

function createTestDeps(initialRepo = "repo-a"): TestHarness {
	let repo = initialRepo;
	let loadedRepo = "";
	const graphLimit = writable(300);
	const totalItems = writable(0);
	const deps: GraphLoaderDeps = {
		repo: vi.fn(() => repo),
		getLoadedRepo: vi.fn(() => loadedRepo),
		setLoadedRepo: vi.fn((r: string) => {
			loadedRepo = r;
		}),
		hasLayout: vi.fn(() => false),
		setNodes: vi.fn(),
		setEdges: vi.fn(),
		setTruncated: vi.fn(),
		setLoading: vi.fn(),
		setError: vi.fn(),
		onClear: vi.fn(),
		onDataReady: vi.fn(),
		graphLimit,
		totalItems
	};
	return {
		deps,
		setRepo: (r) => {
			repo = r;
		}
	};
}

/** Warm the loader for a repo with the given totalItems (default 1000 so Show-more can grow). */
async function warmCache(loader: ReturnType<typeof createGraphLoader>, totalItems = 1000) {
	kgGraphMock.mockResolvedValueOnce(graphResponse({ totalItems }));
	await loader.loadGraph();
	kgGraphMock.mockClear();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("graphLoader", () => {
	beforeEach(() => {
		kgGraphMock.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("first load (cache miss) fetches the top-N nodes with graphLimit and populates the edge cache", async () => {
		const { deps } = createTestDeps();
		const loader = createGraphLoader(deps);
		kgGraphMock.mockResolvedValueOnce(graphResponse());

		await loader.loadGraph();

		expect(kgGraphMock).toHaveBeenCalledTimes(1);
		const [repoArg, params] = kgGraphMock.mock.calls[0];
		expect(repoArg).toBe("repo-a");
		expect(params.graphLimit).toBe(300); // top-N window, not page/pageSize
		expect(params.page).toBeUndefined();
		expect(params.pageSize).toBeUndefined();
		expect(params.includeEdges).toBeUndefined(); // full fetch — no opt-out
		expect(params.signal).toBeInstanceOf(AbortSignal);
		expect(deps.setNodes).toHaveBeenCalledWith([nodeA]);
		expect(deps.setEdges).toHaveBeenCalledWith([edgeAB]);
		expect(deps.setTruncated).toHaveBeenCalledWith(false);
		expect(deps.onDataReady).toHaveBeenCalledTimes(1);
		expect(deps.setLoadedRepo).toHaveBeenCalledWith("repo-a");
		expect(deps.setLoading).toHaveBeenLastCalledWith(false);
	});

	it("showMore grows graphLimit, sends includeEdges:false, reuses cached edges, and never overwrites the cache with the server's empty edges", async () => {
		vi.useFakeTimers();
		const { deps } = createTestDeps();
		const loader = createGraphLoader(deps);
		await warmCache(loader);

		// Show more — the server honors includeEdges=false: nodes only, edges: [].
		kgGraphMock.mockResolvedValueOnce(graphResponse({ nodes: [nodeB], edges: [] }));
		loader.showMore();
		expect(get(deps.graphLimit)).toBe(300 + SHOW_MORE_STEP); // store grows immediately
		expect(kgGraphMock).not.toHaveBeenCalled(); // debounced
		await vi.advanceTimersByTimeAsync(150);

		expect(kgGraphMock).toHaveBeenCalledTimes(1);
		const [repoArg, params] = kgGraphMock.mock.calls[0];
		expect(repoArg).toBe("repo-a");
		expect(params.graphLimit).toBe(300 + SHOW_MORE_STEP);
		expect(params.page).toBeUndefined();
		expect(params.includeEdges).toBe(false);
		// Cached edges served — NOT the response's empty array.
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeAB]);
		expect(deps.setTruncated).toHaveBeenLastCalledWith(false);
		expect(deps.setNodes).toHaveBeenLastCalledWith([nodeB]);

		// A second show-more still gets the cached edges — the [] from the
		// includeEdges=false response never replaced the cache entry.
		kgGraphMock.mockClear();
		kgGraphMock.mockResolvedValueOnce(graphResponse({ nodes: [nodeA], edges: [] }));
		loader.showMore();
		await vi.advanceTimersByTimeAsync(150);
		expect(kgGraphMock.mock.calls[0][1].graphLimit).toBe(300 + 2 * SHOW_MORE_STEP);
		expect(kgGraphMock.mock.calls[0][1].includeEdges).toBe(false);
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeAB]);
	});

	it("forceReload sends a full request (no includeEdges:false) and refreshes the cache entry", async () => {
		const { deps } = createTestDeps();
		const loader = createGraphLoader(deps);
		kgGraphMock.mockResolvedValueOnce(graphResponse({ edges: [edgeAB] }));
		await loader.loadGraph(); // cache: edgeAB, truncated: false

		kgGraphMock.mockClear();
		kgGraphMock.mockResolvedValueOnce(graphResponse({ nodes: [nodeC], edges: [edgeCD], truncated: true }));
		await loader.loadGraph(true); // forceReload (refresh / CRUD mutation)

		expect(kgGraphMock).toHaveBeenCalledTimes(1);
		expect(kgGraphMock.mock.calls[0][1].includeEdges).toBeUndefined();
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeCD]);
		expect(deps.setTruncated).toHaveBeenLastCalledWith(true);

		// The refreshed entry is what subsequent show-mores serve.
		vi.useFakeTimers();
		kgGraphMock.mockClear();
		kgGraphMock.mockResolvedValueOnce(graphResponse({ nodes: [nodeB], edges: [] }));
		loader.showMore();
		await vi.advanceTimersByTimeAsync(150);
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeCD]);
		expect(deps.setTruncated).toHaveBeenLastCalledWith(true);
	});

	it("repo switch evicts the previous repo's cache entry", async () => {
		const { deps, setRepo } = createTestDeps();
		const loader = createGraphLoader(deps);
		kgGraphMock.mockResolvedValueOnce(graphResponse({ edges: [edgeAB] }));
		await loader.loadGraph(); // repo-a cached with edgeAB

		// Full load for repo-b evicts repo-a's entry.
		setRepo("repo-b");
		kgGraphMock.mockResolvedValueOnce(graphResponse({ nodes: [nodeC], edges: [edgeCD] }));
		await loader.loadGraph();
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeCD]);

		// Back to repo-a with reuseEdges: the entry was evicted → full fetch
		// (includeEdges undefined), proving repo-a's cache entry is gone.
		setRepo("repo-a");
		kgGraphMock.mockResolvedValueOnce(graphResponse({ edges: [edgeAB] }));
		await loader.loadGraph(false, true);
		expect(kgGraphMock).toHaveBeenCalledTimes(3);
		expect(kgGraphMock.mock.calls[2][1].includeEdges).toBeUndefined();
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeAB]);
	});

	it("a new loadGraph aborts the in-flight request; the superseded request never re-applies data or clears loading state", async () => {
		const { deps } = createTestDeps();
		const loader = createGraphLoader(deps);
		const first = deferred<ReturnType<typeof graphResponse>>();
		const second = deferred<ReturnType<typeof graphResponse>>();
		kgGraphMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

		const p1 = loader.loadGraph();
		const firstSignal = kgGraphMock.mock.calls[0][1].signal as AbortSignal;
		const p2 = loader.loadGraph();

		// The second load aborted the first request's controller.
		expect(firstSignal.aborted).toBe(true);
		expect((kgGraphMock.mock.calls[1][1].signal as AbortSignal).aborted).toBe(false);
		expect(deps.setLoading).toHaveBeenLastCalledWith(true);

		second.resolve(graphResponse({ nodes: [nodeB], edges: [edgeCD] }));
		await p2;
		expect(deps.setLoading).toHaveBeenLastCalledWith(false);

		// The superseded response resolves later: data must not be applied and
		// the loading state must stay false (the latest request owns it).
		first.resolve(graphResponse({ nodes: [nodeA], edges: [edgeAB] }));
		await p1;
		expect(deps.setNodes).not.toHaveBeenCalledWith([nodeA]);
		expect(deps.setEdges).not.toHaveBeenCalledWith([edgeAB]);
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeCD]);
		expect(deps.setLoading).toHaveBeenLastCalledWith(false);
	});

	it("showMore debounces rapid clicks into a single fetch after 150ms", async () => {
		vi.useFakeTimers();
		const { deps } = createTestDeps();
		const loader = createGraphLoader(deps);
		await warmCache(loader);

		kgGraphMock.mockResolvedValue(graphResponse({ nodes: [nodeB], edges: [] }));

		loader.showMore();
		loader.showMore();
		loader.showMore();
		expect(kgGraphMock).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(150);

		expect(kgGraphMock).toHaveBeenCalledTimes(1);
		// 300 → 600 → 900 → capped at 1000 by the final click.
		expect(get(deps.graphLimit)).toBe(MAX_GRAPH_LIMIT);
		expect(kgGraphMock.mock.calls[0][1].graphLimit).toBe(MAX_GRAPH_LIMIT);
		expect(kgGraphMock.mock.calls[0][1].includeEdges).toBe(false); // cache hit
		expect(deps.setEdges).toHaveBeenLastCalledWith([edgeAB]); // cached, not []
	});

	it("showMore caps at totalItems when the repo has fewer than 1000 nodes, and is a no-op at the cap", async () => {
		vi.useFakeTimers();
		const { deps } = createTestDeps();
		const loader = createGraphLoader(deps);
		kgGraphMock.mockResolvedValueOnce(graphResponse({ totalItems: 500 }));
		await loader.loadGraph(); // totalItems=500, graphLimit=300

		kgGraphMock.mockClear();
		kgGraphMock.mockResolvedValue(graphResponse({ nodes: [nodeB], edges: [], totalItems: 500 }));
		loader.showMore(); // 300 → min(500, 600) = 500
		await vi.advanceTimersByTimeAsync(150);
		expect(get(deps.graphLimit)).toBe(500);
		expect(kgGraphMock).toHaveBeenCalledTimes(1);
		expect(kgGraphMock.mock.calls[0][1].graphLimit).toBe(500);

		// Already at the cap — no further growth, no fetch.
		kgGraphMock.mockClear();
		loader.showMore();
		await vi.advanceTimersByTimeAsync(150);
		expect(get(deps.graphLimit)).toBe(500);
		expect(kgGraphMock).not.toHaveBeenCalled();
	});

	it("repo switch mid-flight discards the stale response", async () => {
		const { deps, setRepo } = createTestDeps();
		const loader = createGraphLoader(deps);
		const inFlight = deferred<ReturnType<typeof graphResponse>>();
		kgGraphMock.mockReturnValueOnce(inFlight.promise);

		const p = loader.loadGraph();
		setRepo("repo-b");
		inFlight.resolve(graphResponse({ nodes: [nodeA], edges: [edgeAB] }));
		await p;

		// Response discarded: no data applied, no ready/loaded callbacks.
		expect(deps.onDataReady).not.toHaveBeenCalled();
		expect(deps.setLoadedRepo).not.toHaveBeenCalled();
		expect(deps.setNodes).toHaveBeenCalledTimes(1); // clearGraph's [] only
		expect(deps.setNodes).toHaveBeenCalledWith([]);
		expect(deps.setEdges).toHaveBeenCalledTimes(1); // clearGraph's [] only
		expect(deps.setEdges).toHaveBeenCalledWith([]);
		// Actual contract: the stale request never clears loading — the newer
		// repo's load owns the loading state (see TASK-200 comment).
		expect(deps.setLoading).toHaveBeenCalledTimes(1);
		expect(deps.setLoading).toHaveBeenCalledWith(true);
	});
});
