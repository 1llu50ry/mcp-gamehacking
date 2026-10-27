import express from "express";
import { jsonApiRes, handleController, HttpError, parsePageParams, getAttributes } from "../lib/jsonApi";
import { parseRepoInput } from "../../mcp/utils/normalize";
import { SystemService } from "../services/system.service";

/**
 * Thin request/response adapter for system endpoints.
 * Business logic delegated to SystemService (incl. the repo-scoped stats
 * TTL cache — OPT-PERF-06 / TASK-202, reused from services/statsCache).
 */
export class SystemController {
	static async getHealth(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			return jsonApiRes(SystemService.getHealth(), "health");
		});
	}

	static async getRepos(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			return jsonApiRes(SystemService.getRepos(), "repository");
		});
	}

	static async getStats(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const repo = req.query.repo as string | undefined;
			let owner = req.query.owner as string | undefined;
			if (!owner && repo && repo.includes("/")) {
				const parsed = parseRepoInput(repo, undefined);
				owner = parsed.owner;
			}
			return jsonApiRes(SystemService.getStats(repo, owner), "system-stats");
		});
	}

	/**
	 * Runtime metrics (OPT-OBS-01): purely observational — no DB access, so
	 * the standard `db.refresh()` lifecycle is skipped to keep
	 * high-frequency polling cheap.
	 */
	static async getMetrics(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			() => {
				const repoInput = req.query.repo as string | undefined;
				let owner = req.query.owner as string | undefined;
				let repo = repoInput;
				if (!owner && repoInput?.includes("/")) {
					const parsed = parseRepoInput(repoInput, undefined);
					owner = parsed.owner;
					repo = parsed.repo;
				}
				const hours = Math.max(1, Math.min(24 * 90, Number(req.query.hours) || 24));
				return jsonApiRes(SystemService.getMetrics(owner, repo, hours), "system-metrics");
			},
			{ refresh: false }
		);
	}

	static async getRecentActions(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const repo = req.query.repo as string | undefined;
			const { page, pageSize, offset } = parsePageParams(req.query, { defaultPageSize: 10 });
			const result = SystemService.getRecentActions(repo, pageSize, offset);
			return jsonApiRes(result.items, "recent-action", {
				meta: { page, pageSize, totalItems: result.totalItems }
			});
		});
	}

	static getCapabilities(req: express.Request, res: express.Response) {
		res.json(jsonApiRes(SystemService.getCapabilities(), "capability"));
	}

	static async getExport(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const repo = req.query.repo as string;
			if (!repo) throw new HttpError(400, "repo is required");

			let owner = req.query.owner as string | undefined;
			if (!owner && repo.includes("/")) {
				const parsed = parseRepoInput(repo, undefined);
				owner = parsed.owner;
			}
			if (!owner) throw new HttpError(400, "owner is required when repo is not in owner/repo format");

			// Streaming endpoint: the service writes the JSON body chunk-by-chunk.
			await SystemService.streamExport(repo, owner, res);
		});
	}

	static async callTool(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { name } = req.params as { name: string };
			const args = getAttributes(req) as Record<string, unknown>;

			const result = await SystemService.callTool(name, args);
			return jsonApiRes(result, "tool-result");
		});
	}
}
