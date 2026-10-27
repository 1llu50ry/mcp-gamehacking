export interface Memory {
	id: string;
	title: string;
	content: string;
	type: string;
	importance: number;
	scope: { repo: string; owner?: string };
	owner?: string;
	tags?: string[];
	created_at: string;
	updated_at: string;
	ttl_days?: number;
	hit_count?: number;
	last_accessed_at?: string;
	is_global?: boolean;
	status?: string;
	metadata?: Record<string, unknown>;
	agent?: string;
	model?: string;
}
