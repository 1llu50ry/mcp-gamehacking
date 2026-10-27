import { randomUUID } from "crypto";
import { db } from "../lib/context";
import { ServiceError } from "../lib/jsonApi";
import { purgeEntityAndCleanup } from "../../mcp/utils/purge-entity-cleanup";
import type { MemoryType, MemoryEntry } from "../../mcp/types";

export interface MemoryListParams {
	repo: string;
	type?: MemoryType;
	search?: string;
	minImportance?: string;
	maxImportance?: string;
	sortBy?: string;
	sortOrder?: string;
	includeArchived?: boolean;
	limit: number;
	offset: number;
}

export interface MemoryListResult {
	items: MemoryEntry[];
	total: number;
}

/**
 * Service layer for memory business logic.
 *
 * Owns CRUD orchestration, scope resolution, and action logging.
 * Controllers delegate here instead of touching `db` directly.
 */
export const MemoryService = {
	list(params: MemoryListParams): MemoryListResult {
		const { repo, type, search, minImportance, maxImportance, sortBy, sortOrder, includeArchived, limit, offset } =
			params;

		return db.memories.listMemoriesForDashboard({
			repo,
			type,
			search,
			minImportance: minImportance ? parseInt(minImportance) : undefined,
			maxImportance: maxImportance ? parseInt(maxImportance) : undefined,
			sortBy,
			sortOrder: sortOrder?.toUpperCase() === "ASC" ? "ASC" : "DESC",
			includeArchived,
			limit,
			offset
		});
	},

	/**
	 * Side-effect-free existence check (no action log, no hit_count).
	 * Mutations (update/delete) must still find soft-archived rows so the
	 * restore path keeps working — archived is an existence, not an absence
	 * (TASK-209). The GET read path hides archived via `getById`.
	 */
	exists(id: string): boolean {
		return db.memories.getByIdWithStats(id, true) !== null;
	},

	/**
	 * GET endpoint: returns memory. Read-only — no action_log write
	 * (POLICY 2 / TASK-186: reads never write; mutations below still log).
	 * Archived memories are hidden by default (404) and only returned when
	 * `includeArchived` is explicitly true (TASK-209).
	 */
	getById(id: string, includeArchived: boolean = false): MemoryEntry | null {
		return db.memories.getByIdWithStats(id, includeArchived);
	},

	async create(attributes: {
		repo: string;
		type: string;
		content: string;
		owner?: string;
		[key: string]: unknown;
	}): Promise<string> {
		const { repo, owner } = attributes;
		const id = randomUUID();
		await db.withWrite(() => {
			db.memories.insert({
				...attributes,
				id,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				scope: { repo, owner: owner || "" }
			} as unknown as MemoryEntry);
			db.actions.logAction("write", "", repo, { memoryId: id });
		});
		return id;
	},

	async update(
		id: string,
		attributes: {
			title?: string;
			content?: string;
			type?: string;
			importance?: number;
			tags?: string[];
			agent?: string;
			model?: string;
			repo?: string;
			[key: string]: unknown;
		}
	): Promise<void> {
		const existing = db.memories.getByIdWithStats(id, true);
		if (!existing) throw new ServiceError(404, "Memory not found");

		const updates = {
			title: attributes.title,
			content: attributes.content,
			type: attributes.type,
			importance: attributes.importance,
			tags: attributes.tags,
			agent: attributes.agent,
			model: attributes.model,
			repo: attributes.repo,
			updated_at: new Date().toISOString()
		};

		await db.withWrite(() => {
			db.memories.update(id, updates as Partial<MemoryEntry>);
			db.actions.logAction("update", existing.scope?.owner || "", existing.scope?.repo || attributes.repo || "", {
				memoryId: id
			});
		});
	},

	async delete(id: string): Promise<void> {
		const existing = db.memories.getByIdWithStats(id, true);
		if (!existing) throw new ServiceError(404, "Memory not found");
		// Route through the shared purge + cleanup contract (OPT-DRY-03): soft
		// archive + queue_jobs purge + vector removal + repo-scoped KG cleanup —
		// identical to the MCP memory-delete tool and the dashboard bulk path.
		// This closes the single-vs-bulk divergence (single used to hard-delete
		// while bulk/tool soft-archive; TASK-207).
		await db.withWrite(() => {
			purgeEntityAndCleanup(db, "memory", [{ id, title: existing.title, repo: existing.scope.repo }]);
			db.actions.logAction("delete", existing.scope?.owner || "", existing.scope?.repo || "", { memoryId: id });
		});
	},

	async bulkCreate(items: Array<Record<string, unknown>>, repo: string): Promise<number> {
		const entries = items.map((item) => ({
			...item,
			id: (item.id as string) || randomUUID(),
			scope: {
				...(item.scope as Record<string, unknown>),
				repo,
				owner: ((item.scope as Record<string, unknown> | undefined)?.owner as string) || ""
			},
			created_at: (item.created_at as string) || new Date().toISOString(),
			updated_at: (item.updated_at as string) || new Date().toISOString()
		}));

		return db.withWrite(() => {
			const insertedCount = db.memories.bulkInsertMemories(entries as MemoryEntry[]);
			db.actions.logAction("write", "", repo, {
				query: `Bulk imported ${insertedCount} memories`
			});
			return insertedCount;
		});
	},

	async bulkAction(action: string, ids: string[], updates?: Record<string, unknown>): Promise<number> {
		return db.withExclusiveWrite(async () => {
			let n: number;
			if (action === "delete") {
				// Route through the shared purge + cleanup contract (OPT-DRY-03):
				// hard delete + queue_jobs purge + vector removal + KG cleanup —
				// identical to canonical memory-delete (no more divergent path).
				const existing = db.memories.getByIds(ids);
				const byId = new Map(existing.map((m) => [m.id, m]));
				await purgeEntityAndCleanup(
					db,
					"memory",
					ids.map((id) => {
						const mem = byId.get(id);
						return mem ? { id, title: mem.title, repo: mem.scope.repo } : { id };
					})
				);
				n = existing.length;
			} else if (action === "update" || action === "archive") {
				n = db.memories.bulkUpdateMemories(ids, updates || { status: action === "archive" ? "archived" : "active" });
			} else {
				throw new ServiceError(400, "Invalid action");
			}

			if (ids.length > 0) {
				const mem = db.memories.getById(ids[0]);
				db.actions.logAction(action, mem?.scope?.owner || "", mem?.scope?.repo || "unknown", {
					query: `Bulk ${action} applied to ${n} memories`
				});
			}
			return n;
		});
	}
};
