import { BaseEntity } from "../../storage/base";
import { MemoryEntry, MemoryRow } from "../../types";
import { TABLE_MEMORIES, TABLE_TASKS, TABLE_CLAIMS, TABLE_HANDOFFS } from "../../utils/constants";
import {
	TASK_STATUS_BACKLOG,
	TASK_STATUS_PENDING,
	TASK_STATUS_IN_PROGRESS,
	TASK_STATUS_COMPLETED,
	TASK_STATUS_CANCELED,
	TASK_STATUS_BLOCKED
} from "../../types";
import { HANDOFF_STATUS_PENDING } from "../../types";

// ─── Global dashboard stats cache ────────────────────────────────────────────
// TTL in ms. Global stats are invariant between mutations; a short TTL avoids
// redundant full-table aggregation on every repo-select / refresh while keeping
// stale data bounded to ≤7 s.
const GLOBAL_STATS_CACHE_TTL_MS = 7_000;

export class SystemEntity extends BaseEntity {
	private _globalStatsCache: { data: ReturnType<SystemEntity["getGlobalDashboardStats"]>; ts: number } | null = null;
	private buildTaskStats(rows: Array<{ status: string; count: number }>) {
		const taskStats = {
			total: 0,
			backlog: 0,
			pending: 0,
			in_progress: 0,
			completed: 0,
			blocked: 0,
			canceled: 0
		};

		rows.forEach((r) => {
			taskStats.total += r.count;
			if (r.status === TASK_STATUS_BACKLOG) taskStats.backlog = r.count;
			else if (r.status === TASK_STATUS_PENDING) taskStats.pending = r.count;
			else if (r.status === TASK_STATUS_IN_PROGRESS) taskStats.in_progress = r.count;
			else if (r.status === TASK_STATUS_COMPLETED) taskStats.completed = r.count;
			else if (r.status === TASK_STATUS_BLOCKED) taskStats.blocked = r.count;
			else if (r.status === TASK_STATUS_CANCELED) taskStats.canceled = r.count;
		});

		return taskStats;
	}

	listRepos(owner?: string): string[] {
		let sql: string;
		if (owner) {
			sql = `SELECT DISTINCT repo FROM ${TABLE_MEMORIES} WHERE owner = ? UNION SELECT DISTINCT repo FROM ${TABLE_TASKS} WHERE owner = ?`;
		} else {
			sql = `SELECT DISTINCT repo FROM ${TABLE_MEMORIES} UNION SELECT DISTINCT repo FROM ${TABLE_TASKS}`;
		}
		const params = owner ? [owner, owner] : [];
		const rows = this.all<{ repo: string }>(sql, params);
		return rows.map((r) => r.repo);
	}

