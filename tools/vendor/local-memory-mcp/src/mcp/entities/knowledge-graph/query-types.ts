/**
 * Minimal read-only SQL accessor implemented by KnowledgeGraphEntity so the
 * standalone query functions in this module can execute through the shared
 * prepared-statement cache without widening BaseEntity's protected surface.
 */
export interface KgQueryRunner {
	all<T = unknown>(sql: string, params?: unknown[]): T[];
	get<T = unknown>(sql: string, params?: unknown[]): T | undefined;
}

// ---------------------------------------------------------------------------
// Row shapes for the KG tables (entities / relations / observations)
// ---------------------------------------------------------------------------

export interface KgEntityRow {
	name: string;
	type: string;
	description: string | null;
	repo: string;
	owner: string;
	created_at: string;
	updated_at: string;
}

export interface KgRelationRow {
	from_entity: string;
	to_entity: string;
	relation_type: string;
	repo: string;
	owner: string;
	created_at: string;
	/** Per-edge confidence label (migration v24 / TASK-325); 1.0 for pre-v24 and explicit rows. */
	confidence: number;
}

export interface KgObservationRow {
	id: string;
	entity_name: string;
	observation: string;
	repo: string;
	owner: string;
	created_at: string;
}
