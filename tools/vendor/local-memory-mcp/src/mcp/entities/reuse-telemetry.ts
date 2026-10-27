import { BaseEntity } from "../storage/base";

export interface ReuseTelemetryDelta {
	owner: string;
	repo: string;
	bucket: string;
	metric: string;
	source: string;
	count: number;
	value: number;
}

export interface ReuseTelemetrySummary {
	from: string;
	to: string;
	metrics: Record<
		string,
		{ count: number; value: number; by_source: Record<string, { count: number; value: number }> }
	>;
}

interface SummaryRow {
	metric: string;
	source: string;
	count: number;
	value: number;
}

export class ReuseTelemetryEntity extends BaseEntity {
	flush(deltas: ReuseTelemetryDelta[]): void {
		if (deltas.length === 0) return;
		this.transaction(() => {
			for (const delta of deltas) {
				this.run(
					`INSERT INTO reuse_telemetry_hourly (owner, repo, bucket, metric, source, count, value)
					 VALUES (?, ?, ?, ?, ?, ?, ?)
					 ON CONFLICT(owner, repo, bucket, metric, source) DO UPDATE SET
					 count = count + excluded.count, value = value + excluded.value`,
					[delta.owner, delta.repo, delta.bucket, delta.metric, delta.source, delta.count, delta.value]
				);
			}
		});
	}

	summarize(owner: string, repo: string, hours = 24): ReuseTelemetrySummary {
		const boundedHours = Math.max(1, Math.min(24 * 90, Math.trunc(hours)));
		const to = new Date();
		const from = new Date(to.getTime() - boundedHours * 3_600_000);
		const rows = this.all<SummaryRow>(
			`SELECT metric, source, SUM(count) AS count, SUM(value) AS value
			 FROM reuse_telemetry_hourly
			 WHERE owner = ? AND repo = ? AND bucket >= ?
			 GROUP BY metric, source ORDER BY metric, source`,
			[owner, repo, from.toISOString()]
		);
		const metrics: ReuseTelemetrySummary["metrics"] = {};
		for (const row of rows) {
			const metric = (metrics[row.metric] ??= { count: 0, value: 0, by_source: {} });
			metric.count += row.count;
			metric.value += row.value;
			if (row.source) metric.by_source[row.source] = { count: row.count, value: row.value };
		}
		return { from: from.toISOString(), to: to.toISOString(), metrics };
	}

	prune(retentionDays: number, maxRows: number): number {
		const days = Math.max(1, Math.min(365, Math.trunc(retentionDays)));
		const cap = Math.max(24, Math.trunc(maxRows));
		return this.transaction(() => {
			const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
			const expired = this.run("DELETE FROM reuse_telemetry_hourly WHERE bucket < ?", [cutoff]).changes;
			const overflow = this.run(
				`DELETE FROM reuse_telemetry_hourly WHERE rowid IN (
					SELECT rowid FROM reuse_telemetry_hourly ORDER BY bucket DESC LIMIT -1 OFFSET ?
				)`,
				[cap]
			).changes;
			return expired + overflow;
		});
	}
}