	listRepoNavigation(owner?: string): {
		repo: string;
		memoryCount: number;
		taskCount: number;
		inProgressCount: number;
		pendingCount: number;
		blockedCount: number;
		backlogCount: number;
		lastActivity: string | null;
		activeClaims: number;
		pendingHandoffs: number;
		unassignedHandoffs: number;
		staleClaims: number;
	}[] {
		const repos = this.listRepos(owner);
		const ownerFilter = owner ? " AND owner = ?" : "";
		const ownerParams = owner ? [owner] : [];

		const activeClaimRows = this.all<{ repo: string; count: number }>(
			`SELECT repo, COUNT(*) as count FROM ${TABLE_CLAIMS} WHERE released_at IS NULL${ownerFilter} GROUP BY repo`,
			ownerParams
		);
		const pendingHandoffRows = this.all<{ repo: string; count: number }>(
			`SELECT repo, COUNT(*) as count FROM ${TABLE_HANDOFFS} WHERE status = '${HANDOFF_STATUS_PENDING}'${ownerFilter} GROUP BY repo`,
			ownerParams
		);
		const unassignedHandoffRows = this.all<{ repo: string; count: number }>(
			`SELECT repo, COUNT(*) as count FROM ${TABLE_HANDOFFS} WHERE status = '${HANDOFF_STATUS_PENDING}' AND to_agent IS NULL${ownerFilter} GROUP BY repo`,
			ownerParams
		);
		const staleClaimRows = this.all<{ repo: string; count: number }>(
			`SELECT repo, COUNT(*) as count FROM ${TABLE_CLAIMS} WHERE released_at IS NULL AND claimed_at <= datetime('now', '-1 day')${ownerFilter} GROUP BY repo`,
			ownerParams
		);

		const activeClaimsByRepo = Object.fromEntries(activeClaimRows.map((row) => [row.repo, row.count]));
		const pendingHandoffsByRepo = Object.fromEntries(pendingHandoffRows.map((row) => [row.repo, row.count]));
		const unassignedHandoffsByRepo = Object.fromEntries(unassignedHandoffRows.map((row) => [row.repo, row.count]));
		const staleClaimsByRepo = Object.fromEntries(staleClaimRows.map((row) => [row.repo, row.count]));

		const ownerWhere = owner ? " WHERE owner = ?" : "";

		// Aggregate memory counts per repo (single query instead of N)
		const memoryCountRows = this.all<{ repo: string; count: number }>(
			`SELECT repo, COUNT(*) as count FROM ${TABLE_MEMORIES}${ownerWhere} GROUP BY repo`,
			ownerParams
		);
		const memoryCountByRepo = Object.fromEntries(memoryCountRows.map((r) => [r.repo, r.count]));

		// Aggregate task status counts per repo (single query instead of N)
		const taskAggRows = this.all<{ repo: string; status: string; count: number }>(
			`SELECT repo, status, COUNT(*) as count FROM ${TABLE_TASKS}${ownerWhere} GROUP BY repo, status`,
			ownerParams
		);
		const taskCountsByRepo: Record<string, { total: number; byStatus: Record<string, number> }> = {};
		for (const row of taskAggRows) {
			if (!taskCountsByRepo[row.repo]) {
				taskCountsByRepo[row.repo] = { total: 0, byStatus: {} };
			}
			taskCountsByRepo[row.repo].total += row.count;
			taskCountsByRepo[row.repo].byStatus[row.status] = row.count;
		}

		// Aggregate last activity per repo (single query instead of N)
		const lastActivityRows = this.all<{ repo: string; last: string | null }>(
			`SELECT repo, MAX(updated_at) as last FROM (
				SELECT repo, updated_at FROM ${TABLE_MEMORIES}${ownerWhere}
				UNION ALL
				SELECT repo, updated_at FROM ${TABLE_TASKS}${ownerWhere}
			) GROUP BY repo`,
			owner ? [owner, owner] : []
		);
		const lastActivityByRepo = Object.fromEntries(lastActivityRows.map((r) => [r.repo, r.last]));

		return repos.map((repo) => {
			const memCount = memoryCountByRepo[repo] ?? 0;
			const taskInfo = taskCountsByRepo[repo] ?? { total: 0, byStatus: {} };

			return {
				repo,
				memoryCount: memCount,
				taskCount: taskInfo.total,
				inProgressCount: taskInfo.byStatus[TASK_STATUS_IN_PROGRESS] ?? 0,
				pendingCount: taskInfo.byStatus[TASK_STATUS_PENDING] ?? 0,
				blockedCount: taskInfo.byStatus[TASK_STATUS_BLOCKED] ?? 0,
				backlogCount: taskInfo.byStatus[TASK_STATUS_BACKLOG] ?? 0,
				lastActivity: lastActivityByRepo[repo] ?? null,
				activeClaims: activeClaimsByRepo[repo] ?? 0,
				pendingHandoffs: pendingHandoffsByRepo[repo] ?? 0,
				unassignedHandoffs: unassignedHandoffsByRepo[repo] ?? 0,
				staleClaims: staleClaimsByRepo[repo] ?? 0
			};
		});
	}

