import fs from "node:fs";
import path from "node:path";
import { parseRepoInput } from "./normalize";

// ── Owner resolution helpers (shared MCP ↔ dashboard) ────────────────────
//
// Single source of truth for owner extraction/inference. Consolidates the
// previously duplicated git-remote-owner logic in `session.ts` (used by
// `inferOwnerFromSession`) and `dashboard/services/codebase.service.ts`
// (`injectOwner`), plus the `owner/repo` format split shared by every
// dashboard caller of `parseRepoInput`.

/**
 * Returns the owner segment of an `owner/repo` input string (via the shared
 * `parseRepoInput`), or undefined when the input has no owner segment.
 *
 * Note: this is a syntax-level split. An empty/whitespace-only `owner` is
 * treated as "not provided" (never as an explicit repo-only scope) by
 * `normalize-args.ts` (FIX-OWNER-EMPTY); only a non-empty owner is
 * authoritative.
 */
export function ownerFromRepoInput(repo: string | undefined): string | undefined {
	if (!repo) return undefined;
	const parsed = parseRepoInput(repo);
	return parsed.owner || undefined;
}

/**
 * Validates that a string is a legal GitHub username per GitHub's validation
 * rules: 1–39 chars, alphanumeric start/end, single internal hyphens.
 */
export function isValidGitHubUsername(username: string): boolean {
	return /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(username);
}

/**
 * Attempts to extract the GitHub owner (username or organization) from the
 * `url = ...` line of the git remote origin in the given working directory.
 * Returns undefined when the dir is not a git checkout or the remote owner is
 * not a legal GitHub username.
 *
 * Supports SSH (`git@github.com:owner/repo.git`), HTTPS
 * (`https://github.com/owner/repo.git`) and git protocol
 * (`git://github.com/owner/repo.git`) remote forms.
 */
export function inferOwnerFromGitRemote(cwd: string): string | undefined {
	try {
		const gitConfigPath = path.join(cwd, ".git", "config");
		if (!fs.existsSync(gitConfigPath)) return undefined;
		const content = fs.readFileSync(gitConfigPath, "utf-8");

		const match = content.match(
			/url\s*=\s*(?:git@github\.com:|https?:\/\/github\.com\/|git:\/\/github\.com\/)([^/\s]+)/
		);
		const rawOwner = match?.[1];
		return rawOwner && isValidGitHubUsername(rawOwner) ? rawOwner : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Owner injection for dashboard → MCP tool-handler delegation
 * (used by `codebase.service.ts`).
 *
 * Precedence:
 *   1. explicit non-empty `params.owner` → returned unchanged;
 *   2. owner segment of an `owner/repo`-formatted `params.repo`;
 *   3. owner inferred from the CWD git remote origin;
 *   4. otherwise params returned unchanged (no owner fabricated).
 */
export function withInjectedOwner(params: Record<string, unknown>): Record<string, unknown> {
	if (typeof params.owner === "string" && params.owner.length > 0) {
		return params;
	}

	const repoOwner = ownerFromRepoInput(params.repo as string | undefined);
	if (repoOwner) {
		return { ...params, owner: repoOwner };
	}

	const gitOwner = inferOwnerFromGitRemote(process.cwd());
	if (gitOwner) {
		return { ...params, owner: gitOwner };
	}

	return params;
}
