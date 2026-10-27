import { db, mcpClient } from "../lib/context";
import type { Claim, Handoff } from "../../mcp/types";

export interface ClaimListParams {
	repo: string;
	agent?: string;
	active_only?: boolean;
	limit: number;
	offset: number;
}

export interface ClaimListResult {
	claims: Claim[];
	total: number;
}

export interface HandoffListParams {
	repo: string;
	status?: Handoff["status"];
	to_agent?: string;
	from_agent?: string;
	limit: number;
	offset: number;
}

export interface HandoffListResult {
	handoffs: Handoff[];
	total: number;
}

/**
 * Service layer for coordination business logic (claims + handoffs).
 *
 * Owns list/release orchestration and MCP delegation.
 * Controllers delegate here instead of touching `db` directly.
 */
export const CoordinationService = {
	listClaims(params: ClaimListParams): ClaimListResult {
		const { repo, agent, active_only, limit, offset } = params;

		const claims = db.handoffs.listClaims({
			owner: "",
			repo,
			agent: typeof agent === "string" ? agent : undefined,
			active_only: active_only === undefined ? true : active_only,
			limit,
			offset
		});

		const total = db.handoffs.countClaims({
			owner: "",
			repo,
			agent: typeof agent === "string" ? agent : undefined,
			active_only: active_only === undefined ? true : active_only
		});

		return { claims, total };
	},

	listHandoffs(params: HandoffListParams): HandoffListResult {
		const { repo, status, to_agent, from_agent, limit, offset } = params;

		const handoffs = db.handoffs.listHandoffs({
			owner: "",
			repo,
			status,
			to_agent,
			from_agent,
			limit,
			offset
		});

		const total = db.handoffs.countHandoffs({
			owner: "",
			repo,
			status,
			to_agent,
			from_agent
		});

		return { handoffs, total };
	},

	async updateHandoffStatus(id: string, status: Handoff["status"]): Promise<Handoff | null> {
		const existing = db.handoffs.getHandoffById(id);
		if (!existing) return null;

		const success = await db.withWrite(() => db.handoffs.updateHandoffStatus(id, status));
		if (!success) return null;

		return db.handoffs.getHandoffById(id);
	},

	async createHandoff(attributes: Record<string, unknown>): Promise<unknown> {
		if (!mcpClient.isConnected()) await mcpClient.start();
		const result = (await mcpClient.callTool("handoff-write", {
			...attributes,
			structured: true
		})) as { structuredContent?: Record<string, unknown> };
		return result.structuredContent || result;
	},

	async releaseClaim(attributes: Record<string, unknown>): Promise<Record<string, unknown>> {
		const { task_id, task_code, agent } = attributes as {
			task_id?: string;
			task_code?: string;
			agent?: string;
		};

		// Resolve task_code → task_id if needed
		let resolvedTaskId = task_id;
		if (!resolvedTaskId && task_code) {
			const repo = attributes.repo as string;
			// Dashboard resolves codes with owner="" (TASK-426) — the scope is
			// surfaced in the error so the empty owner namespace is obvious.
			const task = db.tasks.getTaskByCode("", repo, task_code);
			if (!task) {
				throw new Error(`Task not found: ${task_code} (owner="", repo="${repo}")`);
			}
			resolvedTaskId = task.id;
		}
		if (!resolvedTaskId) {
			throw new Error("task_id or task_code is required");
		}

		const success = await db.withWrite(() => db.handoffs.releaseClaim(resolvedTaskId, agent));

		if (!success) {
			throw new Error(`No active claim found for task ${resolvedTaskId}`);
		}

		return { success: true, task_id: resolvedTaskId, agent: agent ?? null };
	}
};
