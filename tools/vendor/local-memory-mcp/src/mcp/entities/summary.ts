import { BaseEntity } from "../storage/base";
import { TABLE_MEMORY_SUMMARY } from "../utils/constants";

export class SummaryEntity extends BaseEntity {
	getSummary(owner: string, repo: string): { summary: string; updated_at: string } | null {
		const row = this.get<{ summary: string; updated_at: string }>(
			`SELECT summary, updated_at FROM ${TABLE_MEMORY_SUMMARY} WHERE owner = ? AND repo = ?`,
			[owner, repo]
		);
		return row || null;
	}

	/**
	 * Atomic upsert of the repo summary. A single INSERT ... ON CONFLICT
	 * statement (no SELECT-then-write race window); memory_summary is the
	 * single owner of the (owner, repo) → summary row.
	 */
	upsertSummary(owner: string, repo: string, summary: string): void {
		this.run(
			`INSERT INTO ${TABLE_MEMORY_SUMMARY} (owner, repo, summary, updated_at) VALUES (?, ?, ?, ?)
			ON CONFLICT(owner, repo) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`,
			[owner, repo, summary, new Date().toISOString()]
		);
	}
}