	getDashboardStats(
		owner: string,
		repo: string
	): {
		scope: "repo";
		total: number;
		avgImportance: string;
		totalHitCount: number;
		expiringSoon: number;
		byType: Record<string, number>;
		taskStats: {
			total: number;
			backlog: number;
			pending: number;
			in_progress: number;
			completed: number;
			blocked: number;
			canceled: number;
		};
		topMemories: MemoryEntry[];
	} {
		const totalCountRow = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM ${TABLE_MEMORIES} WHERE owner = ? AND repo = ?`,
			[owner, repo]
		);
		const avgImportanceRow = this.get<{ avg: number }>(
			`SELECT AVG(importance) as avg FROM ${TABLE_MEMORIES} WHERE owner = ? AND repo = ?`,
			[owner, repo]
		);
		const totalHitCountRow = this.get<{ count: number }>(
			`SELECT SUM(hit_count) as count FROM ${TABLE_MEMORIES} WHERE owner = ? AND repo = ?`,
			[owner, repo]
		);
		const expiringSoonRow = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM ${TABLE_MEMORIES} WHERE owner = ? AND repo = ? AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?`,
			[owner, repo, new Date().toISOString(), new Date(Date.now() + 7 * 86400 * 1000).toISOString()]
		);

		const typeStats = this.all<{ type: string; count: number }>(
			`SELECT type, COUNT(*) as count FROM ${TABLE_MEMORIES} WHERE owner = ? AND repo = ? GROUP BY type`,
			[owner, repo]
		);
		const byType: Record<string, number> = {};
		typeStats.forEach((t) => {
			byType[t.type] = t.count;
		});

		const taskRows = this.all<{ status: string; count: number }>(
			`SELECT status, COUNT(*) as count FROM ${TABLE_TASKS} WHERE owner = ? AND repo = ? GROUP BY status`,
			[owner, repo]
		);

		const taskStats = this.buildTaskStats(taskRows);

		const topMemoriesRows = this.all<MemoryRow>(
			`SELECT * FROM ${TABLE_MEMORIES} WHERE owner = ? AND repo = ? ORDER BY importance DESC, created_at DESC LIMIT 5`,
			[owner, repo]
		);
		const topMemories = topMemoriesRows.map((r) => this.rowToMemoryEntry(r));

