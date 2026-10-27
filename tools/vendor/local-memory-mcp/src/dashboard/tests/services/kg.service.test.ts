/**
 * Unit tests for the KG service layer (entity/relation/observation CRUD +
 * graph assembly + write-lock boundaries).
 *
 * The HTTP layer pins 404/truncation/pagination for reads; these tests pin
 * the SERVICE-owned rules that are not visible through routes: the assembled
 * graph TTL cache (key format, hit/miss windowing, invalidation on mutation),
 * default-aware payload construction (createEntity defaults, createRelation
 * source/target validation → 409 duplicate), and the delete 404 contracts.
 * Pure unit — db stubbed via the mocked context, KG cache is the real
 * statsCache module (cleared per case).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KgEntityRow, KgRelationRow, KgObservationRow } from "../../../mcp/entities/knowledge-graph";

const mocks = vi.hoisted(() => {
	const knowledgeGraph = {
		countEntities: vi.fn(),
		listEntities: vi.fn(),
		getEntityByName: vi.fn(),
		getRelationsByName: vi.fn(),
		getObservationsByName: vi.fn(),
		countRelations: vi.fn(),
		listRelations: vi.fn(),
		listGraphNodes: vi.fn(),
		listGraphEdgesForSubset: vi.fn(),
		countGraphNodes: vi.fn(),
		createEntity: vi.fn(),
		entityExists: vi.fn(),
		deleteEntity: vi.fn(),
		createRelation: vi.fn(),
		deleteRelation: vi.fn(),
		deleteObservation: vi.fn()
	};
	return {
		db: {
			knowledgeGraph,
			withWrite: vi.fn((fn: () => unknown) => fn())
		},
		mcpClient: {
			start: vi.fn(),
			stop: vi.fn(),
			isConnected: vi.fn(() => false),
			getPendingCount: vi.fn(() => 0),
			callTool: vi.fn()
		},
		embeddingWorker: { getStats: vi.fn() },
		vectors: { upsert: vi.fn(), remove: vi.fn(), search: vi.fn() },
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
		startTime: Date.now()
	};
});

// KG_MAX_GRAPH_EDGES is captured at constants module load — set the cap
// BEFORE the service (→ constants) is imported so truncation is cheap.
vi.hoisted(() => {
	process.env.KG_MAX_GRAPH_EDGES = "3";
});

vi.mock("../../lib/context", () => ({
	db: mocks.db,
	mcpClient: mocks.mcpClient,
	embeddingWorker: mocks.embeddingWorker,
	vectors: mocks.vectors,
	logger: mocks.logger,
	startTime: mocks.startTime
}));

import { KgService } from "../../services/kg.service";
import { clearKgGraphCache } from "../../services/statsCache";

function makeEntity(overrides: Partial<KgEntityRow> = {}): KgEntityRow {
	return {
		name: "User",
		type: "class",
		description: "The user entity",
		repo: "acme/app",
		owner: "acme",
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		...overrides
	};
}

function makeRelation(overrides: Partial<KgRelationRow> = {}): KgRelationRow {
	return {
		from_entity: "User",
		to_entity: "Order",
		relation_type: "creates",
		repo: "acme/app",
		owner: "acme",
		created_at: "2026-01-01T00:00:00.000Z",
		confidence: 0.9,
		...overrides
	};
}

function makeObservation(overrides: Partial<KgObservationRow> = {}): KgObservationRow {
	return {
		id: "obs-1",
		entity_name: "User",
		observation: "holds an email",
		repo: "acme/app",
		owner: "acme",
		created_at: "2026-01-01T00:00:00.000Z",
		...overrides
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	clearKgGraphCache();
	vi.mocked(mocks.db.knowledgeGraph.countEntities).mockReturnValue(0);
	vi.mocked(mocks.db.knowledgeGraph.listEntities).mockReturnValue([]);
	vi.mocked(mocks.db.knowledgeGraph.listGraphNodes).mockReturnValue([]);
	vi.mocked(mocks.db.knowledgeGraph.listGraphEdgesForSubset).mockReturnValue([]);
	vi.mocked(mocks.db.knowledgeGraph.countGraphNodes).mockReturnValue(0);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("KgService.listEntities / listRelations", () => {
	it("returns the total + paged items from the entity queries", () => {
		vi.mocked(mocks.db.knowledgeGraph.countEntities).mockReturnValue(3);
		vi.mocked(mocks.db.knowledgeGraph.listEntities).mockReturnValue([makeEntity()]);

		const result = KgService.listEntities("acme/app", "class", "User", 10, 0);

		expect(result.total).toBe(3);
		expect(result.items).toHaveLength(1);
		expect(mocks.db.knowledgeGraph.countEntities).toHaveBeenCalledWith("acme/app", { type: "class", search: "User" });
		expect(mocks.db.knowledgeGraph.listEntities).toHaveBeenCalledWith("acme/app", {
			type: "class",
			search: "User",
			limit: 10,
			offset: 0
		});
	});

	it("returns an empty page when no entities match the filter", () => {
		expect(KgService.listEntities("acme/app", undefined, "nope", 10, 0)).toEqual({ items: [], total: 0 });
	});

	it("returns the total + paged relations", () => {
		vi.mocked(mocks.db.knowledgeGraph.countRelations).mockReturnValue(1);
		vi.mocked(mocks.db.knowledgeGraph.listRelations).mockReturnValue([makeRelation()]);

		const result = KgService.listRelations("acme/app", 10, 5);

		expect(result.total).toBe(1);
		expect(result.items[0].relation_type).toBe("creates");
		expect(mocks.db.knowledgeGraph.listRelations).toHaveBeenCalledWith("acme/app", { limit: 10, offset: 5 });
	});
});

describe("KgService.getEntity", () => {
	it("returns id = entity name with relations + observations", () => {
		vi.mocked(mocks.db.knowledgeGraph.getEntityByName).mockReturnValue(makeEntity());
		vi.mocked(mocks.db.knowledgeGraph.getRelationsByName).mockReturnValue([makeRelation()]);
		vi.mocked(mocks.db.knowledgeGraph.getObservationsByName).mockReturnValue([makeObservation()]);

		const result = KgService.getEntity("User", "acme/app");

		expect(result.id).toBe("User");
		expect(result.entity.name).toBe("User");
		expect(result.relations).toHaveLength(1);
		expect(result.observations).toHaveLength(1);
	});

	it("throws 404 when the entity does not exist", () => {
		vi.mocked(mocks.db.knowledgeGraph.getEntityByName).mockReturnValue(undefined);

		expect(() => KgService.getEntity("Ghost", "acme/app")).toThrowError(
			expect.objectContaining({ name: "ServiceError", status: 404, message: "Entity not found" })
		);
	});
});

describe("KgService.listGraph", () => {
	it("assembles nodes + subset-bounded edges and reports the total node count", () => {
		const nodes = [makeEntity({ name: "User" }), makeEntity({ name: "Order" })];
		vi.mocked(mocks.db.knowledgeGraph.listGraphNodes).mockReturnValue(nodes);
		vi.mocked(mocks.db.knowledgeGraph.listGraphEdgesForSubset).mockReturnValue([makeRelation()]);
		vi.mocked(mocks.db.knowledgeGraph.countGraphNodes).mockReturnValue(2);

		const result = KgService.listGraph("acme/app", 10, 0, true);

		expect(result.data.id).toBe("graph-acme/app");
		expect(result.data.nodes).toHaveLength(2);
		expect(result.data.truncated).toBe(false);
		expect(result.totalItems).toBe(2);
		// Edge fetch is bounded to the node subset, probe asks cap+1 rows.
		expect(mocks.db.knowledgeGraph.listGraphEdgesForSubset).toHaveBeenCalledWith(
			"acme/app",
			["User", "Order"],
			3,
			true
		);
	});

	it("skips the edge fetch entirely when includeEdges=false (or nodes are empty)", () => {
		vi.mocked(mocks.db.knowledgeGraph.listGraphNodes).mockReturnValue([]);

		KgService.listGraph("acme/app", 10, 0, true);
		KgService.listGraph("acme/app", 10, 0, false);

		expect(mocks.db.knowledgeGraph.listGraphEdgesForSubset).not.toHaveBeenCalled();
		expect(mocks.db.knowledgeGraph.countGraphNodes).toHaveBeenCalledTimes(2);
	});

	it("serves a warm window from the TTL cache without re-querying the DB", () => {
		vi.mocked(mocks.db.knowledgeGraph.listGraphNodes).mockReturnValue([makeEntity()]);

		const first = KgService.listGraph("acme/app", 10, 0, true);
		vi.mocked(mocks.db.knowledgeGraph.listGraphNodes).mockReturnValue([
			makeEntity({ name: "Changed" })
		] as KgEntityRow[]);
		const second = KgService.listGraph("acme/app", 10, 0, true);

		expect(first).toBe(second); // exact cached payload
		expect(mocks.db.knowledgeGraph.listGraphNodes).toHaveBeenCalledTimes(1);
	});

	it("caches each window separately — a different offset is a separate entry", () => {
		vi.mocked(mocks.db.knowledgeGraph.listGraphNodes).mockReturnValue([makeEntity()]);

		KgService.listGraph("acme/app", 10, 0, true);
		KgService.listGraph("acme/app", 10, 20, true);

		expect(mocks.db.knowledgeGraph.listGraphNodes).toHaveBeenCalledTimes(2);
	});

	it("graphLimit mode fetches the top-N by degree with offset forced to 0", () => {
		vi.mocked(mocks.db.knowledgeGraph.listGraphNodes).mockReturnValue([makeEntity()]);

		KgService.listGraph("acme/app", 10, 5, false, 50);

		expect(mocks.db.knowledgeGraph.listGraphNodes).toHaveBeenCalledWith("acme/app", {
			limit: 50,
			offset: 0
		});
	});

	it("recomputes when the cache TTL has elapsed (DASHBOARD_KG_TTL_MS=0)", () => {
		vi.stubEnv("DASHBOARD_KG_TTL_MS", "0");
		vi.mocked(mocks.db.knowledgeGraph.listGraphNodes).mockReturnValue([makeEntity()]);

		KgService.listGraph("acme/app", 10, 0, true);
		KgService.listGraph("acme/app", 10, 0, true);

		expect(mocks.db.knowledgeGraph.listGraphNodes).toHaveBeenCalledTimes(2);
	});
});

describe("KgService.createEntity / deleteEntity", () => {
	it("creates an entity with documented defaults and returns the read-back row", async () => {
		const created = makeEntity({ name: "Fresh", type: "unknown" });
		vi.mocked(mocks.db.knowledgeGraph.getEntityByName).mockReturnValue(created);

		const result = await KgService.createEntity({ name: "Fresh", repo: "acme/app" });

		expect(result).toBe(created);
		expect(mocks.db.knowledgeGraph.createEntity).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Fresh",
				type: "unknown",
				description: null,
				repo: "acme/app",
				owner: ""
			})
		);
		expect(mocks.db.withWrite).toHaveBeenCalledTimes(1);
	});

	it("passes explicit type/description/repo/owner through", async () => {
		vi.mocked(mocks.db.knowledgeGraph.getEntityByName).mockReturnValue(makeEntity());

		await KgService.createEntity({
			name: "Fresh",
			type: "class",
			description: "d",
			repo: "acme/app",
			owner: "acme"
		});

		expect(mocks.db.knowledgeGraph.createEntity).toHaveBeenCalledWith(
			expect.objectContaining({ type: "class", description: "d", repo: "acme/app", owner: "acme" })
		);
	});

	it("invalidates the cached graph payloads on create (dashboard mutations are reflected immediately)", async () => {
		vi.mocked(mocks.db.knowledgeGraph.getEntityByName).mockReturnValue(makeEntity());
		// Warm the graph cache, then mutate.
		vi.mocked(mocks.db.knowledgeGraph.listGraphNodes).mockReturnValue([makeEntity()]);
		KgService.listGraph("acme/app", 10, 0, true);

		await KgService.createEntity({ name: "Fresh", repo: "acme/app" });

		// Cache cleared ⇒ next listGraph re-queries the DB.
		KgService.listGraph("acme/app", 10, 0, true);
		expect(mocks.db.knowledgeGraph.listGraphNodes).toHaveBeenCalledTimes(2);
	});

	it("deletes an existing entity and returns the ack", async () => {
		vi.mocked(mocks.db.knowledgeGraph.entityExists).mockReturnValue(true);

		const result = await KgService.deleteEntity("User", "acme/app");

		expect(result).toEqual({ message: "Deleted", name: "User" });
		expect(mocks.db.knowledgeGraph.deleteEntity).toHaveBeenCalledWith("User", "acme/app");
	});

	it("throws 404 when deleting an unknown entity", async () => {
		vi.mocked(mocks.db.knowledgeGraph.entityExists).mockReturnValue(false);

		await expect(KgService.deleteEntity("Ghost", "acme/app")).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			message: "Entity not found"
		});
	});
});

describe("KgService.createRelation", () => {
	it("creates a relation within the requested repository", async () => {
		vi.mocked(mocks.db.knowledgeGraph.entityExists).mockReturnValue(true);

		const result = await KgService.createRelation({
			from_entity: "User",
			to_entity: "Order",
			relation_type: "creates",
			repo: "acme/app"
		});

		expect(result).toEqual({ from_entity: "User", to_entity: "Order", relation_type: "creates" });
		expect(mocks.db.knowledgeGraph.createRelation).toHaveBeenCalledWith(
			expect.objectContaining({
				from_entity: "User",
				to_entity: "Order",
				relation_type: "creates",
				repo: "acme/app",
				owner: ""
			})
		);
	});

	it("throws 400 when the source entity does not exist", async () => {
		vi.mocked(mocks.db.knowledgeGraph.entityExists).mockImplementation((name: string) => name !== "User");

		await expect(
			KgService.createRelation({ from_entity: "User", to_entity: "Order", relation_type: "creates", repo: "acme/app" })
		).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			message: "Source entity 'User' not found"
		});
		expect(mocks.db.knowledgeGraph.createRelation).not.toHaveBeenCalled();
	});

	it("throws 400 when the target entity does not exist", async () => {
		vi.mocked(mocks.db.knowledgeGraph.entityExists).mockImplementation((name: string) => name === "User");

		await expect(
			KgService.createRelation({ from_entity: "User", to_entity: "Order", relation_type: "creates", repo: "acme/app" })
		).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			message: "Target entity 'Order' not found"
		});
	});

	it("maps a SQLITE_CONSTRAINT_PRIMARYKEY write failure to 409 Relation already exists", async () => {
		vi.mocked(mocks.db.knowledgeGraph.entityExists).mockReturnValue(true);
		vi.mocked(mocks.db.knowledgeGraph.createRelation).mockImplementation(() => {
			throw Object.assign(new Error("UNIQUE constraint failed"), { code: "SQLITE_CONSTRAINT_PRIMARYKEY" });
		});

		await expect(
			KgService.createRelation({ from_entity: "User", to_entity: "Order", relation_type: "creates", repo: "acme/app" })
		).rejects.toMatchObject({
			name: "ServiceError",
			status: 409,
			message: "Relation already exists"
		});
	});

	it("re-throws unrelated write failures untouched", async () => {
		vi.mocked(mocks.db.knowledgeGraph.entityExists).mockReturnValue(true);
		vi.mocked(mocks.db.knowledgeGraph.createRelation).mockImplementation(() => {
			throw new Error("disk full");
		});

		await expect(
			KgService.createRelation({ from_entity: "User", to_entity: "Order", relation_type: "creates", repo: "acme/app" })
		).rejects.toThrow("disk full");
	});
});

describe("KgService.deleteRelation / deleteObservation", () => {
	it("deletes an existing relation and returns the ack", async () => {
		vi.mocked(mocks.db.knowledgeGraph.deleteRelation).mockReturnValue({ changes: 1 });

		const result = await KgService.deleteRelation("User", "Order", "creates", "acme/app");

		expect(result).toEqual({ message: "Deleted" });
		expect(mocks.db.knowledgeGraph.deleteRelation).toHaveBeenCalledWith("User", "Order", "creates", "acme/app");
	});

	it("throws 404 when the relation matched zero rows", async () => {
		vi.mocked(mocks.db.knowledgeGraph.deleteRelation).mockReturnValue({ changes: 0 });

		await expect(KgService.deleteRelation("User", "Order", "creates", "acme/app")).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			message: "Relation not found"
		});
	});

	it("deletes an existing observation and returns the ack", async () => {
		vi.mocked(mocks.db.knowledgeGraph.deleteObservation).mockReturnValue({ changes: 1 });

		const result = await KgService.deleteObservation("obs-1");

		expect(result).toEqual({ message: "Deleted", id: "obs-1" });
	});

	it("throws 404 when the observation matched zero rows", async () => {
		vi.mocked(mocks.db.knowledgeGraph.deleteObservation).mockReturnValue({ changes: 0 });

		await expect(KgService.deleteObservation("obs-ghost")).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			message: "Observation not found"
		});
	});
});
