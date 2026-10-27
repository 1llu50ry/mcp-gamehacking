import { SQLiteStore } from "../../storage/sqlite";
import { Task, VectorStore } from "../../types";
import { enqueueTask } from "../../embedding-queue";
import { isValidGitHubUsername } from "../../utils/owner";
import { isPlausibleScopeSegment } from "../../session";
import { invalidNewOwnerMessage } from "./errors";
import { TaskWriteParams } from "./types";

// ---------------------------------------------------------------------------
// Field-level update logic, validation
// ---------------------------------------------------------------------------

/**
 * Builds the set of updatable fields from params, excluding control fields.
 *
 * `owner` (and `repo`) are scoping/identification fields, NOT mutable task
 * fields — they are destructured out here so a forwarded owner (e.g. from the
 * dashboard's task-update path, FIX-OWNER-INFER) is used purely for scope
 * resolution and never persisted into the task row or listed in updatedFields.
 *
 * `new_owner` (FEAT-007) is the explicit opt-in owner move — an identity change,
 * not an ordinary attribute. It is ALSO destructured out here (and must never be
 * spread into the generic update set as a raw column); `coreUpdate` routes it
 * separately so it can validate, collision-check, and sync task_comments inside
 * the transaction. Keeping it out of the spread guarantees an unknown-key leak
 * can never silently mutate `owner`.
 */
export function buildUpdatesFromParams(params: TaskWriteParams): Record<string, unknown> {
	const {
		owner,
		repo,
		new_owner,
		status,
		phase,
		tags,
		agent,
		role,
		model,
		est_tokens,
		commit_id,
		changed_files,
		...restUpdates
	} = params;
	void owner;
	void repo;
	void new_owner;
	const updates: Record<string, unknown> = { ...restUpdates };
	if (status !== undefined) updates.status = status;
	if (phase !== undefined) updates.phase = phase;
	if (tags !== undefined) updates.tags = tags;
	if (agent !== undefined) updates.agent = agent;
	if (role !== undefined) updates.role = role;
	if (model !== undefined) updates.model = model;
	if (est_tokens !== undefined) updates.est_tokens = est_tokens;
	if (commit_id !== undefined) updates.commit_id = commit_id;
	if (changed_files !== undefined) updates.changed_files = changed_files;
	return updates;
}

/**
 * Validates the target of an explicit owner move (FEAT-007).
 *
 * Two independent gates, both required:
 *   1. shape — {@link isValidGitHubUsername} (1-39 chars, alphanumeric
 *      start/end, single internal hyphens);
 *   2. scope-sanity — {@link isPlausibleScopeSegment} (FIX-029) rejects
 *      empty/whitespace values, dotfiles (`.config`), and reserved OS/XDG
 *      structural segments (`home`, `tmp`, `usr`, …) that are path artifacts,
 *      never real owners.
 *
 * Throws a caller-actionable VALIDATION_ERROR (`Invalid new_owner: …`) so the
 * transport classifies it without masking it as INTERNAL_ERROR.
 */
export function validateNewOwner(newOwner: string): void {
	const trimmed = newOwner.trim();
	if (trimmed.length === 0) {
		throw new Error(invalidNewOwnerMessage(newOwner, "format"));
	}
	// Reserved/dotfile check first so `.config`/`home` get the scope-specific
	// message rather than a generic username-shape one.
	if (!isPlausibleScopeSegment(trimmed)) {
		throw new Error(invalidNewOwnerMessage(trimmed, "reserved"));
	}
	if (!isValidGitHubUsername(trimmed)) {
		throw new Error(invalidNewOwnerMessage(trimmed, "format"));
	}
}

/**
 * Syncs the `phase:` prefix tag whenever phase or tags are updated.
 * Modifies finalUpdates.tags in place.
 */
export function applyPhaseTagSync(
	updates: Record<string, unknown>,
	existingTask: Task,
	finalUpdates: Record<string, unknown>
): void {
	if (updates.phase !== undefined || updates.tags !== undefined) {
		let currentTags = (updates.tags as string[]) || (existingTask.tags as string[]) || [];
		currentTags = currentTags.filter((t: string) => !t.startsWith("phase:"));
		const finalPhase = updates.phase !== undefined ? (updates.phase as string) : existingTask.phase;
		if (finalPhase) {
			const phaseTag = `phase:${finalPhase}`;
			if (!currentTags.includes(phaseTag)) {
				currentTags.push(phaseTag);
			}
		}
		finalUpdates.tags = currentTags;
	}
}

/**
 * Injects decision_refs into metadata if provided.
 * Modifies finalUpdates.metadata in place.
 */
export function applyDecisionRefsToUpdates(
	params: TaskWriteParams,
	existingTask: Task,
	finalUpdates: Record<string, unknown>
): void {
	if (params.decision_refs !== undefined) {
		const currentMetadata = { ...(existingTask.metadata ?? {}) };
		currentMetadata.decision_refs = params.decision_refs;
		finalUpdates.metadata = currentMetadata;
	}
}

/**
 * Enqueue embedding/KG jobs for updated tasks (if title/description changed).
 * Synchronous LWW upsert — enrichment runs via the outbox worker (TASK-013),
 * off the write-lock critical path. Signature retained for callers; the
 * `vectors` instance is no longer used here.
 */
export async function enrichUpdatedTasks(
	updatedTasks: { id: string }[],
	storage: SQLiteStore,
	_vectors: VectorStore
): Promise<void> {
	for (const { id: taskId } of updatedTasks) {
		const task = storage.tasks.getTaskById(taskId);
		if (task) {
			enqueueTask(storage, task);
		}
	}
}
