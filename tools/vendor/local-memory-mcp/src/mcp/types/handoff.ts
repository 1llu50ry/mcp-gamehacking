// Single source of truth for handoff/claim status. The zod schema
// (tools/schemas/shared.ts) derives its enum from this const.
export const HANDOFF_STATUS_PENDING = "pending" as const;
export const HANDOFF_STATUS_ACCEPTED = "accepted" as const;
export const HANDOFF_STATUS_REJECTED = "rejected" as const;
export const HANDOFF_STATUS_EXPIRED = "expired" as const;
export const HANDOFF_STATUSES = [
	HANDOFF_STATUS_PENDING,
	HANDOFF_STATUS_ACCEPTED,
	HANDOFF_STATUS_REJECTED,
	HANDOFF_STATUS_EXPIRED
] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export interface Handoff {
	id: string;
	owner: string;
	repo: string;
	from_agent: string;
	to_agent: string | null;
	task_id: string | null;
	task_code?: string | null;
	summary: string;
	context: Record<string, unknown>;
	status: HandoffStatus;
	created_at: string;
	updated_at: string;
	expires_at: string | null;
}

export interface HandoffRow {
	id: string;
	owner: string;
	repo: string;
	from_agent: string;
	to_agent: string | null;
	task_id: string | null;
	summary: string;
	context: string;
	status: string;
	created_at: string;
	updated_at: string;
	expires_at: string | null;
}

export interface Claim {
	id: string;
	owner: string;
	repo: string;
	task_id: string;
	task_code?: string | null;
	agent: string;
	role: string;
	claimed_at: string;
	released_at: string | null;
	metadata: Record<string, unknown>;
}

export interface ClaimRow {
	id: string;
	owner: string;
	repo: string;
	task_id: string;
	agent: string;
	role: string;
	claimed_at: string;
	released_at: string | null;
	metadata: string;
}
