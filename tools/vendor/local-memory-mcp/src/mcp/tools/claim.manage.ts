import { SQLiteStore } from "../storage/sqlite";
import { ClaimManageSchema } from "./schemas/index";
import { claimCoordinated, listClaimsTable, releaseClaim } from "../utils/coordination";

// ── PUBLIC ENTRY POINT ──────────────────────────────────────────────────

/**
 * Handles all three claim operations in one unified tool.
 *
 * **Auto-infer logic (per ADR-004):**
 * - `release: true` + task_id/task_code → RELEASE (was claim-release)
 * - task_id/task_code + agent → CLAIM (was task-claim, auto-promote + audit)
 * - agent only (no task_id/task_code) → LIST claims by agent
 * - nothing → LIST all active claims
 *
 * All LIST modes support pagination (`limit`, `offset`) and `active_only` filter.
 *
 * The actual operations delegate to the shared coordination lifecycle
 * (utils/coordination.ts, OPT-DRY-02) — the single source of truth for the
 * claim domain (legacy handoff.manage.ts removed in OPT-CODE-02).
 */
export async function handleClaimManage(args: unknown, storage: SQLiteStore) {
	const validated = ClaimManageSchema.parse(args);
	const { owner, repo, task_id, task_code, agent, role, metadata, release, active_only, limit, offset, json } =
		validated;

	const hasTask = !!(task_id || task_code);

	// ── 1. release:true + task → RELEASE ──────────────────────────
	if (release && hasTask) {
		return releaseClaim(owner, repo, task_id, task_code, agent, json, storage);
	}

	// ── 2. task + agent → CLAIM (auto-promote + audit comment) ────
	if (hasTask && agent) {
		return claimCoordinated(owner, repo, task_id, task_code, agent, role, metadata, json, storage);
	}

	// ── 3. task only (no agent) → error ──────────────────────────
	if (hasTask && !agent) {
		throw new Error(
			"CLAIM requires agent. Combine task_id/task_code with agent for CLAIM, " + "or add release:true for RELEASE"
		);
	}

	// ── 4. agent only → LIST claims by agent ─────────────────────
	if (agent && !hasTask) {
		return listClaimsTable(owner, repo, agent, active_only, limit, offset, "claim-manage", json, storage);
	}

	// ── 5. nothing → LIST all active claims ──────────────────────
	return listClaimsTable(owner, repo, undefined, active_only, limit, offset, "claim-manage", json, storage);
}
