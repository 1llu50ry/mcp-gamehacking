import { BaseEntity } from "../storage/base";
import { TABLE_ACTION_LOG, TABLE_MEMORIES } from "../utils/constants";

export class ActionEntity extends BaseEntity {
	logAction(
		action: string,
		owner: string,
		repo: string,
		optionsOrQuery?:
			| string
			| { query?: string; response?: string | object; memoryId?: string; taskId?: string; resultCount?: number },
		response?: string,
		memoryId?: string,
		taskId?: string,
		resultCount: number = 0
	): void {
		let query = typeof optionsOrQuery === "string" ? optionsOrQuery : undefined;
		let finalResponse = response;
		let finalMemoryId = memoryId;
		let finalTaskId = taskId;
		let finalResultCount = resultCount;

		if (optionsOrQuery && typeof optionsOrQuery === "object") {
			query = optionsOrQuery.query || query;
			const res = optionsOrQuery.response;
			finalResponse = (typeof res === "object" ? JSON.stringify(res) : res) || finalResponse;
			finalMemoryId = optionsOrQuery.memoryId || finalMemoryId;
			finalTaskId = optionsOrQuery.taskId || finalTaskId;
			finalResultCount = optionsOrQuery.resultCount !== undefined ? optionsOrQuery.resultCount : finalResultCount;
		}

		this.run(
			`INSERT INTO ${TABLE_ACTION_LOG} (owner, repo, action, query, response, memory_id, task_id, result_count, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				owner,
				repo || "",
				action || "unknown",
				query || null,
				finalResponse ? (typeof finalResponse === "string" ? finalResponse : JSON.stringify(finalResponse)) : null,
				finalMemoryId || null,
				finalTaskId || null,
				finalResultCount ?? 0,
				new Date().toISOString()
			]
		);
	}

	getLastActionId(): number {
		const row = this.get<{ id: number }>(`SELECT MAX(id) as id FROM ${TABLE_ACTION_LOG}`);
		return row?.id || 0;
	}

	getActionsAfter(id: number): (ActionLogRow & { memory_title?: string; memory_type?: string })[] {
		return this.all<ActionLogRow & { memory_title?: string; memory_type?: string }>(
			`SELECT a.*, m.title as memory_title, m.type as memory_type 
			FROM ${TABLE_ACTION_LOG} a LEFT JOIN ${TABLE_MEMORIES} m ON a.memory_id = m.id 
			WHERE a.id > ? ORDER BY a.created_at ASC`,
			[id]
		);
	}

	getRecentActions(
		owner?: string,
		repo?: string,
		limit: number = 10,
		offset: number = 0
	): (ActionLogRow & { memory_title?: string; memory_type?: string })[] {
		let query = `
			SELECT a.*, m.title as memory_title, m.type as memory_type 
			FROM ${TABLE_ACTION_LOG} a LEFT JOIN ${TABLE_MEMORIES} m ON a.memory_id = m.id
		`;
		const params: (string | number)[] = [];
		const where: string[] = [];

		if (repo) {
			where.push("a.repo = ?");
			params.push(repo);
		}
		if (owner) {
			where.push("a.owner = ?");
			params.push(owner);
		}

		if (where.length > 0) {
			query += " WHERE " + where.join(" AND ");
		}

		query += " ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?";
		params.push(limit, offset);

		return this.all<ActionLogRow & { memory_title?: string; memory_type?: string }>(query, params);
	}

	getActionStatsByDate(owner: string, repo: string): { date: string; count: number }[] {
		return this.all<{ date: string; count: number }>(
			`SELECT date(created_at) as date, count(*) as count 
			FROM ${TABLE_ACTION_LOG} 
			WHERE owner = ? AND repo = ? AND created_at > date('now', '-30 days')
			GROUP BY date(created_at)
			ORDER BY date ASC`,
			[owner, repo]
		);
	}

	getActionDistribution(owner: string, repo: string): { action: string; count: number }[] {
		return this.all<{ action: string; count: number }>(
			`SELECT action, count(*) as count 
			FROM ${TABLE_ACTION_LOG} 
			WHERE owner = ? AND repo = ?
			GROUP BY action`,
			[owner, repo]
		);
	}

	getActionById(id: number): (ActionLogRow & { memory_title?: string; memory_type?: string }) | undefined {
		return this.get<ActionLogRow & { memory_title?: string; memory_type?: string }>(
			`SELECT a.*, m.title as memory_title, m.type as memory_type 
			FROM ${TABLE_ACTION_LOG} a LEFT JOIN ${TABLE_MEMORIES} m ON a.memory_id = m.id 
			WHERE a.id = ?`,
			[id]
		);
	}
}

interface ActionLogRow {
	id: number;
	owner: string;
	repo: string;
	action: string;
	query: string | null;
	response: string | null;
	memory_id: string | null;
	task_id: string | null;
	result_count: number;
	created_at: string;
}
