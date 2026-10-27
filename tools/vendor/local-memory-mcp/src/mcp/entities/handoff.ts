import { randomUUID } from "crypto";
import { BaseEntity } from "../storage/base";
import { Handoff, HandoffRow, Claim, ClaimRow } from "../types";
import { TABLE_HANDOFFS, TABLE_TASKS, TABLE_CLAIMS } from "../utils/constants";
import { HANDOFF_STATUS_PENDING } from "../types";
import { UUID_REGEX } from "../utils/uuid";
import { ToolError } from "../utils/mcp-error";

/**
 * Upper bound on how many handoffs a short-id prefix scan will materialize for
 * disambiguation. 8-char UUID-prefix collisions are astronomically rare, so this
 * is a safety valve rather than a practical limit; when the scan is truncated
 * the ambiguity error notes that more matches exist.
 */
const HANDOFF_PREFIX_SCAN_LIMIT = 50;

/**
 * Thrown when a short handoff-id prefix matches more than one row. Carries the
 * candidate full UUIDs so the caller can disambiguate instead of silently
 * operating on an arbitrary match (FIX-023).
 *
 * Extends {@link ToolError} so the transport-level `toErrorResponse` surfaces
 * the real message + machine code (`AMBIGUOUS_ID`) rather than masking it as
 * the generic "Internal tool error".
 */
export class AmbiguousHandoffError extends ToolError {
	readonly matches: string[];

	constructor(prefix: string, matches: string[], truncated = false) {
		const listed = matches.join(", ");
		const suffix = truncated ? ` (showing first ${matches.length})` : "";
		super(
			"AMBIGUOUS_ID",
			`Ambiguous handoff id "${prefix}" — ${matches.length}${truncated ? "+" : ""} handoffs match this prefix${suffix}. ` +
				`Provide more characters or the full UUID. Matches: ${listed}`,
			{ details: { prefix, matches } }
		);
		this.name = "AmbiguousHandoffError";
		this.matches = matches;
	}
}

export class HandoffEntity extends BaseEntity {
	createHandoff(params: {
		owner: string;
		repo: string;
		from_agent: string;
		to_agent?: string | null;
		task_id?: string | null;
		summary: string;
		context?: Record<string, unknown>;
		expires_at?: string | null;
	}): Handoff {
		const now = new Date().toISOString();
		const id = randomUUID();
		this.run(
			`INSERT INTO ${TABLE_HANDOFFS} (id, owner, repo, from_agent, to_agent, task_id, summary, context, status, created_at, updated_at, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				params.owner,
				params.repo,
				params.from_agent,
				params.to_agent ?? null,
				params.task_id ?? null,
				params.summary,
				JSON.stringify(params.context ?? {}),
				HANDOFF_STATUS_PENDING,
				now,
				now,
				params.expires_at ?? null
			]
		);
		return this.getHandoffById(id)!;
	}

	listHandoffs(params: {
		owner: string;
		repo: string;
		status?: Handoff["status"];
		to_agent?: string;
		from_agent?: string;
		limit?: number;
		offset?: number;
	}): Handoff[] {
		const conditions: string[] = params.owner ? ["owner = ?", "repo = ?"] : ["repo = ?"];
		const values: unknown[] = params.owner ? [params.owner, params.repo] : [params.repo];

		if (params.status) {
			conditions.push("status = ?");
			values.push(params.status);
		}
		if (params.to_agent) {
			conditions.push("to_agent = ?");
			values.push(params.to_agent);
		}
		if (params.from_agent) {
			conditions.push("from_agent = ?");
			values.push(params.from_agent);
		}

		const limit = params.limit ?? 50;
		const offset = params.offset ?? 0;
		values.push(limit, offset);

		const rows = this.all<HandoffRow & { task_code?: string | null }>(
			`SELECT h.*, t.task_code
			 FROM ${TABLE_HANDOFFS} h
			 LEFT JOIN ${TABLE_TASKS} t ON h.task_id = t.id
			 WHERE ${conditions
					.map((condition) =>
						condition
							.replace(/\bowner\b/g, "h.owner")
							.replace(/\brepo\b/g, "h.repo")
							.replace(/\bstatus\b/g, "h.status")
							.replace(/\bto_agent\b/g, "h.to_agent")
							.replace(/\bfrom_agent\b/g, "h.from_agent")
					)
					.join(" AND ")}
			 ORDER BY h.created_at DESC LIMIT ? OFFSET ?`,
			values
		);
		return rows.map((r) => this.rowToHandoff(r));
	}

	countHandoffs(params: {
		owner: string;
		repo: string;
		status?: Handoff["status"];
		to_agent?: string;
		from_agent?: string;
	}): number {
		const conditions: string[] = params.owner ? ["owner = ?", "repo = ?"] : ["repo = ?"];
		const values: unknown[] = params.owner ? [params.owner, params.repo] : [params.repo];

		if (params.status) {
			conditions.push("status = ?");
			values.push(params.status);
		}
		if (params.to_agent) {
			conditions.push("to_agent = ?");
			values.push(params.to_agent);
		}
		if (params.from_agent) {
			conditions.push("from_agent = ?");
			values.push(params.from_agent);
		}

		const row = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM ${TABLE_HANDOFFS} WHERE ${conditions.join(" AND ")}`,
			values
		);
		return row?.count ?? 0;
	}

