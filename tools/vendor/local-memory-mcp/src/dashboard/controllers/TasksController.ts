import express from "express";
import { jsonApiRes, handleController, HttpError, parsePageParams, getAttributes } from "../lib/jsonApi";
import { TaskService } from "../services/task.service";
import type { IdParams } from "../../mcp/interfaces";

/**
 * Thin request/response adapter for task endpoints.
 * Business logic delegated to TaskService.
 */
export class TasksController {
	static async list(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { repo, status, search } = req.query;
			const { page, pageSize, offset } = parsePageParams(req.query, { defaultPageSize: 20 });

			if (!repo) throw new HttpError(400, "repo is required");

			const result = TaskService.list({
				repo: repo as string,
				status: status as string,
				search: search as string,
				limit: pageSize,
				offset
			});

			const totalPages = Math.ceil(result.totalItems / pageSize);

			return jsonApiRes(result.tasks, "task", {
				meta: { page, pageSize, totalItems: result.totalItems, totalPages }
			});
		});
	}

	static async get(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const task = TaskService.getById(req.params.id as string);
			if (!task) throw new HttpError(404, "Task not found");
			return jsonApiRes(task, "task");
		});
	}

	static async getByCode(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { repo, task_code } = req.query;
			if (!repo || !task_code) throw new HttpError(400, "repo and task_code are required");
			const task = TaskService.getByCode(repo as string, task_code as string);
			if (!task) throw new HttpError(404, "Task not found");
			return jsonApiRes(task, "task");
		});
	}

	static async create(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const attributes = getAttributes(req);
			const { repo, task_code, title } = attributes;
			if (!repo || !task_code || !title) throw new HttpError(400, "Required fields missing");

			const id = await TaskService.create(attributes);
			return jsonApiRes({ id }, "task");
		});
	}

	static async update(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { id } = req.params as unknown as IdParams;
			const attributes = getAttributes(req);
			const updatedTask = await TaskService.update(id, attributes);
			return jsonApiRes(updatedTask, "task");
		});
	}

	static async delete(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { id } = req.params as unknown as IdParams;
			await TaskService.delete(id);
			return jsonApiRes({ message: "Deleted" }, "status");
		});
	}

	static async bulkCreate(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { items, repo } = getAttributes(req);
			if (!Array.isArray(items) || !repo)
				throw new HttpError(400, "Invalid payload: requires 'items' array and 'repo'");

			const count = await TaskService.bulkCreate(items, repo);
			return jsonApiRes({ count }, "status");
		});
	}

	static async bulkAction(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { action, ids, updates } = getAttributes(req);
			if (!Array.isArray(ids) || !action)
				throw new HttpError(400, "Invalid payload: requires 'ids' array and 'action'");

			const count = await TaskService.bulkAction(action, ids, updates);
			return jsonApiRes({ count }, "status");
		});
	}

	static async getTimeStats(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { repo } = req.query;
			const stats = TaskService.getTimeStats(repo as string | null);
			return jsonApiRes(stats, "performance-stats");
		});
	}

	static async updateComment(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { id } = req.params as unknown as IdParams;
			const { comment } = getAttributes(req);
			await TaskService.updateComment(id, comment);
			return jsonApiRes({ message: "Updated" }, "status");
		});
	}

	static async deleteComment(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const { id } = req.params as unknown as IdParams;
			await TaskService.deleteComment(id);
			return jsonApiRes({ message: "Deleted" }, "status");
		});
	}
}
