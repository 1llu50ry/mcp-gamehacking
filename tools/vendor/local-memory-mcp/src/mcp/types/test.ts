export interface MockMemory {
	id: string;
	type: string;
	content: string;
	importance: number;
	hit_count?: number;
	created_at?: string;
	agent?: string;
	model?: string;
}