	/**
	 * Resolve a handoff identifier to a full UUID.
	 *
	 * FIX-023: the list view renders `[${id.slice(0, 8)}]` (an 8-char prefix),
	 * so agents naturally copy that prefix back into handoff-read / handoff-write
	 * — which previously failed against the exact full-UUID `WHERE h.id = ?`
	 * lookup ("Handoff not found" x10 in daemon.log). This resolves a short
	 * prefix to the single matching handoff.
	 *
	 * - full UUID → returned as-is (exact lookup unchanged, one query)
	 * - a `[0-9a-f-]` prefix matching exactly ONE handoff → its full id
	 * - a prefix matching MULTIPLE handoffs → {@link AmbiguousHandoffError}
	 *   (never silently picks one)
	 * - a prefix matching NONE, or a non-UUID-prefix string → returned as-is so
	 *   the caller's exact lookup yields the normal not-found result
	 *
	 * Prefix resolution is limited to hex/dash characters so the LIKE pattern
	 * cannot be hijacked by `%`/`_` wildcards from an arbitrary caller string.
	 */
	resolveHandoffId(id: string): string {
		if (UUID_REGEX.test(id)) return id;
		// Only a plausible UUID prefix (hex + dashes) is eligible for prefix
		// resolution; anything else falls through to an exact (miss) lookup.
		if (!/^[0-9a-f-]+$/i.test(id)) return id;

		const rows = this.all<{ id: string }>(`SELECT id FROM ${TABLE_HANDOFFS} WHERE id LIKE ? ORDER BY id LIMIT ?`, [
			`${id}%`,
			HANDOFF_PREFIX_SCAN_LIMIT + 1
		]);

		if (rows.length === 0) return id;
		if (rows.length === 1) return rows[0].id;

		// Truncated scan (LIMIT + 1 rows returned) — flag that more matches exist.
		const truncated = rows.length > HANDOFF_PREFIX_SCAN_LIMIT;
		throw new AmbiguousHandoffError(
			id,
			rows.slice(0, HANDOFF_PREFIX_SCAN_LIMIT).map((r) => r.id),
			truncated
		);
	}

	/**
	 * Fetch a single handoff by full UUID or by a unique short-id prefix
	 * (FIX-023). See {@link resolveHandoffId} for the resolution rules; an
	 * ambiguous prefix throws {@link AmbiguousHandoffError} and an unknown
	 * prefix returns `null` (not-found).
	 */
	getHandoffById(id: string): Handoff | null {
		const resolvedId = this.resolveHandoffId(id);
		const row = this.get<HandoffRow & { task_code?: string | null }>(
			`SELECT h.*, t.task_code
			 FROM ${TABLE_HANDOFFS} h
			 LEFT JOIN ${TABLE_TASKS} t ON h.task_id = t.id
			 WHERE h.id = ?`,
			[resolvedId]
		);
		return row ? this.rowToHandoff(row) : null;
	}

	updateHandoffStatus(id: string, status: Handoff["status"]): boolean {
		// FIX-023: accept a unique short-id prefix here too so the write path
		// (handoff-write accept/status by short id) matches the read path. An
		// ambiguous prefix throws before any UPDATE runs.
		const resolvedId = this.resolveHandoffId(id);
		const result = this.run(`UPDATE ${TABLE_HANDOFFS} SET status = ?, updated_at = ? WHERE id = ?`, [
			status,
			new Date().toISOString(),
			resolvedId
		]);
		return result.changes > 0;
	}

	updatePendingHandoffsForTask(task_id: string, status: Handoff["status"]): number {
		const result = this.run(
			`UPDATE ${TABLE_HANDOFFS} SET status = ?, updated_at = ? WHERE task_id = ? AND status = '${HANDOFF_STATUS_PENDING}'`,
			[status, new Date().toISOString(), task_id]
		);
		return result.changes;
	}

