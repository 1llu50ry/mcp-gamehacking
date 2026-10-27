/**
 * Server-side response DTOs shared by dashboard controllers.
 *
 * These types previously lived in the Svelte UI bundle
 * (`src/dashboard/ui/src/lib/interfaces/common.ts`) and were imported into
 * server code, which is a dependency-direction smell (the UI is excluded from
 * the root tsconfig). They now live next to their server consumers; the UI
 * keeps its own copy of the wire shape.
 */

/** A single action-log entry surfaced by GET /api/recent-actions. */
export interface RecentAction {
	id: number;
	action: string;
	query?: string;
	response?: string;
	memory_id?: string;
	memory_title?: string;
	memory_type?: string;
	task_id?: string;
	task_title?: string;
	task_code?: string;
	result_count?: number;
	created_at: string;
	burstCount?: number;
}
