import { randomBytes } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { TABLE_TASKS, TABLE_MEMORIES } from "./constants";

export type EntityType = "task" | "memory" | "standard";

const ENTITY_CONFIG: Record<EntityType, { prefix: string; table: string; column: string }> = {
	task: { prefix: "TASK", table: TABLE_TASKS, column: "task_code" },
	memory: { prefix: "MEM", table: TABLE_MEMORIES, column: "code" },
	standard: { prefix: "STD", table: "coding_standards", column: "code" }
};

/**
 * Generates the next sequential code for an entity type within a repo.
 * Pattern: {PREFIX}-{NNN} (e.g., TASK-001, MEM-042, STD-999)
 * Scoped per-owner per-repo. The optional batchCodes Set accounts for codes
 * generated in the same batch but not yet persisted.
 */
export function generateNextCode(
	owner: string,
	repo: string,
	entityType: EntityType,
	storage: SQLiteStore,
	batchCodes?: Set<string>
): string {
	const config = ENTITY_CONFIG[entityType];
	const pattern = `${config.prefix}-%`;
	const offset = config.prefix.length + 2;

	const row = storage.db
		.prepare(
			`
    SELECT MAX(CAST(SUBSTR(${config.column}, ?) AS INTEGER)) as max_seq
    FROM ${config.table}
    WHERE owner = ? AND repo = ? AND ${config.column} LIKE ?
  `
		)
		.get(offset, owner, repo, pattern) as { max_seq: number | null };

	let nextSeq = (row?.max_seq ?? 0) + 1;

	if (batchCodes) {
		for (const code of batchCodes) {
			if (code.startsWith(`${config.prefix}-`)) {
				const num = parseInt(code.slice(config.prefix.length + 1), 10);
				if (!isNaN(num) && num >= nextSeq) {
					nextSeq = num + 1;
				}
			}
		}
	}

	return `${config.prefix}-${String(nextSeq).padStart(3, "0")}`;
}

/**
 * Resolves an entity code with automatic fallback when the preferred code already exists.
 *
 * - If `preferredCode` is null/undefined → delegates to `generateNextCode` for sequential auto-generation
 * - If `preferredCode` is provided and unique → returns it as-is
 * - If `preferredCode` is already taken → generates `{preferredCode}-{random4hex}` (retries up to 20 times)
 *
 * The optional `batchCodes` set accounts for codes already earmarked in the current batch
 * but not yet persisted to the database.
 */
export function resolveEntityCode(
	preferredCode: string | null | undefined,
	owner: string,
	repo: string,
	entityType: EntityType,
	storage: SQLiteStore,
	options?: { batchCodes?: Set<string> }
): string {
	const { batchCodes } = options ?? {};

	// Auto-generate if no preferred code
	if (!preferredCode) {
		const code = generateNextCode(owner, repo, entityType, storage, batchCodes);
		if (batchCodes) batchCodes.add(code);
		return code;
	}

	// Helper: check if a code is already taken (batch set + database)
	const isTaken = (code: string): boolean => {
		if (batchCodes?.has(code)) return true;
		switch (entityType) {
			case "task":
				return storage.tasks.isTaskCodeDuplicate(owner, repo, code);
			case "memory":
				return storage.memories.getByCode(code, owner, repo) !== null;
			case "standard":
				return storage.standards.getByCode(code, owner, repo) !== null;
		}
	};

	// Return the preferred code if it's available
	if (!isTaken(preferredCode)) {
		if (batchCodes) batchCodes.add(preferredCode);
		return preferredCode;
	}

	// Generate with random suffix — retry until unique
	for (let attempt = 0; attempt < 20; attempt++) {
		const suffix = randomBytes(2).toString("hex");
		const candidate = `${preferredCode}-${suffix}`;
		if (!isTaken(candidate)) {
			if (batchCodes) batchCodes.add(candidate);
			return candidate;
		}
	}

	// Last resort: sequential fallback
	return generateNextCode(owner, repo, entityType, storage, batchCodes);
}
