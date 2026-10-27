/**
 * Project detection — a language/framework-agnostic "is this really a project?"
 * check, used to gate the STARTUP auto-index.
 *
 * Why this exists: the daemon auto-indexes `process.cwd()` on boot. When the
 * daemon is launched from a NON-project directory — most commonly the user's
 * HOME (`npx … daemon` run from `~`) — that discovery walk enumerates the
 * entire tree (measured on a real home dir: 825k files / 2.7k `node_modules`),
 * blocks the Node event loop synchronously, and (because the walk throws on a
 * permission-denied child directory) never records a `last_indexed_at`, so it
 * is retried on every watcher sweep forever. The blocked event loop starves the
 * HTTP server, which surfaces to clients as socket timeouts.
 *
 * The check is deliberately CHEAP: it reads only the TOP-LEVEL entries of the
 * candidate directory and looks for a well-known project manifest. It never
 * recurses, so even running it against a huge directory costs one `readdir`.
 *
 * Detection is ecosystem-agnostic on purpose: Node, PHP, Python, Rust, Go, the
 * JVM family, Ruby, Elixir/Erlang, Dart/Flutter, Swift/Apple, C/C++, .NET,
 * Haskell, Clojure, Julia, Zig, Deno, plus a bare `.git`/`Makefile`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Exact top-level filenames that mark a project root. Compared
 * case-insensitively (a file system may be case-preserving but
 * case-insensitive, and `Makefile`/`CMakeLists.txt` are conventionally
 * capitalized).
 */
const PROJECT_MARKER_FILES: readonly string[] = Object.freeze([
	// Node / JS / TS
	"package.json",
	// PHP
	"composer.json",
	// Python
	"pyproject.toml",
	"setup.py",
	"setup.cfg",
	"requirements.txt",
	"pipfile",
	// Rust
	"cargo.toml",
	// Go
	"go.mod",
	// JVM (Java / Kotlin / Scala / Groovy)
	"pom.xml",
	"build.gradle",
	"build.gradle.kts",
	"settings.gradle",
	"settings.gradle.kts",
	"build.sbt",
	// Ruby
	"gemfile",
	// Elixir / Erlang
	"mix.exs",
	"rebar.config",
	// Dart / Flutter
	"pubspec.yaml",
	// Swift / Apple (single-file projects also match the suffix list below)
	"package.swift",
	// C / C++
	"cmakelists.txt",
	// Generic build tooling
	"makefile",
	// Deno
	"deno.json",
	"deno.jsonc",
	// Haskell
	"stack.yaml",
	// Clojure
	"deps.edn",
	"project.clj",
	// Julia
	"manifest.toml",
	// Zig
	"build.zig",
	// .NET (multi-project solutions)
	"global.json"
]);

/** Top-level filename suffixes that mark a project root (compared lowercased). */
const PROJECT_MARKER_SUFFIXES: readonly string[] = Object.freeze([
	".csproj",
	".fsproj",
	".vbproj",
	".sln",
	".xcodeproj",
	".xcworkspace",
	".cabal",
	".rockspec",
	".nimble"
]);

/**
 * Version-control markers. A directory carrying one of these IS a repository
 * by definition, even when it has no language-specific manifest (e.g. a docs or
 * scripts repo).
 */
const VCS_MARKER_DIRS: readonly string[] = Object.freeze([".git"]);

const MARKER_FILE_SET = new Set(PROJECT_MARKER_FILES);
const VCS_DIR_SET = new Set(VCS_MARKER_DIRS);

/** Why a directory was rejected as an auto-index target. */
export type AutoIndexSkipReason = "not_a_project" | "non_project_root";

/** Result of {@link evaluateAutoIndexTarget}. */
export interface AutoIndexEligibility {
	/** Whether the directory is a safe auto-index target. */
	eligible: boolean;
	/** Present only when `eligible` is false. */
	reason?: AutoIndexSkipReason;
	/** Marker names that matched at the top level (empty when none). */
	markers: string[];
}

/**
 * Return the top-level project markers present in `dirPath` (empty when none or
 * when the directory cannot be read). Cheap: a single non-recursive `readdir`.
 */
export function findProjectMarkers(dirPath: string): string[] {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dirPath, { withFileTypes: true });
	} catch {
		return [];
	}

	const markers: string[] = [];
	for (const entry of entries) {
		const name = entry.name;
		const lower = name.toLowerCase();
		if (MARKER_FILE_SET.has(lower) || VCS_DIR_SET.has(lower)) {
			markers.push(name);
			continue;
		}
		if (PROJECT_MARKER_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
			markers.push(name);
		}
	}
	return markers;
}

/**
 * Whether `dirPath` is a well-known NON-project root that must never be
 * auto-indexed regardless of markers: the user's home directory, the home
 * directory's parent (e.g. `/home`, `/Users`), or the filesystem root (`/`,
 * `C:\`). Indexing the whole home/system tree is never the intent, and a stray
 * marker there (e.g. an accidental `package.json` in `~`) must not re-enable it.
 */
export function isNonProjectRoot(dirPath: string): boolean {
	const resolved = path.resolve(dirPath);
	const home = os.homedir();
	const fsRoot = path.parse(resolved).root;
	return resolved === fsRoot || resolved === home || resolved === path.dirname(home);
}

/**
 * Decide whether a directory is a legitimate target for the STARTUP
 * auto-index. A directory is eligible only when it is NOT a well-known
 * non-project root AND carries at least one top-level project marker.
 *
 * Explicit, user-initiated indexing (the `codebase-index` tool, the dashboard
 * "register repo" flow, the `--index` CLI) is NOT routed through this check —
 * only the implicit `process.cwd()` auto-index is.
 */
export function evaluateAutoIndexTarget(dirPath: string): AutoIndexEligibility {
	const markers = findProjectMarkers(dirPath);
	if (isNonProjectRoot(dirPath)) {
		return { eligible: false, reason: "non_project_root", markers };
	}
	if (markers.length === 0) {
		return { eligible: false, reason: "not_a_project", markers };
	}
	return { eligible: true, markers };
}