	claimTask(params: {
		owner: string;
		repo: string;
		task_id: string;
		agent: string;
		role?: string;
		metadata?: Record<string, unknown>;
	}): Claim {
		const now = new Date().toISOString();
		const id = randomUUID();

		// Release any existing active claim for this task, then insert the new
		// claim — atomic so a failure cannot leave a stale active claim behind.
		this.transaction(() => {
			this.run(`UPDATE ${TABLE_CLAIMS} SET released_at = ? WHERE task_id = ? AND released_at IS NULL`, [
				now,
				params.task_id
			]);

			this.run(
				`INSERT INTO ${TABLE_CLAIMS} (id, owner, repo, task_id, agent, role, claimed_at, released_at, metadata)
				VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
				[
					id,
					params.owner,
					params.repo,
					params.task_id,
					params.agent,
					params.role ?? "unknown",
					now,
					JSON.stringify(params.metadata ?? {})
				]
			);
		});
		return this.rowToClaim(
			this.get<ClaimRow & { task_code?: string | null }>(
				`SELECT c.*, t.task_code
				 FROM ${TABLE_CLAIMS} c
				 LEFT JOIN ${TABLE_TASKS} t ON c.task_id = t.id
				 WHERE c.id = ?`,
				[id]
			)!
		);
	}

	getClaim(task_id: string): Claim | null {
		const row = this.get<ClaimRow & { task_code?: string | null }>(
			`SELECT c.*, t.task_code
			 FROM ${TABLE_CLAIMS} c
			 LEFT JOIN ${TABLE_TASKS} t ON c.task_id = t.id
			 WHERE c.task_id = ? AND c.released_at IS NULL
			 ORDER BY c.claimed_at DESC LIMIT 1`,
			[task_id]
		);
		return row ? this.rowToClaim(row) : null;
	}

	releaseClaim(task_id: string, agent?: string): boolean {
		const now = new Date().toISOString();
		let sql = `UPDATE ${TABLE_CLAIMS} SET released_at = ? WHERE task_id = ? AND released_at IS NULL`;
		const params: unknown[] = [now, task_id];

		if (agent) {
			sql += " AND agent = ?";
			params.push(agent);
		}

		const result = this.run(sql, params);
		return result.changes > 0;
	}

	releaseClaimsForTask(task_id: string): number {
		const result = this.run(`UPDATE ${TABLE_CLAIMS} SET released_at = ? WHERE task_id = ? AND released_at IS NULL`, [
			new Date().toISOString(),
			task_id
		]);
		return result.changes;
	}

	listClaims(params: {
		owner: string;
		repo: string;
		agent?: string;
		active_only?: boolean;
		limit?: number;
		offset?: number;
	}): Claim[] {
		const conditions: string[] = params.owner ? ["owner = ?", "repo = ?"] : ["repo = ?"];
		const values: unknown[] = params.owner ? [params.owner, params.repo] : [params.repo];

		if (params.agent) {
			conditions.push("agent = ?");
			values.push(params.agent);
		}
		if (params.active_only) {
			conditions.push("released_at IS NULL");
		}

		const limit = params.limit ?? 50;
		const offset = params.offset ?? 0;
		values.push(limit, offset);

		const rows = this.all<ClaimRow & { task_code?: string | null }>(
			`SELECT c.*, t.task_code
			 FROM ${TABLE_CLAIMS} c
			 LEFT JOIN ${TABLE_TASKS} t ON c.task_id = t.id
			 WHERE ${conditions
					.map((condition) =>
						condition
							.replace(/\bowner\b/g, "c.owner")
							.replace(/\brepo\b/g, "c.repo")
							.replace(/\bagent\b/g, "c.agent")
							.replace(/released_at/g, "c.released_at")
					)
					.join(" AND ")}
			 ORDER BY c.claimed_at DESC LIMIT ? OFFSET ?`,
			values
		);
		return rows.map((r) => this.rowToClaim(r));
	}

	countClaims(params: { owner: string; repo: string; agent?: string; active_only?: boolean }): number {
		const conditions: string[] = params.owner ? ["owner = ?", "repo = ?"] : ["repo = ?"];
		const values: unknown[] = params.owner ? [params.owner, params.repo] : [params.repo];

		if (params.agent) {
			conditions.push("agent = ?");
			values.push(params.agent);
		}
		if (params.active_only) {
			conditions.push("released_at IS NULL");
		}

		const row = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM ${TABLE_CLAIMS} WHERE ${conditions.join(" AND ")}`,
			values
		);
		return row?.count ?? 0;
	}
}
