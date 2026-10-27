import express from "express";
import { jsonApiRes, handleController, HttpError, parsePageParams, getAttributes } from "../lib/jsonApi";
import { CoordinationService } from "../services/coordination.service";

/**
 * Thin request/response adapter for coordination endpoints.
 * Business logic delegated to CoordinationService.
 */
export class CoordinationController {
	static async listClaims(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const { repo, agent, active_only } = req.query;
			const { page, pageSize, offset } = parsePageParams(req.query, { defaultPageSize: 20 });

			if (!repo) throw new HttpError(400, "repo is required");

			const result = CoordinationService.listClaims({
				repo: repo as string,
				agent: typeof agent === "string" ? agent : undefined,
				active_only: active_only === undefined ? undefined : String(active_only) === "true",
				limit: pageSize,
				offset
			});

			return jsonApiRes(result.claims, "claim", {
				meta: {
					page,
					pageSize,
					totalItems: result.total,
					totalPages: Math.ceil(result.total / pageSize)
				}
			});
		});
	}

	static async releaseClaim(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const attributes = getAttributes(req);
				const result = await CoordinationService.releaseClaim(attributes);
				return jsonApiRes(result as Record<string, unknown>, "claim-release");
			},
			// No DB read before the MCP call — preserve the original handler's
			// behavior of skipping db.refresh().
			{ refresh: false }
		);
	}

	static async createHandoff(req: express.Request, res: express.Response) {
		await handleController(
			req,
			res,
			async () => {
				const attributes = getAttributes(req);
				const result = await CoordinationService.createHandoff(attributes);
				return jsonApiRes(result as Record<string, unknown>, "handoff-create");
			},
			{ refresh: false }
		);
	}

	static async listHandoffs(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const { repo, status, to_agent, from_agent } = req.query;
			const { page, pageSize, offset } = parsePageParams(req.query, { defaultPageSize: 50 });

			if (!repo) throw new HttpError(400, "repo is required");

			const result = CoordinationService.listHandoffs({
				repo: repo as string,
				status: status as import("../../mcp/types").Handoff["status"] | undefined,
				to_agent: typeof to_agent === "string" ? to_agent : undefined,
				from_agent: typeof from_agent === "string" ? from_agent : undefined,
				limit: pageSize,
				offset
			});

			return jsonApiRes(result.handoffs, "handoff", {
				meta: {
					page,
					pageSize,
					totalItems: result.total,
					totalPages: Math.ceil(result.total / pageSize)
				}
			});
		});
	}

	static async updateHandoffStatus(req: express.Request, res: express.Response) {
		await handleController(req, res, async () => {
			const attributes = getAttributes(req);
			const { id, status } = attributes as { id?: string; status?: string };

			if (!id) throw new HttpError(400, "id is required");
			if (!status) throw new HttpError(400, "status is required");

			const validStatuses = ["pending", "accepted", "rejected", "expired"] as const;
			if (!validStatuses.includes(status as (typeof validStatuses)[number])) {
				throw new HttpError(400, `Invalid status: ${status}. Must be one of: ${validStatuses.join(", ")}`);
			}

			const handoff = await CoordinationService.updateHandoffStatus(
				id,
				status as import("../../mcp/types").Handoff["status"]
			);
			if (!handoff) throw new HttpError(404, "Handoff not found");

			return jsonApiRes({ success: true, handoff }, "handoff-update");
		});
	}
}
