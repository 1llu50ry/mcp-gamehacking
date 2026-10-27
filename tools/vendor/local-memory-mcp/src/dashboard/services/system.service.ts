import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Response } from "express";
import { db, mcpClient, startTime, embeddingWorker } from "../lib/context";
import { metrics } from "../../mcp/utils/metrics";
import { condenseRecentActions, type CondensedRecentAction } from "../lib/helpers";
import type { RecentAction } from "../lib/interfaces";
import { getCachedRepoStats, setCachedRepoStats } from "./statsCache";
import { TOOL_DEFINITIONS } from "../../mcp/types/tool-definitions";
import { listResources } from "../../mcp/resources";
import { PROMPTS } from "../../mcp/prompts/registry";
import { getRuntimeCapabilities, type RuntimeCapabilitySnapshot } from "../../mcp/runtime-capabilities";
import { reuseTelemetry } from "../../mcp/utils/reuse-telemetry";
import { formatBuildInfo, getBuildInfo } from "../../mcp/utils/build-info";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * System-level service layer.
 *
 * Owns ALL db.* access for the dashboard system endpoints (health, repos,
 * stats, recent actions, export streaming), the repo-scoped stats TTL cache
 * (OPT-PERF-06 / TASK-202 — reused, never duplicated), runtime metrics, and
 * MCP tool delegation. Controllers delegate here instead of touching `db`
 * directly.
 */

// Package version: robustly found by walking up from __dirname. Resolved once
// at module load (byte-identical to the previous controller-level lookup).
const pkg = { version: "0.0.0" };

try {
	let currentDir = __dirname;
	let pkgPath = "";
	while (currentDir !== path.parse(currentDir).root) {
		const checkPath = path.join(currentDir, "package.json");
		if (fs.existsSync(checkPath)) {
			pkgPath = checkPath;
			break;
		}
		currentDir = path.dirname(currentDir);
	}

	if (pkgPath) {
		const data = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
		if (data.version) pkg.version = data.version;
	}
} catch {
	// Intentionally empty: package.json might not exist in dev or some environments
}

export interface SystemHealth {
	connected: boolean;
	uptime: number;
	version: string;
	memoryCount: number;
	repoCount: number;
	pendingRequests: number;
	dbPath: string;
	/**
	 * Running build identity (PERF-009), e.g. `0.48.1+d8dd97a [stamp built …]`.
	 * Distinct from {@link version} (the package version only): this also
	 * carries the git SHA + resolution source, so an operator comparing the
	 * daemon against the expected build sees a mismatch directly.
	 */
	build: string;
}

export interface RecentActionsResult {
	items: CondensedRecentAction[];
	totalItems: number;
}

export interface CapabilitySet {
	tools: Array<Record<string, unknown>>;
	resources: Array<Record<string, unknown>>;
	prompts: Array<Record<string, unknown>>;
	runtime: RuntimeCapabilitySnapshot;
}

