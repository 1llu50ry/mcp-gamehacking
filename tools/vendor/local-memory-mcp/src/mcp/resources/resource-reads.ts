/**
 * MCP resource read dispatcher (TASK-558 split).
 *
 * Extracted from resources/index.ts: `readResource` handles every concrete
 * resource URI family (static index/roots, memory/task/action details,
 * repository-scoped collections and the codebase:// family) and builds the
 * MCP contents envelope. Catalog listing/templates/completion live in
 * resource-catalog.ts; envelope/pagination/error helpers in resource-helpers.ts.
 */

import type { SQLiteStore } from "../storage/sqlite";
import type { SessionContext } from "../session";
import { logger } from "../utils/logger";
import { parseRepoInput } from "../utils/normalize";
import { readCodebaseResource } from "./codebase";
import type { MemoryEntry, Task, MemoryType } from "../types";
import {
	type ResourceReadResult,
	parseRepoUri,
	deriveLastModifiedFromCollection,
	resourceNotFound
} from "./resource-helpers";

/** Read a resource URI into the MCP resource.read contents envelope. */
export function readResource(uri: string, db: SQLiteStore, session?: SessionContext): ResourceReadResult {
	logger.info("[Tool] resource.read", { uri });

	// 1. Repository Index
	if (uri === "repository://index") {
		const repos = db.system.listRepoNavigation();
		const payload = JSON.stringify(repos, null, 2);
		return {
			contents: [
				{
					uri,
					mimeType: "application/json",
					text: payload,
					size: Buffer.byteLength(payload, "utf8"),
					annotations: {
						audience: ["assistant"],
						priority: 1,
						lastModified: new Date().toISOString()
					}
				}
			]
		};
	}

	// 2. Session Roots
	if (uri === "session://roots") {
		const payload = JSON.stringify({ roots: session?.roots ?? [] }, null, 2);
		return {
			contents: [
				{
					uri,
					mimeType: "application/json",
					text: payload,
					size: Buffer.byteLength(payload, "utf8"),
					annotations: {
						audience: ["assistant"],
						priority: 0.95,
						lastModified: new Date().toISOString()
					}
				}
			]
		};
	}

	// 3. Memory Detail: memory://{id}
	const memoryIdMatch = uri.match(/^memory:\/\/([0-9a-f-]{36})$/i);
	if (memoryIdMatch) {
		const id = memoryIdMatch[1];
		// TASK-209: the dashboard GET hides archived by default, but this
		// by-id MCP resource must keep serving soft-archived memories (restore
		// path) — opt in explicitly.
		const entry = db.memories.getByIdWithStats(id, true);
		if (!entry) throw resourceNotFound(`Memory with ID ${id} not found.`, uri);

		const payload = JSON.stringify(entry, null, 2);
		return {
			contents: [
				{
					uri,
					mimeType: "application/json",
					text: payload,
					size: Buffer.byteLength(payload, "utf8"),
					annotations: {
						audience: ["assistant"],
						priority: 0.75,
						lastModified: entry.updated_at || entry.created_at
					}
				}
			]
		};
	}

	// 4. Task Detail: task://{id}
	const taskIdMatch = uri.match(/^task:\/\/([0-9a-f-]{36})$/i);
	if (taskIdMatch) {
		const id = taskIdMatch[1];
		const task = db.tasks.getTaskById(id);
		if (!task) throw resourceNotFound(`Task with ID ${id} not found.`, uri);

		const payload = JSON.stringify(task, null, 2);
		return {
			contents: [
				{
					uri,
					mimeType: "application/json",
					text: payload,
					size: Buffer.byteLength(payload, "utf8"),
					annotations: {
						audience: ["assistant"],
						priority: 0.8,
						lastModified: task.updated_at || task.created_at
					}
				}
			]
		};
	}

	// 5. Repository-scoped resources: repository://{name}/...
	const repoBase = parseRepoUri(uri);
	if (repoBase) {
		const { name, path: repoPath, query } = repoBase;

		// 5a. Repository Summary: repository://{name}/summary
		if (repoPath === "summary") {
			const summary = db.summaries.getSummary("", name);
			const text = summary?.summary || `No summary available for repository: ${name}`;
			return {
				contents: [
					{
						uri,
						mimeType: "text/plain",
						text,
						size: Buffer.byteLength(text, "utf8"),
						annotations: {
							audience: ["assistant"],
							priority: 0.95,
							lastModified: summary?.updated_at || new Date().toISOString()
						}
					}
				]
			};
		}

		// 5b. Repository Memories: repository://{name}/memories[?...]
		if (repoPath === "memories") {
			const search = query.get("search") || "";
			const type = query.get("type");
			const tag = query.get("tag");

			const result = db.memories.listMemoriesForDashboard({
				repo: name,
				type: (type as MemoryType) || undefined,
				tag: tag || undefined,
				search: search || undefined,
				limit: 50
			});
			const entries = result.items;

			const payload = JSON.stringify(entries, null, 2);
			return {
				contents: [
					{
						uri,
						mimeType: "application/json",
						text: payload,
						size: Buffer.byteLength(payload, "utf8"),
						annotations: {
							audience: ["assistant"],
							priority: 0.85,
							lastModified: deriveLastModifiedFromCollection(
								entries.map((e: MemoryEntry) => e.updated_at || e.created_at)
							)
						}
					}
				]
			};
		}

		// 5c. Repository Tasks: repository://{name}/tasks[?...]
		if (repoPath === "tasks") {
			const status = query.get("status");
			const priority = query.get("priority");
			const owner = parseRepoInput(name).owner;

			let tasks: Task[];
			if (status && status !== "all") {
				const statuses = status.split(",").map((s) => s.trim());
				tasks = db.tasks.getTasksByMultipleStatuses(owner, name, statuses);
			} else {
				tasks = db.tasks.getTasksByMultipleStatuses(owner, name, ["backlog", "pending", "in_progress", "blocked"]);
			}

			if (priority) {
				const p = Number(priority);
				if (!isNaN(p)) {
					tasks = tasks.filter((t: Task) => t.priority === p);
				}
			}

			const payload = JSON.stringify(tasks, null, 2);
			return {
				contents: [
					{
						uri,
						mimeType: "application/json",
						text: payload,
						size: Buffer.byteLength(payload, "utf8"),
						annotations: {
							audience: ["assistant"],
							priority: 0.9,
							lastModified: deriveLastModifiedFromCollection(tasks.map((t: Task) => t.updated_at))
						}
					}
				]
			};
		}

		// 5d. Repository Actions: repository://{name}/actions
		if (repoPath === "actions") {
			const actions = db.actions.getRecentActions("", name, 100);
			const payload = JSON.stringify(actions, null, 2);
			return {
				contents: [
					{
						uri,
						mimeType: "application/json",
						text: payload,
						size: Buffer.byteLength(payload, "utf8"),
						annotations: {
							audience: ["assistant"],
							priority: 0.6,
							lastModified: deriveLastModifiedFromCollection(actions.map((a) => a.created_at))
						}
					}
				]
			};
		}
	}

	// 5e. Codebase resources: codebase://{repo}/... (RS-1/TASK-323).
	// Dispatches to the shared codebase resource reader (symbols list /
	// symbol detail / file landmark). RecoverableError when the repo is not
	// indexed; -32002 for unknown URIs / missing symbols / unindexed files.
	if (uri.startsWith("codebase://")) {
		return readCodebaseResource(uri, db);
	}

	// 6. Action Detail: action://{id}  (integer ID from audit log)
	const actionIdMatch = uri.match(/^action:\/\/(\d+)$/);
	if (actionIdMatch) {
		const id = Number(actionIdMatch[1]);
		const action = db.actions.getActionById(id);
		if (!action) throw resourceNotFound(`Action with ID ${id} not found.`, uri);

		const payload = JSON.stringify(action, null, 2);
		return {
			contents: [
				{
					uri,
					mimeType: "application/json",
					text: payload,
					size: Buffer.byteLength(payload, "utf8"),
					annotations: {
						audience: ["assistant"],
						priority: 0.55,
						lastModified: action.created_at
					}
				}
			]
		};
	}

	throw resourceNotFound(`Unknown resource URI: ${uri}`, uri);
}
