import type { CodebaseReadInput, CodebaseReadMode } from "../schemas/codebase-read";
import type { McpResponse } from "../../utils/mcp-response";
import { createMcpErrorResponse } from "../../utils/mcp-error";

// ── SCOPE GUARD ─────────────────────────────────────────────────────────

/**
 * Ensures every mode has an explicit repo scope.
 *
 * SEARCH accepts `repo` OR the cross-repo `repos` set; all other modes
 * (TRACE / FILE / ARCHITECTURE) require a concrete single `repo`.
 *
 * Cross-tenant guard: `codebase_symbols` has no owner column, so an unscoped
 * read would span every indexed repo across tenants. When both `repo` and
 * `repos` are absent, SEARCH mode rejects (per TASK-235 / issue #67).
 */
export function requireRepoScope(validated: CodebaseReadInput, mode: CodebaseReadMode): McpResponse | null {
	const hasRepos = validated.repos !== undefined && validated.repos.length > 0;

	if (mode === "search") {
		if (!validated.repo && !hasRepos) {
			return createMcpErrorResponse({
				code: "REPO_REQUIRED",
				message:
					"Search requires `repo` or `repos` to scope the query (cross-tenant guard — codebase_symbols has no owner column).",
				retryable: false
			});
		}
		return null;
	}

	if (!validated.repo) {
		return createMcpErrorResponse({
			code: "REPO_REQUIRED",
			message: `Mode '${mode}' requires a concrete 'repo'.`,
			retryable: false
		});
	}
	return null;
}
