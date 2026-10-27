import { randomUUID } from "crypto";
import { db } from "../lib/context";
import { ServiceError } from "../lib/jsonApi";
import { purgeEntityAndCleanup } from "../../mcp/utils/purge-entity-cleanup";
import type { CodingStandardEntry } from "../../mcp/types";
import { enqueueStandard } from "../../mcp/embedding-queue";

const STANDARDS_EXPORT_SCHEMA = "local-memory-mcp.standards.v1";

type StandardsExportPayload = {
	schema: typeof STANDARDS_EXPORT_SCHEMA;
	exported_at: string;
	repo: string | null;
	scope: "repo" | "global" | "all";
	standards: CodingStandardEntry[];
};

export interface StandardsSearchParams {
	query?: string;
	language?: string;
	stack?: string[];
	tags?: string[];
	repo?: string;
	is_global?: boolean;
	limit: number;
	offset: number;
}

/**
 * Service layer for coding standards business logic.
 *
 * Owns CRUD orchestration, import/export normalization, vector embedding
 * decisions, and action logging. Controllers delegate here instead of
 * touching `db` directly.
 */
export const StandardsService = {
	list(params: StandardsSearchParams): {
		items: CodingStandardEntry[];
		total: number;
	} {
		const { query, language, stack, tags, repo, is_global, limit, offset } = params;

		const filters = {
			query,
			language,
			stack: stack?.[0],
			tag: tags?.[0],
			repo,
			is_global
		};

		const items = db.standards.search({
			...filters,
			limit,
			offset
		});

		// Total via COUNT(*) (TASK-406): the previous limit-100000 +
		// `.length` approach materialized every matching row (full column
		// payloads, JSON-parsed stack/tags/metadata per row) on every list
		// request just to produce a total — the dominant cost of the
		// 2288ms standards first-load.
		const total = db.standards.count(filters);

		return { items, total };
	},

	/** Side-effect-free existence check (no hit_count, no action log). */
	exists(id: string): boolean {
		return db.standards.getById(id) !== null;
	},

	/**
	 * GET endpoint: returns standard + increments hit_count (read-tracking
	 * metric, intentionally kept). No action_log write — reads never write
	 * (POLICY 2 / TASK-186; mutations below still log).
	 */
	getById(id: string): CodingStandardEntry | null {
		const standard = db.standards.getById(id);
		if (!standard) return null;
		db.standards.incrementHitCounts([standard.id]);
		return standard;
	},

	exportStandards(repo: string | undefined, scope: string): StandardsExportPayload {
		const scopeValue = scope === "global" || scope === "all" ? scope : "repo";
		const items = db.standards.search({
			repo: scopeValue === "repo" ? repo : undefined,
			is_global: scopeValue === "global" ? true : undefined,
			limit: 100000,
			offset: 0
		});

		return {
			schema: STANDARDS_EXPORT_SCHEMA,
			exported_at: new Date().toISOString(),
			repo: typeof repo === "string" && repo ? repo : null,
			scope: scopeValue,
			standards: items
		};
	},

	async importStandards(
		rawStandards: unknown[],
		refreshVectors?: boolean
	): Promise<{
		imported: string[];
		updated: string[];
		total: number;
		vectors_refreshed: boolean;
		vector_failures: number;
	}> {
		const standards = rawStandards
			.map(normalizeStandardForImport)
			.filter((item): item is CodingStandardEntry => !!item);

		if (standards.length === 0) {
			throw new ServiceError(400, "Import payload does not contain valid standards");
		}

		const shouldRefresh = refreshVectors ?? standards.length <= 500;
		const imported: string[] = [];
		const updated: string[] = [];
		let vectorFailures = 0;

		await db.withExclusiveWrite(() => {
			for (const standard of standards) {
				const existing =
					db.standards.getById(standard.id) || (standard.code ? db.standards.getByCode(standard.code) : null);

				if (existing) {
					db.standards.update(existing.id, {
						code: standard.code,
						title: standard.title,
						content: standard.content,
						parent_id: standard.parent_id,
						context: standard.context,
						version: standard.version,
						language: standard.language,
						stack: standard.stack,
						is_global: standard.is_global,
						repo: standard.repo,
						tags: standard.tags,
						metadata: standard.metadata,
						hit_count: standard.hit_count,
						last_used_at: standard.last_used_at,
						agent: standard.agent,
						model: standard.model
					});

					if (shouldRefresh) {
						const refreshed = db.standards.getById(existing.id) || { ...standard, id: existing.id };
						try {
							enqueueStandard(db, refreshed);
						} catch {
							vectorFailures += 1;
						}
					}
					updated.push(existing.id);
				} else {
					db.standards.insert(standard);
					if (shouldRefresh) {
						try {
							enqueueStandard(db, standard);
						} catch {
							vectorFailures += 1;
						}
					}
					imported.push(standard.id);
				}
			}
			db.actions.logAction("write", "", "standards-import", {
				query: "standards-import",
				resultCount: imported.length + updated.length
			});
		});

		return {
			imported,
			updated,
			total: imported.length + updated.length,
			vectors_refreshed: shouldRefresh,
			vector_failures: vectorFailures
		};
	},

	async create(attributes: {
		title: string;
		content: string;
		tags: string[];
		metadata: Record<string, unknown>;
		parent_id?: string | null;
		context?: string;
		version?: string;
		language?: string | null;
		stack?: string[];
		is_global?: boolean;
		owner?: string;
		repo?: string | null;
		agent?: string;
		model?: string;
	}): Promise<CodingStandardEntry> {
		const now = new Date().toISOString();
		const entry: CodingStandardEntry = {
			id: randomUUID(),
			title: String(attributes.title),
			content: String(attributes.content),
			parent_id: attributes.parent_id ?? null,
			context: String(attributes.context || "general"),
			version: String(attributes.version || "1.0.0"),
			language: attributes.language || null,
			stack: attributes.stack || [],
			is_global: attributes.is_global !== false,
			owner: attributes.owner || "",
			repo: attributes.repo || null,
			tags: attributes.tags,
			metadata: attributes.metadata,
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: String(attributes.agent || "dashboard"),
			model: String(attributes.model || "web-ui")
		};

		await db.withWrite(() => {
			db.standards.insert(entry);
			enqueueStandard(db, entry);
			db.actions.logAction("write", entry.owner, entry.repo || "global", {
				query: entry.title,
				resultCount: 1
			});
		});

		return entry;
	},

	async update(id: string, updates: Partial<CodingStandardEntry>): Promise<void> {
		const existing = db.standards.getById(id);
		if (!existing) throw new ServiceError(404, "Coding standard not found");

		await db.withWrite(() => {
			db.standards.update(existing.id, updates);
			const merged: CodingStandardEntry = {
				...existing,
				...updates,
				updated_at: new Date().toISOString()
			};
			enqueueStandard(db, merged);
			db.actions.logAction("update", existing.owner, existing.repo || "global", {
				query: existing.title,
				resultCount: 1
			});
		});
	},

	async delete(id: string): Promise<void> {
		const existing = db.standards.getById(id);
		if (!existing) throw new ServiceError(404, "Coding standard not found");

		// Route through the shared purge + cleanup contract (OPT-DRY-03): hard
		// delete + queue_jobs purge + vector removal + repo-scoped KG cleanup —
		// identical to the MCP standard-delete tool and the dashboard bulk path.
		// Vector removal is explicit inside StandardEntity.delete: the derived
		// database holding standard_vectors has no cross-database FK to
		// coding_standards, so there is no SQL CASCADE to rely on (TASK-037).
		await db.withWrite(() => {
			purgeEntityAndCleanup(db, "standard", [{ id, title: existing.title, repo: existing.repo ?? "" }]);
			db.actions.logAction("delete", existing.owner, existing.repo || "global", {
				query: existing.title,
				resultCount: 1
			});
		});
	},

	async bulkAction(action: string, ids: string[], updates?: Record<string, unknown>): Promise<number> {
		return db.withExclusiveWrite(async () => {
			let n: number;
			if (action === "delete") {
				// Route through the shared purge + cleanup contract (OPT-DRY-03):
				// hard delete + queue_jobs purge + vector removal + repo-scoped
				// KG cleanup — identical to canonical standard-delete (no more
				// skipped purge/KG divergence).
				const existing = db.standards.getByIds(ids);
				const byId = new Map(existing.map((s) => [s.id, s]));
				await purgeEntityAndCleanup(
					db,
					"standard",
					ids.map((id) => {
						const standard = byId.get(id);
						return standard ? { id, title: standard.title, repo: standard.repo ?? "" } : { id };
					})
				);
				n = existing.length;
			} else if (action === "update") {
				n = db.standards.bulkUpdateStandards(ids, updates || {});
			} else {
				throw new ServiceError(400, "Invalid action");
			}

			if (ids.length > 0) {
				const standard = db.standards.getById(ids[0]);
				db.actions.logAction(action, standard?.owner || "", standard?.repo || "global", {
					query: `Bulk ${action} applied to ${n} standards`
				});
			}
			return n;
		});
	}
};

