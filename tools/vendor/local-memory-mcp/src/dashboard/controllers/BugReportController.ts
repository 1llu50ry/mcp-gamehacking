import express from "express";
import { jsonApiRes, handleController, HttpError } from "../lib/jsonApi";
import { BugReportService } from "../services/bug-report.service";

/**
 * Thin request/response adapter for locally captured bug reports.
 * Business logic delegated to BugReportService.
 */
export class BugReportController {
	static async list(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const includeResolved = req.query.includeResolved === "true";
			const source = req.query.source as string | undefined;
			const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 50));
			const offset = Math.max(0, Number(req.query.offset) || 0);
			return jsonApiRes(BugReportService.list(includeResolved, source, limit, offset), "bug-report");
		});
	}

	static async stats(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			return jsonApiRes(BugReportService.stats(), "bug-report-stats");
		});
	}

	static async get(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const id = Number(req.params.id);
			if (!Number.isInteger(id)) throw new HttpError(400, "id must be an integer");
			const report = BugReportService.get(id);
			if (!report) throw new HttpError(404, "bug report not found");
			return jsonApiRes(report, "bug-report");
		});
	}

	static async resolve(req: express.Request, res: express.Response) {
		await handleController(req, res, () => {
			const id = Number(req.params.id);
			if (!Number.isInteger(id)) throw new HttpError(400, "id must be an integer");
			const changed = BugReportService.resolve(id);
			return jsonApiRes({ id, resolved: changed }, "bug-report");
		});
	}
}
