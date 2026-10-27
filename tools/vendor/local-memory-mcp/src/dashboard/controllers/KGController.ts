import express from "express";
import { jsonApiRes, handleController, HttpError, getAttributes, parsePageParams } from "../lib/jsonApi";
import { KgService } from "../services/kg.service";

/**
 * Thin request/response adapter for knowledge-graph endpoints.
 * Business logic delegated to KgService (incl. write-lock boundaries).
 */
export class KGController {
	static async listEntities(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const repo = req.query.repo as string;
			if (!repo) throw new HttpError(400, "repo is required");

			const type = req.query.type as string | undefined;
			const search = req.query.search as string | undefined;
			const { page, pageSize, offset } = parsePageParams(req.query);

			const result = KgService.listEntities(repo, type, search, pageSize, offset);

			return jsonApiRes(result.items, "entity", {
				meta: {
					page,
					pageSize,
					totalItems: result.total,
					totalPages: Math.ceil(result.total / pageSize)
				}
			});
		});
	}

	static async getEntity(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const name = req.params.name as string;
			const repo = req.query.repo as string;
			if (!repo) throw new HttpError(400, "repo is required");

			const result = KgService.getEntity(name, repo);
			return jsonApiRes(result, "entity");
		});
	}

	static async listRelations(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const repo = req.query.repo as string;
			if (!repo) throw new HttpError(400, "repo is required");

			const { page, pageSize, offset } = parsePageParams(req.query);

			const result = KgService.listRelations(repo, pageSize, offset);

			return jsonApiRes(result.items, "relation", {
				meta: {
					page,
					pageSize,
					totalItems: result.total,
					totalPages: Math.ceil(result.total / pageSize)
				}
			});
		});
	}

	static async listGraph(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const repo = req.query.repo as string;
			if (!repo) throw new HttpError(400, "repo is required");

			const { page, pageSize, offset } = parsePageParams(req.query);

			// `graphLimit` (TASK-212): optional top-N-by-degree view that
			// bypasses the pageSize clamp (max 100). Positive integer, clamped
			// to [100, 1000]. When absent the legacy page/pageSize paginated
			// behavior is unchanged (backward compat).
			let graphLimit: number | undefined;
			if (req.query.graphLimit !== undefined) {
				const raw = Number(req.query.graphLimit);
				if (!Number.isInteger(raw) || raw <= 0) {
					throw new HttpError(400, "graphLimit must be a positive integer");
				}
				graphLimit = Math.min(1000, Math.max(100, raw));
			}

			// Optional `includeEdges` query param (TASK-197): consumers that only
			// need the node set can skip the edge fetch + truncation probe entirely,
			// avoiding a payload of up to KG_MAX_GRAPH_EDGES (4000) edges per request.
			// Any value other than the exact string "false" → true (default true), so
			// absent/`true`/garbage all keep the current behavior. Nodes are unaffected:
			// degree is computed server-side via SQL CTE independent of this edge set.
			const includeEdges = (req.query.includeEdges as string | undefined) !== "false";

			const result = KgService.listGraph(repo, pageSize, offset, includeEdges, graphLimit);

			const effectiveTotal = graphLimit ?? pageSize;
			return jsonApiRes(result.data, "graph", {
				meta: {
					// graphLimit mode (TASK-216): an offset-0 top-N window, not a
					// paginated view — emitting page/pageSize (default 20) would
					// contradict graphLimit (e.g. 300). Omit them here; the legacy
					// paginated path (graphLimit absent) keeps page/pageSize.
					...(graphLimit === undefined ? { page, pageSize } : {}),
					...(graphLimit !== undefined ? { graphLimit } : {}),
					totalItems: result.totalItems,
					totalPages: Math.ceil(result.totalItems / effectiveTotal)
				}
			});
		});
	}

	static async createEntity(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const attributes = getAttributes(req);
			const { name, repo } = attributes;

			if (!name || !repo) throw new HttpError(400, "name and repo are required");

			const entity = await KgService.createEntity(attributes);
			return jsonApiRes(entity, "entity");
		});
	}

	static async deleteEntity(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const name = req.params.name as string;
			const repo = req.query.repo as string;
			if (!repo) throw new HttpError(400, "repo is required");

			const result = await KgService.deleteEntity(name, repo);
			return jsonApiRes(result, "status");
		});
	}

	static async createRelation(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const attributes = getAttributes(req);
			const { from_entity, to_entity, relation_type, repo } = attributes;

			if (!from_entity || !to_entity || !relation_type || !repo) {
				throw new HttpError(400, "from_entity, to_entity, relation_type, and repo are required");
			}

			const result = await KgService.createRelation(attributes);
			return jsonApiRes(result, "relation");
		});
	}

	static async deleteRelation(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const attributes = getAttributes(req);
			const { from_entity, to_entity, relation_type, repo } = attributes;

			if (!from_entity || !to_entity || !relation_type || !repo) {
				throw new HttpError(400, "from_entity, to_entity, relation_type, and repo are required");
			}

			const result = await KgService.deleteRelation(from_entity, to_entity, relation_type, repo);
			return jsonApiRes(result, "status");
		});
	}

	static async deleteObservation(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const id = req.params.id as string;

			const result = await KgService.deleteObservation(id);
			return jsonApiRes(result, "status");
		});
	}
}
