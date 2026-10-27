import express from "express";
import { jsonApiRes, handleController, HttpError, parsePageParams, getAttributes } from "../lib/jsonApi";
import { MemoryService } from "../services/memory.service";
import type { MemoryType } from "../../mcp/types";
import type { IdParams, MemoryListQuery } from "../../mcp/interfaces";

/**
 * Thin request/response adapter for memory endpoints.
 * Business logic delegated to MemoryService.
 */
export class MemoriesController {
	static async list(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const query = req.query as unknown as MemoryListQuery;
			const { repo, type, search, minImportance, maxImportance, sortBy, sortOrder } = query;
			const { page, pageSize, offset } = parsePageParams(req.query, { defaultPageSize: 25 });

			if (!repo) throw new HttpError(400, "repo is required");

			// Soft-delete status scoping (TASK-209): archived memories are hidden
			// by default; `?includeArchived=true` opts into showing them.
			const includeArchived = req.query.includeArchived === "true";

			const result = MemoryService.list({
				repo: repo as string,
				type: type as MemoryType,
				search,
				minImportance,
				maxImportance,
				sortBy,
				sortOrder,
				includeArchived,
				limit: pageSize,
				offset
			});

			return jsonApiRes(result.items, "memory", {
				meta: {
					page,
					pageSize,
					totalItems: result.total,
					totalPages: Math.ceil(result.total / pageSize)
				}
			});
		});
	}

	static async get(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			// TASK-209: archived memories 404 by default; `?includeArchived=true`
			// restores read access (restore path after soft-archive delete).
			const includeArchived = req.query.includeArchived === "true";
			const memory = MemoryService.getById(req.params.id as string, includeArchived);
			if (!memory) throw new HttpError(404, "Memory not found");
			return jsonApiRes(memory, "memory");
		});
	}

	static async create(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const attributes = getAttributes(req);
			const { repo, type, content } = attributes;
			if (!repo || !type || !content) throw new HttpError(400, "Required fields missing");

			const id = await MemoryService.create(attributes);
			return jsonApiRes({ id }, "memory");
		});
	}

	static async update(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { id } = req.params as unknown as IdParams;
			if (!MemoryService.exists(id)) throw new HttpError(404, "Memory not found");

			const attributes = getAttributes(req);
			await MemoryService.update(id, attributes);
			return jsonApiRes({ message: "Updated" }, "status");
		});
	}

	static async delete(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { id } = req.params as unknown as IdParams;
			if (!MemoryService.exists(id)) throw new HttpError(404, "Memory not found");

			await MemoryService.delete(id);
			return jsonApiRes({ message: "Deleted" }, "status");
		});
	}

	static async bulkCreate(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { items, repo } = getAttributes(req);
			if (!Array.isArray(items) || !repo)
				throw new HttpError(400, "Invalid payload: requires 'items' array and 'repo'");

			const count = await MemoryService.bulkCreate(items, repo);
			return jsonApiRes({ count }, "status");
		});
	}

	static async bulkAction(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { action, ids, updates } = getAttributes(req);
			if (!Array.isArray(ids) || !action)
				throw new HttpError(400, "Invalid payload: requires 'ids' array and 'action'");

			const count = await MemoryService.bulkAction(action, ids, updates);
			return jsonApiRes({ count }, "status");
		});
	}
}
