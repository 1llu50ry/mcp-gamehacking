/**
 * Leaf SQL writers for the knowledge-graph tables (TASK-432). These are the
 * primitive INSERT statements; orchestration (ensureRelation / ensureObservation
 * / saveExtractionBatch) stays on the KnowledgeGraphEntity instance so it can
 * compose them via `this.upsertEntity` / `this.insertObservation` and share the
 * entity's transaction boundary. `KgWriteRunner` exposes BaseEntity's `run`
 * helper, mirroring the `KgQueryRunner` read accessor from `./queries`.
 */
export interface KgWriteRunner {
	run(sql: string, params?: unknown[]): { changes: number };
	transaction<T>(fn: () => T): T;
}

export interface UpsertEntityParams {
	name: string;
	type: string;
	description: string | null;
	repo: string;
	owner: string;
	created_at: string;
	updated_at: string;
}

export interface UpsertRelationParams {
	from_entity: string;
	to_entity: string;
	relation_type: string;
	repo: string;
	owner: string;
	created_at: string;
	confidence?: number;
}

export interface InsertObservationParams {
	id: string;
	entity_name: string;
	observation: string;
	repo: string;
	owner: string;
	created_at: string;
}

export interface CreateEntityParams {
	name: string;
	type: string;
	description: string | null;
	repo: string;
	owner: string;
	created_at: string;
	updated_at: string;
}

export interface CreateRelationParams {
	from_entity: string;
	to_entity: string;
	relation_type: string;
	repo: string;
	owner: string;
	created_at: string;
	confidence?: number;
}

/** Insert an entity, ignoring duplicates within its `(name, repo)` identity. */
export function upsertEntity(runner: KgWriteRunner, params: UpsertEntityParams): void {
	runner.run(
		`INSERT OR IGNORE INTO entities (name, type, description, repo, owner, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[params.name, params.type, params.description, params.repo, params.owner, params.created_at, params.updated_at]
	);
}

/**
 * Insert a relation, ignoring duplicates within `(from_entity, to_entity, relation_type, repo)`.
 *
 * `confidence` is the per-edge KG confidence label (migration v24, [KGCONF-1]
 * / TASK-325): an INSERT-TIME constant chosen by the CALLER SITE (the
 * relations table has no source column — the writer that creates the row
 * is the provenance). Default 1.0 when omitted (explicit-grade, backward
 * compatible — pre-v24 rows and legacy callers read 1.0). The mapping is
 * documented in the v24 migration: NLP auto-extraction (saveExtractions)
 * 0.55, structured semantic writers 0.8, parser-deterministic codebase
 * edges 0.9, explicit/manual + default 1.0.
 *
 * INSERT OR IGNORE first-write-wins: re-inserting an existing edge is a
 * no-op, so the FIRST writer's confidence sticks (a later writer can never
 * overwrite a row already present — including one carrying a lower
 * auto-extraction confidence).
 */
export function upsertRelation(runner: KgWriteRunner, params: UpsertRelationParams): void {
	runner.run(
		`INSERT OR IGNORE INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at, confidence)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			params.from_entity,
			params.to_entity,
			params.relation_type,
			params.repo,
			params.owner,
			params.created_at,
			params.confidence ?? 1.0
		]
	);
}

/**
 * INSERT OR IGNORE against the unique (entity_name, observation) index (v9)
 * so lease-recovery reprocessing never duplicates (TASK-013).
 */
export function insertObservation(runner: KgWriteRunner, params: InsertObservationParams): void {
	runner.run(
		`INSERT OR IGNORE INTO observations (id, entity_name, observation, repo, owner, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		[params.id, params.entity_name, params.observation, params.repo, params.owner, params.created_at]
	);
}

/** Dashboard/admin create: plain INSERT (throws on duplicate name → PK conflict). */
export function createEntity(runner: KgWriteRunner, params: CreateEntityParams): void {
	runner.run(
		`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[params.name, params.type, params.description, params.repo, params.owner, params.created_at, params.updated_at]
	);
}

/** Dashboard/admin create: plain INSERT (throws on duplicate relation → 409). */
export function createRelation(runner: KgWriteRunner, params: CreateRelationParams): void {
	runner.run(
		`INSERT INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at, confidence)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			params.from_entity,
			params.to_entity,
			params.relation_type,
			params.repo,
			params.owner,
			params.created_at,
			params.confidence ?? 1.0
		]
	);
}
