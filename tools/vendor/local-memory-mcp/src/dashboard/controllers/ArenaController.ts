import express from "express";
import { jsonApiRes, handleController } from "../lib/jsonApi";
import { ArenaService } from "../services/arena.service";

/**
 * Thin request/response adapter for the dashboard arena-overview endpoint.
 * Business logic delegated to ArenaService (incl. the short TTL cache).
 *
 * TASK-269 / audit F7: a single aggregate endpoint replaces the ~300-request
 * per-repo fan-out the arena used to fire on first load.
 */
export class ArenaController {
	static async getOverview(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			return jsonApiRes({ id: "arena-overview", ...ArenaService.getOverview() }, "arena-overview");
		});
	}
}
