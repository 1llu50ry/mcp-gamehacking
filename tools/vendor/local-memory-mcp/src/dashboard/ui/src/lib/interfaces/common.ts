export interface Pagination {
	page: number;
	pageSize: number;
	totalItems: number;
	totalPages: number;
}

// Moved from lib/types (TASK-088): live barrel is lib/interfaces
export type Theme = "light" | "dark";
export type ThemePreference = Theme | "auto";

export interface KGNode {
	id: string;
	name: string;
	type: string;
	description?: string;
	memoryCount?: number;
}

export interface KGEdge {
	source: string;
	target: string;
	relation_type: string;
	/** Per-edge extraction confidence 0..1 (TASK-325: relations.confidence; 1.0 when absent/unknown). */
	confidence?: number;
}

export interface KGEntity {
	name: string;
	type: string;
	description?: string;
	repo: string;
	created_at: string;
	updated_at: string;
}

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
