import fs from "node:fs";
import path from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY BOUNDARY — path containment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve a caller-supplied relative path strictly INSIDE the repo root.
 *
 * Returns null when the path is not contained — the caller must reject the
 * request (PATH_TRAVERSAL). Three layers:
 *   1. Absolute inputs are refused outright (`path.resolve` would otherwise
 *      DISCARD repoRoot and anchor at the absolute path — the classic escape).
 *   2. Lexical containment: the resolved path's relative offset must not
 *      start with `..` nor be absolute (catches `../`, nested `a/../../b`).
 *   3. realpath hardening (defense-in-depth): even a lexically-contained
 *      path can smuggle a symlink whose target lives outside the repo — both
 *      sides are realpath'd and containment re-checked on the REAL paths.
 *      A missing file (ENOENT) passes the lexical path through so the read
 *      surfaces the proper 404 (FILE_NOT_FOUND); any other realpath failure
 *      resolves to "not contained" (reject).
 *
 * `repoRoot` must be a directory (CODEBASE_REPOS_DIR / repoPath verified by
 * CodebaseService via resolveRepoPath).
 */
export function resolveInsideRepo(repoRoot: string, filePath: string): string | null {
	if (path.isAbsolute(filePath)) return null;
	const resolved = path.resolve(repoRoot, filePath);
	const rel = path.relative(repoRoot, resolved);
	if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
	try {
		const realRoot = fs.realpathSync(repoRoot);
		const realFile = fs.realpathSync(resolved);
		const realRel = path.relative(realRoot, realFile);
		if (realRel.startsWith("..") || path.isAbsolute(realRel)) return null;
		return realFile;
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return resolved;
		return null;
	}
}
