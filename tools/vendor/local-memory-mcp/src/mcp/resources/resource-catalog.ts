/**
 * MCP resource catalog — static resources, template listings and completion
 * (TASK-558 split).
 *
 * Extracted from resources/index.ts: `listResources`, `listResourceTemplates`
 * and `completeResourceArgument` live here; the read dispatcher lives in
 * resource-reads.ts; envelope/pagination/error helpers in resource-helpers.ts.
 * The catalog entries below ARE the metadata contract for the MCP
 * resources/list + resources/templates/list surfaces and must stay in sync
 * with the SDK registrations in sdk-index.ts (same titles/descriptions).
 */

import type { SessionContext } from "../session";
import { rankCompletionValues } from "../utils/completion";
import { CODEBASE_RESOURCE_TEMPLATES, CODEBASE_TEMPLATE_URIS } from "./codebase";
import { paginateEntries, invalidCompletionParams } from "./resource-helpers";

/** List the two static resources (repository index + session roots). */
export function listResources(session?: SessionContext, params?: { cursor?: string; limit?: number }) {
	const resources = [
		{
			uri: "repository://index",
			name: "Repository Index",
			title: "Repository Index",
			description: "All known repos with memory/task counts",
			mimeType: "application/json",
			annotations: {
				audience: ["assistant"],
				priority: 1,
				lastModified: new Date().toISOString()
			}
		},
		{
			uri: "session://roots",
			name: "Session Roots",
			title: "Session Roots",
			description: session?.roots.length
				? "Active workspace roots provided by the MCP client"
				: "No active workspace roots were provided by the MCP client",
			mimeType: "application/json",
			size: Buffer.byteLength(JSON.stringify({ roots: session?.roots ?? [] }), "utf8"),
			annotations: {
				audience: ["assistant"],
				priority: 0.95,
				lastModified: new Date().toISOString()
			}
		}
	];

	return paginateEntries("resources", resources, params);
}

/** List every resource template (memory/task/repository extras + codebase). */
export function listResourceTemplates(params?: { cursor?: string; limit?: number }) {
	const templates = [
		// ── Memory ──────────────────────────────────────────────────────────────
		{
			uriTemplate: "repository://{name}/memories",
			name: "Repository Memories",
			title: "Repository Memories",
			description: "Active memory entries for a repo",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.85 }
		},
		{
			uriTemplate: "repository://{name}/memories?search={search}&type={type}&tag={tag}",
			name: "Filtered Repository Memories",
			title: "Filtered Repository Memories",
			description: "Filter memories in a repo by keyword, type, or tag",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.8 }
		},
		{
			uriTemplate: "memory://{id}",
			name: "Memory Detail",
			title: "Memory Detail",
			description: "Full content and stats for a memory UUID",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.75 }
		},
		// ── Tasks ────────────────────────────────────────────────────────────────
		{
			uriTemplate: "repository://{name}/tasks",
			name: "Repository Tasks",
			title: "Repository Tasks",
			description: "Active tasks for a repo",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.9 }
		},
		{
			uriTemplate: "repository://{name}/tasks?status={status}&priority={priority}",
			name: "Filtered Repository Tasks",
			title: "Filtered Repository Tasks",
			description: "Filter tasks by status or priority",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.85 }
		},
		{
			uriTemplate: "task://{id}",
			name: "Task Detail",
			title: "Task Detail",
			description: "Full content and comments for a task UUID",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.8 }
		},
		// ── Repository extras ────────────────────────────────────────────────────
		{
			uriTemplate: "repository://{name}/summary",
			name: "Repository Summary",
			title: "Repository Summary",
			description: "Architectural summary for a repo",
			mimeType: "text/plain",
			annotations: { audience: ["assistant"], priority: 0.95 }
		},
		{
			uriTemplate: "repository://{name}/actions",
			name: "Repository Actions",
			title: "Repository Actions",
			description: "Audit log of tool actions for a repo",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.6 }
		},
		// ── Action detail ────────────────────────────────────────────────────────
		{
			uriTemplate: "action://{id}",
			name: "Action Detail",
			title: "Action Detail",
			description: "Full details of an audit log entry",
			mimeType: "application/json",
			annotations: { audience: ["assistant"], priority: 0.55 }
		},
		// ── Codebase index (RS-1/TASK-323) ───────────────────────────────────
		// Each entry mirrors the SDK registration in sdk-index.ts (single-param
		// siblings + multi-segment `{+file_path}`); metadata in codebase.ts.
		...CODEBASE_RESOURCE_TEMPLATES
	];

	return paginateEntries("resourceTemplates", templates, params);
}

/** Autocomplete a template argument (repo/tag) for resources/template completion. */
export function completeResourceArgument(
	resourceUri: string,
	argumentName: string,
	argumentValue: string,
	_contextArguments: Record<string, unknown>,
	dataSources: {
		repos: string[];
		tags: string[];
	}
) {
	// Repo autocomplete for ALL repository://{name}/... collection templates —
	// plain, full-query, and single-param sibling forms (TASK-442).
	// completion/complete passes the client's ref.uri verbatim, and the SDK
	// lists every sibling URI template, so the match set must cover each
	// registered form or a listed template answers -32602 (mirrors the
	// CODEBASE_TEMPLATE_URIS approach below).
	const REPOSITORY_COLLECTION_TEMPLATE_RE =
		/^repository:\/\/\{name\}\/(memories|tasks|summary|actions)(?:\{[^}]*\}|\?[^ ]*)?$/;
	if (REPOSITORY_COLLECTION_TEMPLATE_RE.test(resourceUri)) {
		if (argumentName === "name") {
			return rankCompletionValues(dataSources.repos, argumentValue);
		}
	}

	// Repo autocomplete for all codebase://{repo}/... templates (RS-1/TASK-323).
	// Match set accepts BOTH the listing form and the SDK registration form for
	// every template (incl. single-param siblings and `{+file_path}`) so
	// production completion/complete never throws -32602 for a listed template.
	if (CODEBASE_TEMPLATE_URIS.includes(resourceUri)) {
		if (argumentName === "repo") {
			return rankCompletionValues(dataSources.repos, argumentValue);
		}
	}

	// Tag autocomplete for any memories template that exposes the tag param —
	// legacy filtered form plus the SDK {?tag} / full-query siblings (TASK-442).
	const MEMORIES_WITH_TAG_RE = /^repository:\/\/\{name\}\/memories(?:\{[^}]*tag[^}]*\}|\?.*tag=)/;
	if (MEMORIES_WITH_TAG_RE.test(resourceUri)) {
		if (argumentName === "tag") {
			return rankCompletionValues(dataSources.tags, argumentValue);
		}
	}

	throw invalidCompletionParams(`Unknown resource template or argument: ${resourceUri} (${argumentName})`);
}
