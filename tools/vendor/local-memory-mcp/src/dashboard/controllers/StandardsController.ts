import express from "express";
import { jsonApiRes, handleController, HttpError, parsePageParams, getAttributes } from "../lib/jsonApi";
import { StandardsService, standardsFromImportPayload } from "../services/standards.service";

/**
 * Thin request/response adapter for coding standards endpoints.
 * Business logic delegated to StandardsService.
 */
export class StandardsController {
	static async list(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const { repo, query, language, stack, tags, is_global } = req.query;
			const { page, pageSize, offset } = parsePageParams(req.query, { defaultPageSize: 100 });

			const stackList =
				typeof stack === "string"
					? stack
							.split(",")
							.map((item) => item.trim())
							.filter(Boolean)
					: [];
			const tagList =
				typeof tags === "string"
					? tags
							.split(",")
							.map((item) => item.trim())
							.filter(Boolean)
					: [];

			const result = StandardsService.list({
				query: query as string | undefined,
				language: language as string | undefined,
				stack: stackList,
				tags: tagList,
				repo: repo as string | undefined,
				is_global: is_global === undefined ? undefined : String(is_global) === "true",
				limit: pageSize,
				offset
			});

			return jsonApiRes(result.items, "standard", {
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
		await handleController(req, res, () => {
			const standard = StandardsService.getById(req.params.id as string);
			if (!standard) throw new HttpError(404, "Coding standard not found");
			return jsonApiRes(standard, "standard");
		});
	}

	static async export(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const { repo, scope = "repo" } = req.query;
			const payload = StandardsService.exportStandards(repo as string | undefined, scope as string);
			return jsonApiRes(payload, "standard-export");
		});
	}

	static async import(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const rawStandards = standardsFromImportPayload(req.body);
			if (rawStandards.length === 0) {
				throw new HttpError(400, "No standards found in import payload");
			}

			const shouldRefresh =
				req.body && typeof req.body === "object" && "refresh_vectors" in req.body
					? (req.body as { refresh_vectors?: unknown }).refresh_vectors === true
					: undefined;

			const result = await StandardsService.importStandards(rawStandards, shouldRefresh);

			return jsonApiRes(
				{
					imported: result.imported.length,
					updated: result.updated.length,
					total: result.total,
					vectors_refreshed: result.vectors_refreshed,
					vector_failures: result.vector_failures,
					ids: [...result.imported, ...result.updated]
				},
				"standard-import"
			);
		});
	}

	static async create(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const attributes = getAttributes(req);
			const { title, content, tags, metadata } = attributes;
			if (!title || !content || !Array.isArray(tags) || tags.length === 0 || !metadata) {
				throw new HttpError(400, "Required fields missing");
			}

			const entry = await StandardsService.create(attributes);
			return jsonApiRes(entry, "standard");
		});
	}

	static async update(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			if (!StandardsService.exists(req.params.id as string)) throw new HttpError(404, "Coding standard not found");

			const attributes = getAttributes(req);
			const updates: Record<string, unknown> = {};
			if (attributes.title !== undefined) updates.title = attributes.title;
			if (attributes.content !== undefined) updates.content = attributes.content;
			if (attributes.parent_id !== undefined)
				updates.parent_id = attributes.parent_id === null ? null : attributes.parent_id;
			if (attributes.context !== undefined) updates.context = attributes.context;
			if (attributes.version !== undefined) updates.version = attributes.version;
			if (attributes.language !== undefined) updates.language = attributes.language || null;
			if (Array.isArray(attributes.stack)) updates.stack = attributes.stack;
			if (typeof attributes.is_global === "boolean") updates.is_global = attributes.is_global;
			if (attributes.repo !== undefined) updates.repo = attributes.repo;
			if (Array.isArray(attributes.tags)) updates.tags = attributes.tags;
			if (attributes.metadata !== undefined) updates.metadata = attributes.metadata;
			if (attributes.agent !== undefined) updates.agent = attributes.agent;
			if (attributes.model !== undefined) updates.model = attributes.model;

			await StandardsService.update(req.params.id as string, updates);
			return jsonApiRes({ message: "Updated" }, "status");
		});
	}

	static async bulkAction(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { action, ids, updates } = getAttributes(req);
			if (!Array.isArray(ids) || !action)
				throw new HttpError(400, "Invalid payload: requires 'ids' array and 'action'");

			const count = await StandardsService.bulkAction(action, ids, updates);
			return jsonApiRes({ count }, "status");
		});
	}

	static async delete(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			if (!StandardsService.exists(req.params.id as string)) throw new HttpError(404, "Coding standard not found");

			await StandardsService.delete(req.params.id as string);
			return jsonApiRes({ message: "Deleted" }, "status");
		});
	}
}
