import express from "express";
import { jsonApiRes, handleController } from "../lib/jsonApi";
import { UnifiedGraphService } from "../services/unified-graph.service";

/**
 * Thin request/response adapter for the unified-graph endpoint.
 * Business logic delegated to UnifiedGraphService (owner/repo resolution,
 * per-domain node/edge assembly, stats).
 */
export class UnifiedGraphController {
	static async getGraph(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const rawRepo = req.query.repo as string | undefined;
			const owner = req.query.owner as string | undefined;
			const domains = ((req.query.domains as string) || "memory,codebase,task,entity").split(",");
			const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
			const minImportance = parseInt(req.query.minImportance as string) || 1;

			const result = UnifiedGraphService.getGraph({ repo: rawRepo, owner, domains, limit, minImportance });

			return jsonApiRes(result, "unified-graph");
		});
	}
}
