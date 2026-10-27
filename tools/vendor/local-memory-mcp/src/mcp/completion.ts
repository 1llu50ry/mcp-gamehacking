import fs from "fs";
import path from "path";
import { SQLiteStore } from "./storage/sqlite";
import { SessionContext, getFilesystemRoots, inferRepoFromSession } from "./session";
import { completePromptArgument } from "./prompts/registry";
import { completeResourceArgument } from "./resources";
import type { Task } from "./types";

export type CompletionRequest = {
	ref?: {
		type?: string;
		name?: string;
		uri?: string;
	};
	argument?: {
		name?: string;
		value?: string;
	};
	context?: {
		arguments?: Record<string, unknown>;
	};
};

const MAX_COMPLETION_VALUES = 100;
const MAX_FILE_SCAN_RESULTS = 300;

export async function complete(params: CompletionRequest, db: SQLiteStore, session?: SessionContext) {
	const refType = params?.ref?.type;
	const argumentName = typeof params?.argument?.name === "string" ? params.argument.name : "";
	const argumentValue = typeof params?.argument?.value === "string" ? params.argument.value : "";
	const contextArguments = params?.context?.arguments ?? {};

	if (!refType || !argumentName) {
		throw invalidCompletionParams("completion/complete requires ref.type and argument.name");
	}

	const dataSources = {
		repos: getSuggestedRepos(db, session),
		tags: getSuggestedTags(db),
		filePaths: getSuggestedFilePaths(session),
		tasks: getSuggestedTasks(db, session, contextArguments)
	};

	if (refType === "ref/prompt") {
		const promptName = typeof params?.ref?.name === "string" ? params.ref.name : "";
		if (!promptName) {
			throw invalidCompletionParams("Prompt completion requires ref.name");
		}

		return {
			completion: buildCompletionResult(
				await completePromptArgument(promptName, argumentName, argumentValue, contextArguments, dataSources)
			)
		};
	}

	if (refType === "ref/resource") {
		const resourceUri = typeof params?.ref?.uri === "string" ? params.ref.uri : "";
		if (!resourceUri) {
			throw invalidCompletionParams("Resource completion requires ref.uri");
		}

		return {
			completion: buildCompletionResult(
				completeResourceArgument(resourceUri, argumentName, argumentValue, contextArguments, dataSources)
			)
		};
	}

	throw invalidCompletionParams(`Unsupported completion ref type: ${refType}`);
}

function buildCompletionResult(values: string[]) {
	const capped = values.slice(0, MAX_COMPLETION_VALUES);
	return {
		values: capped,
		total: values.length,
		hasMore: values.length > capped.length
	};
}

function getSuggestedRepos(db: SQLiteStore, session?: SessionContext) {
	const values = new Set<string>();
	const inferredRepo = inferRepoFromSession(session);
	if (inferredRepo) values.add(inferredRepo);

	for (const rootPath of getFilesystemRoots(session)) {
		values.add(path.basename(rootPath));
	}

	for (const repo of db.system.listRepos()) {
		values.add(repo);
	}

	return [...values].sort((a, b) => a.localeCompare(b));
}

function getSuggestedTags(db: SQLiteStore) {
	const values = new Set<string>();
	// Memories search with stats not currently directly exposed, using getRecentMemories or similar
	// but for tags suggestion we just need a sample of tags.
	// Assuming system-wide stats or specific recently used tags.
	// For now matching the existing logic by delegating to memories.
	const memories = db.memories.getRecentMemories("", "", 1000);

	for (const memory of memories) {
		for (const tag of memory.tags || []) {
			if (typeof tag === "string" && tag.trim()) {
				values.add(tag.trim());
			}
		}
	}

	return [...values].sort((a, b) => a.localeCompare(b));
}

function getSuggestedTasks(
	db: SQLiteStore,
	session: SessionContext | undefined,
	contextArguments: Record<string, unknown>
) {
	const repo =
		typeof contextArguments.repo === "string" && contextArguments.repo.trim()
			? contextArguments.repo.trim()
			: inferRepoFromSession(session);

	if (!repo) return [];

	return db.tasks.getTasksByRepo("", repo, undefined, 100).map((task: Task) => ({
		id: task.id,
		task_code: task.task_code,
		title: task.title
	}));
}

function getSuggestedFilePaths(session?: SessionContext) {
	const roots = getFilesystemRoots(session);
	const results: string[] = [];

	for (const rootPath of roots) {
		collectFiles(rootPath, rootPath, results);
		if (results.length >= MAX_FILE_SCAN_RESULTS) break;
	}

	return results.sort((a, b) => a.localeCompare(b));
}

function collectFiles(rootPath: string, currentPath: string, results: string[]) {
	if (results.length >= MAX_FILE_SCAN_RESULTS) return;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(currentPath, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (results.length >= MAX_FILE_SCAN_RESULTS) return;
		if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;

		const fullPath = path.join(currentPath, entry.name);
		if (entry.isDirectory()) {
			collectFiles(rootPath, fullPath, results);
			continue;
		}

		if (!entry.isFile()) continue;
		results.push(path.relative(rootPath, fullPath) || entry.name);
	}
}

function invalidCompletionParams(message: string) {
	const error = new Error(message) as Error & { code?: number };
	error.code = -32602;
	return error;
}
