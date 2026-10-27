import { db } from "../lib/context";

/**
 * Dashboard read/curation surface for locally captured bug reports
 * (utils/bug-capture.ts). Read + resolve only — capture is automatic.
 */
export const BugReportService = {
	list(includeResolved = false, source?: string, limit = 50, offset = 0) {
		return db.bugReports.list({ includeResolved, source, limit, offset });
	},

	get(id: number) {
		return db.bugReports.getById(id);
	},

	resolve(id: number): boolean {
		return db.bugReports.resolve(id);
	},

	stats() {
		return db.bugReports.stats();
	}
};