// ── Private helpers ───────────────────────────────────────────────

function normalizeStandardForImport(value: unknown): CodingStandardEntry | null {
	if (!value || typeof value !== "object") return null;
	const item = value as Partial<CodingStandardEntry>;
	if (!item.title || !item.content) return null;
	const now = new Date().toISOString();
	return {
		id: typeof item.id === "string" && item.id ? item.id : randomUUID(),
		code: typeof item.code === "string" && item.code ? item.code : undefined,
		title: String(item.title),
		content: String(item.content),
		parent_id: typeof item.parent_id === "string" && item.parent_id ? item.parent_id : null,
		context: String(item.context || "general"),
		version: String(item.version || "1.0.0"),
		language: typeof item.language === "string" && item.language ? item.language : null,
		stack: Array.isArray(item.stack) ? item.stack.map(String).filter(Boolean) : [],
		is_global: item.is_global !== false,
		owner: typeof item.owner === "string" ? item.owner : "",
		repo: typeof item.repo === "string" && item.repo ? item.repo : null,
		tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : [],
		metadata:
			item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
				? (item.metadata as Record<string, unknown>)
				: { source: "standards-import" },
		created_at: typeof item.created_at === "string" && item.created_at ? item.created_at : now,
		updated_at: typeof item.updated_at === "string" && item.updated_at ? item.updated_at : now,
		hit_count: typeof item.hit_count === "number" ? item.hit_count : 0,
		last_used_at: typeof item.last_used_at === "string" ? item.last_used_at : null,
		agent: String(item.agent || "dashboard-import"),
		model: String(item.model || "web-ui")
	};
}

export function standardsFromImportPayload(body: unknown): unknown[] {
	if (Array.isArray(body)) return body;
	if (!body || typeof body !== "object") return [];
	const payload = body as {
		standards?: unknown;
		data?: { attributes?: { standards?: unknown } };
	};
	if (Array.isArray(payload.standards)) return payload.standards;
	if (Array.isArray(payload.data?.attributes?.standards)) return payload.data.attributes.standards;
	return [];
}