export const SystemService = {
	getHealth(): SystemHealth {
		const stats = db.system.getGlobalStats();
		return {
			connected: mcpClient.isConnected(),
			uptime: Math.floor((Date.now() - startTime) / 1000),
			version: pkg.version,
			memoryCount: stats.totalMemories,
			repoCount: stats.totalRepos,
			pendingRequests: mcpClient.getPendingCount(),
			dbPath: db.getDbPath(),
			// PERF-009: expose the running build identity so a stale daemon is
			// detectable from `/api/health` without reading the log file.
			build: formatBuildInfo(getBuildInfo())
		};
	},

	getRepos(): Array<{ id: string; name: string } & Record<string, unknown>> {
		const repos = db.system.listRepoNavigation();
		return repos.map((r) => ({ id: r.repo, name: r.repo, ...r }));
	},

	/**
	 * Repo-scoped stats run 16+ aggregate queries (OPT-PERF-06 / TASK-202).
	 * Serve from the TTL cache (statsCache.ts) when warm; the global path is
	 * already cached inside the entity. Shape is identical either way.
	 */
	getStats(repo: string | undefined, owner: string | undefined) {
		if (repo) {
			const cached = getCachedRepoStats<ReturnType<typeof db.system.getDashboardStats>>(owner || "", repo);
			if (cached) return cached;
			const stats = db.system.getDashboardStats(owner || "", repo);
			return setCachedRepoStats(owner || "", repo, stats);
		}
		return db.system.getGlobalDashboardStats();
	},

	/**
	 * Runtime metrics (OPT-OBS-01): in-memory dispatch + worker latency
	 * distributions merged with the embedding worker snapshot. Purely
	 * observational — no DB access, so callers skip the `db.refresh()`
	 * lifecycle to keep high-frequency polling cheap.
	 */
	getMetrics(owner?: string, repo?: string, hours = 24): Record<string, unknown> {
		const snapshot = metrics.snapshot();
		const worker = embeddingWorker.getStats();
		if (owner && repo && reuseTelemetry.isEnabled()) reuseTelemetry.flush(db);
		const reuse = owner && repo && reuseTelemetry.isEnabled() ? db.reuseTelemetry.summarize(owner, repo, hours) : null;
		return {
			// NIT (OPT-OBS-01): explicit process marker so consumers can
			// distinguish empty-by-design (tools/writeHandler are always empty
			// in the dashboard process — dispatch timings live in the MCP
			// child process) from empty-by-no-traffic.
			process: "dashboard",
			uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
			pid: process.pid,
			tools: snapshot.tools,
			toolOutcomes: snapshot.toolOutcomes,
			writeHandler: snapshot.writeHandler,
			embedLatency: snapshot.embedLatency,
			// FIX-034: discrete startup-event counters (semantic warm-up /
			// auto-index failures) so a degraded-but-ready boot is observable.
			counters: snapshot.counters,
			worker,
			reuse
		};
	},

	getRecentActions(repo: string | undefined, pageSize: number, offset: number): RecentActionsResult {
		const rawActions = db.actions.getRecentActions("", repo, 100);
		// Map ActionLogRow to RecentAction (fixing query null vs undefined)
		const actions: RecentAction[] = rawActions.map((a) => ({
			...a,
			query: a.query || undefined,
			response: a.response || undefined,
			memory_id: a.memory_id || undefined,
			task_id: a.task_id || undefined,
			memory_title: a.memory_title || undefined,
			memory_type: a.memory_type || undefined
		}));
		const allCondensed = condenseRecentActions(actions, 100);
		return {
			items: allCondensed.slice(offset, offset + pageSize),
			totalItems: allCondensed.length
		};
	},

	getCapabilities(): CapabilitySet {
		const canonical = (tool: { title?: string; description?: string }) =>
			!tool.title?.includes("(Deprecated)") && !tool.description?.startsWith("DEPRECATED");
		const tools = (TOOL_DEFINITIONS || []).filter(canonical).map((tool) => ({
			type: "tool",
			id: tool.name,
			attributes: tool
		}));
		const resourceList = listResources();
		const resources = ((resourceList.resources as Record<string, unknown>[]) || []).map((resource) => ({
			type: "resource",
			id: resource.uri as string,
			attributes: resource
		}));
		const prompts = (Object.values(PROMPTS) || []).map((prompt) => ({
			type: "prompt",
			id: prompt.name,
			attributes: prompt
		}));
		return { tools, resources, prompts, runtime: getRuntimeCapabilities().snapshot() };
	},

	/** Streams a full owner/repo export (memories → tasks → comments). */
	async streamExport(repo: string, owner: string, res: Response): Promise<void> {
		const PAGE_SIZE = 500;

		res.setHeader("Content-Type", "application/json");
		res.write(
			`{\n  "data": {\n    "type": "export",\n    "id": "export-${repo}",\n    "attributes": {\n      "repo": ${JSON.stringify(repo)},\n      "exported_at": ${JSON.stringify(new Date().toISOString())},\n      "memories": [\n`
		);

		let offset = 0;
		let first = true;

		while (true) {
			const page = db.memories.getAllMemoriesWithStats(owner, repo, PAGE_SIZE, offset);
			if (page.length === 0) break;
			for (const mem of page) {
				if (!first) res.write(",\n");
				res.write(JSON.stringify(mem));
				first = false;
			}
			offset += PAGE_SIZE;
			await new Promise((r) => setImmediate(r));
		}

		res.write(`\n      ],\n      "tasks": [\n`);
		offset = 0;
		first = true;

		while (true) {
			const page = db.tasks.getTasksByRepo(owner, repo, undefined, PAGE_SIZE, offset);
			if (page.length === 0) break;
			for (const task of page) {
				if (!first) res.write(",\n");
				res.write(JSON.stringify(task));
				first = false;
			}
			offset += PAGE_SIZE;
			await new Promise((r) => setImmediate(r));
		}

		res.write(`\n      ],\n      "comments": [\n`);
		offset = 0;
		first = true;

		while (true) {
			const page = db.taskComments.getAllTaskCommentsByRepo(owner, repo, PAGE_SIZE, offset);
			if (page.length === 0) break;
			for (const comment of page) {
				if (!first) res.write(",\n");
				res.write(JSON.stringify(comment));
				first = false;
			}
			offset += PAGE_SIZE;
			await new Promise((r) => setImmediate(r));
		}

		res.write(`\n      ]\n    }\n  }\n}\n`);
		res.end();
	},

	/** Delegates a raw MCP tool call through the client. */
	async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
		if (!mcpClient.isConnected()) await mcpClient.start();
		return mcpClient.callTool(name, args);
	}
};
