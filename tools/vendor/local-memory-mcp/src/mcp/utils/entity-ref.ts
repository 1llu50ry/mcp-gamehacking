import { SQLiteStore } from "../storage/sqlite";
import { UUID_REGEX } from "./uuid";
import { assertNotOrchestratorPlaceholder } from "./placeholder-code";

export type EntityRefKind = "memory" | "standard" | "task";

export interface ResolveEntityRefOptions {
	/**
	 * In-memory code → id map checked before the DB lookup. Used to resolve
	 * cross-references within the same batch (tasks referencing sibling tasks
	 * created in the same request).
	 */
	localMap?: Map<string, string>;
	/**
	 * Overrides the entity label used in the "not found" error message.
	 * Defaults to the kind's canonical label (Memory / Coding standard / Task).
	 */
	label?: string;
}

const ENTITY_LABELS: Record<EntityRefKind, string> = {
	memory: "Memory",
	standard: "Coding standard",
	task: "Task"
};

/**
 * Resolves a value that is either an entity UUID or an entity code to the
 * entity's id.
 *
 * - `null`/`undefined` → returns `null`
 * - a valid UUID → returns it as-is
 * - a code present in `opts.localMap` → returns the mapped id
 * - a code → looks up the entity by code (getByCode) and returns its id
 *
 * @throws If the value is not a UUID and does not resolve to an existing entity.
 */
export function resolveEntityRef(
	storage: SQLiteStore,
	kind: EntityRefKind,
	value: string | null | undefined,
	owner?: string,
	repo?: string,
	opts?: ResolveEntityRefOptions
): string | null {
	if (!value) return null;
	if (UUID_REGEX.test(value)) return value;
	if (opts?.localMap?.has(value)) return opts.localMap.get(value) ?? null;

	let id: string | null = null;
	switch (kind) {
		case "memory":
			id = storage.memories.getByCode(value, owner, repo)?.id ?? null;
			break;
		case "standard":
			id = storage.standards.getByCode(value, owner, repo)?.id ?? null;
			break;
		case "task":
			// FIX-021: a reserved orchestrator placeholder (T01/R01/Q01/…) is an
			// unsubstituted template token, not a real code — surface the
			// actionable VALIDATION_ERROR instead of a bare "Task not found".
			assertNotOrchestratorPlaceholder(value);
			id = storage.tasks.getTaskByCode(owner ?? "", repo ?? "", value)?.id ?? null;
			break;
	}

	// TASK-426: include the search scope (owner/repo) in the not-found message so
	// the failing namespace is obvious — a code is unique per (owner, repo), so
	// the same code resolving differently per path (dashboard owner="" vs MCP
	// session-inferred owner) previously produced a bare, confusing "not found".
	// owner/repo are already parameters (no signature change); the suffix is
	// emitted only when a repo is available so non-scoped callers are unchanged.
	const scope = repo !== undefined ? ` (owner="${owner ?? ""}", repo="${repo}")` : "";
	if (!id) throw new Error(`${opts?.label ?? ENTITY_LABELS[kind]} not found: ${value}${scope}`);
	return id;
}