		return {
			scope: "repo",
			total: totalCountRow?.count ?? 0,
			avgImportance: (avgImportanceRow?.avg ?? 0).toFixed(1),
			totalHitCount: totalHitCountRow?.count ?? 0,
			expiringSoon: expiringSoonRow?.count ?? 0,
			byType,
			taskStats,
			topMemories
		};
	}

	getGlobalDashboardStats(): {
		scope: "global";
		total: number;
		avgImportance: string;
		totalHitCount: number;
		expiringSoon: number;
		byType: Record<string, number>;
		taskStats: {
			total: number;
			backlog: number;
			pending: number;
			in_progress: number;
			completed: number;
			blocked: number;
			canceled: number;
		};
		repoCount: number;
		activeRepoCount: number;
		coordination: {
			activeClaims: number;
			agentsClaiming: number;
			pendingHandoffs: number;
			unassignedHandoffs: number;
			staleClaims: number;
			staleHandoffs: number;
		};
		repos: Array<{
			repo: string;
			memoryCount: number;
			taskCount: number;
			inProgressCount: number;
			pendingCount: number;
			blockedCount: number;
			backlogCount: number;
			lastActivity: string | null;
			activeClaims: number;
			pendingHandoffs: number;
			unassignedHandoffs: number;
			staleClaims: number;
		}>;
	} {
		const now = Date.now();
		if (this._globalStatsCache && now - this._globalStatsCache.ts < GLOBAL_STATS_CACHE_TTL_MS) {
			return this._globalStatsCache.data;
		}

		const data = this.computeGlobalDashboardStats();
		this._globalStatsCache = { data, ts: now };
		return data;
	}

	private computeGlobalDashboardStats(): ReturnType<SystemEntity["getGlobalDashboardStats"]> {
		const totalCountRow = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM ${TABLE_MEMORIES}`);
		const avgImportanceRow = this.get<{ avg: number }>(`SELECT AVG(importance) as avg FROM ${TABLE_MEMORIES}`);
		const totalHitCountRow = this.get<{ count: number }>(`SELECT SUM(hit_count) as count FROM ${TABLE_MEMORIES}`);
		const expiringSoonRow = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM ${TABLE_MEMORIES} WHERE expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?`,
			[new Date().toISOString(), new Date(Date.now() + 7 * 86400 * 1000).toISOString()]
		);
		const typeStats = this.all<{ type: string; count: number }>(
			`SELECT type, COUNT(*) as count FROM ${TABLE_MEMORIES} GROUP BY type`
		);
		const taskRows = this.all<{ status: string; count: number }>(
			`SELECT status, COUNT(*) as count FROM ${TABLE_TASKS} GROUP BY status`
		);
		const repos = this.listRepoNavigation().sort((a, b) => {
			const pressureA =
				a.blockedCount * 5 + a.inProgressCount * 3 + a.pendingCount * 2 + a.pendingHandoffs * 2 + a.activeClaims;
			const pressureB =
				b.blockedCount * 5 + b.inProgressCount * 3 + b.pendingCount * 2 + b.pendingHandoffs * 2 + b.activeClaims;
			return pressureB - pressureA || (b.taskCount || 0) - (a.taskCount || 0);
		});

		const byType: Record<string, number> = {};
		typeStats.forEach((t) => {
			byType[t.type] = t.count;
		});

		const activeClaimsRow = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM ${TABLE_CLAIMS} WHERE released_at IS NULL`
		);
		const agentsClaimingRow = this.get<{ count: number }>(
			`SELECT COUNT(DISTINCT agent) as count FROM ${TABLE_CLAIMS} WHERE released_at IS NULL`
		);
		const pendingHandoffsRow = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM ${TABLE_HANDOFFS} WHERE status = '${HANDOFF_STATUS_PENDING}'`
		);
		const unassignedHandoffsRow = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM ${TABLE_HANDOFFS} WHERE status = '${HANDOFF_STATUS_PENDING}' AND to_agent IS NULL`
		);
		const staleClaimsRow = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM ${TABLE_CLAIMS} WHERE released_at IS NULL AND claimed_at <= datetime('now', '-1 day')`
		);
		const staleHandoffsRow = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM ${TABLE_HANDOFFS} WHERE status = '${HANDOFF_STATUS_PENDING}' AND created_at <= datetime('now', '-1 day')`
		);

		return {
			scope: "global",
			total: totalCountRow?.count ?? 0,
			avgImportance: (avgImportanceRow?.avg ?? 0).toFixed(1),
			totalHitCount: totalHitCountRow?.count ?? 0,
			expiringSoon: expiringSoonRow?.count ?? 0,
			byType,
			taskStats: this.buildTaskStats(taskRows),
			repoCount: repos.length,
			activeRepoCount: repos.filter(
				(repo) => repo.inProgressCount > 0 || repo.pendingCount > 0 || repo.blockedCount > 0
			).length,
			coordination: {
				activeClaims: activeClaimsRow?.count ?? 0,
				agentsClaiming: agentsClaimingRow?.count ?? 0,
				pendingHandoffs: pendingHandoffsRow?.count ?? 0,
				unassignedHandoffs: unassignedHandoffsRow?.count ?? 0,
				staleClaims: staleClaimsRow?.count ?? 0,
				staleHandoffs: staleHandoffsRow?.count ?? 0
			},
			repos
		};
	}

	getGlobalStats(): { totalMemories: number; totalTasks: number; totalRepos: number } {
		const totalMemoriesRow = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM ${TABLE_MEMORIES}`);
		const totalTasksRow = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM ${TABLE_TASKS}`);
		const totalRepos = this.listRepos().length;

		return {
			totalMemories: totalMemoriesRow?.count ?? 0,
			totalTasks: totalTasksRow?.count ?? 0,
			totalRepos
		};
	}

	getRepoDetails(
		owner: string,
		repo: string
	): { repo: string; memoryCount: number; taskCount: number; languages: string[] } {
		const memoryCountRow = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM ${TABLE_MEMORIES} WHERE owner = ? AND repo = ?`,
			[owner, repo]
		);
		const taskCountRow = this.get<{ count: number }>(
			`SELECT COUNT(*) as count FROM ${TABLE_TASKS} WHERE owner = ? AND repo = ?`,
			[owner, repo]
		);
		const languagesRows = this.all<{ language: string }>(
			`SELECT DISTINCT language FROM ${TABLE_MEMORIES} WHERE owner = ? AND repo = ? AND language IS NOT NULL`,
			[owner, repo]
		);
		const languages = languagesRows.map((r) => r.language);

		return {
			repo,
			memoryCount: memoryCountRow?.count ?? 0,
			taskCount: taskCountRow?.count ?? 0,
			languages
		};
	}
}
