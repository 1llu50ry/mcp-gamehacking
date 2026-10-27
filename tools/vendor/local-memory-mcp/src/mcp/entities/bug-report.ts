import { BaseEntity } from "../storage/base";

export interface BugReportInput {
	fingerprint: string;
	source: string;
	severity?: string;
	message: string;
	stack?: string | null;
	context?: Record<string, unknown>;
	runtime?: Record<string, unknown>;
}

export interface BugReport {
	id: number;
	fingerprint: string;
	source: string;
	severity: string;
	message: string;
	stack: string | null;
	context: Record<string, unknown>;
	runtime: Record<string, unknown>;
	count: number;
	first_seen_at: string;
	last_seen_at: string;
	resolved_at: string | null;
}

export interface BugReportListOptions {
	includeResolved?: boolean;
	source?: string;
	limit?: number;
	offset?: number;
}

export interface BugReportStats {
	total: number;
	open: number;
	resolved: number;
	totalOccurrences: number;
	bySource: Record<string, number>;
	lastSeenAt: string | null;
}

interface BugReportRow {
	id: number;
	fingerprint: string;
	source: string;
	severity: string;
	message: string;
	stack: string | null;
	context: string | null;
	runtime: string | null;
	count: number;
	first_seen_at: string;
	last_seen_at: string;
	resolved_at: string | null;
}

/**
 * Local bug-report store (bug telemetry). Rows are deduped by a stable
 * `fingerprint` so repeated occurrences of the same failure bump `count`
 * instead of piling up new rows. A recurrence clears `resolved_at`, so a bug
 * that reappears after being marked resolved reopens automatically.
 */
export class BugReportEntity extends BaseEntity {
	/**
	 * Insert a new report or bump the occurrence count of an existing one
	 * (deduped by fingerprint). Deliberately a SINGLE atomic statement with no
	 * enclosing transaction: it is safe to call from error paths that may
	 * already hold — or be nested inside — a write context, where a
	 * BEGIN IMMEDIATE would throw ("cannot start a transaction within a
	 * transaction"). Returns the row id.
	 */
	upsert(input: BugReportInput): number {
		const now = new Date().toISOString();
		this.run(
			`INSERT INTO bug_reports
				(fingerprint, source, severity, message, stack, context, runtime, count, first_seen_at, last_seen_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
			 ON CONFLICT(fingerprint) DO UPDATE SET
				count = count + 1,
				last_seen_at = excluded.last_seen_at,
				severity = excluded.severity,
				resolved_at = NULL`,
			[
				input.fingerprint,
				input.source,
				input.severity ?? "error",
				input.message,
				input.stack ?? null,
				JSON.stringify(input.context ?? {}),
				JSON.stringify(input.runtime ?? {}),
				now,
				now
			]
		);
		const row = this.get<{ id: number }>("SELECT id FROM bug_reports WHERE fingerprint = ?", [input.fingerprint]);
		return row?.id ?? 0;
	}

	list(options: BugReportListOptions = {}): BugReport[] {
		const limit = Math.max(1, Math.min(1000, Math.trunc(options.limit ?? 50)));
		const offset = Math.max(0, Math.trunc(options.offset ?? 0));
		const where: string[] = [];
		const params: unknown[] = [];
		if (!options.includeResolved) where.push("resolved_at IS NULL");
		if (options.source) {
			where.push("source = ?");
			params.push(options.source);
		}
		const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
		params.push(limit, offset);
		const rows = this.all<BugReportRow>(
			`SELECT * FROM bug_reports ${clause} ORDER BY last_seen_at DESC, count DESC LIMIT ? OFFSET ?`,
			params
		);
		return rows.map((row) => this.rowToReport(row));
	}

	getById(id: number): BugReport | null {
		const row = this.get<BugReportRow>("SELECT * FROM bug_reports WHERE id = ?", [id]);
		return row ? this.rowToReport(row) : null;
	}

	/** Mark a report resolved. Returns true when a row was actually changed. */
	resolve(id: number): boolean {
		const now = new Date().toISOString();
		return (
			this.run("UPDATE bug_reports SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL", [now, id]).changes > 0
		);
	}

	stats(): BugReportStats {
		const totals = this.get<{ total: number; open: number; resolved: number; occurrences: number }>(
			`SELECT COUNT(*) AS total,
				COALESCE(SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END), 0) AS open,
				COALESCE(SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS resolved,
				COALESCE(SUM(count), 0) AS occurrences
			 FROM bug_reports`
		);
		const bySource: Record<string, number> = {};
		for (const row of this.all<{ source: string; n: number }>(
			"SELECT source, COUNT(*) AS n FROM bug_reports GROUP BY source ORDER BY n DESC"
		)) {
			bySource[row.source] = row.n;
		}
		const last = this.get<{ last_seen_at: string | null }>("SELECT MAX(last_seen_at) AS last_seen_at FROM bug_reports");
		return {
			total: totals?.total ?? 0,
			open: totals?.open ?? 0,
			resolved: totals?.resolved ?? 0,
			totalOccurrences: totals?.occurrences ?? 0,
			bySource,
			lastSeenAt: last?.last_seen_at ?? null
		};
	}

	/** Age + row-cap pruning (mirrors ReuseTelemetryEntity.prune). */
	prune(retentionDays: number, maxRows: number): number {
		const days = Math.max(1, Math.min(365, Math.trunc(retentionDays)));
		const cap = Math.max(50, Math.trunc(maxRows));
		return this.transaction(() => {
			const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
			const expired = this.run("DELETE FROM bug_reports WHERE last_seen_at < ?", [cutoff]).changes;
			const overflow = this.run(
				`DELETE FROM bug_reports WHERE id IN (
					SELECT id FROM bug_reports ORDER BY last_seen_at DESC LIMIT -1 OFFSET ?
				)`,
				[cap]
			).changes;
			return expired + overflow;
		});
	}

	clear(): number {
		return this.run("DELETE FROM bug_reports").changes;
	}

	private rowToReport(row: BugReportRow): BugReport {
		return {
			id: row.id,
			fingerprint: row.fingerprint,
			source: row.source,
			severity: row.severity,
			message: row.message,
			stack: row.stack,
			context: this.safeJSONParse<Record<string, unknown>>(row.context, {}),
			runtime: this.safeJSONParse<Record<string, unknown>>(row.runtime, {}),
			count: row.count,
			first_seen_at: row.first_seen_at,
			last_seen_at: row.last_seen_at,
			resolved_at: row.resolved_at
		};
	}
}
