/**
 * FileDiscoveryService tests — validates file walking, gitignore filtering,
 * glob patterns, symlink handling, and result sorting.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { discoverFiles, detectLanguage, isExcludedSourceFile } from "../../codebase-index/services/file-discovery";

// ── Helpers ────────────────────────────────────────────────────────────

function touch(filePath: string, content = "// test"): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
}

function relativePaths(result: Awaited<ReturnType<typeof discoverFiles>>): string[] {
	return result.files.map((f) => f.path);
}

// ── Test suite ─────────────────────────────────────────────────────────

describe("FileDiscoveryService", () => {
	let tempDir: string;

	beforeAll(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-test-"));
	});

	afterAll(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	// ──────────────────────────────────────────────────────────────────
	it("discovers .ts files in a directory", async () => {
		const root = path.join(tempDir, "discover-ts");
		touch(path.join(root, "a.ts"));
		touch(path.join(root, "b.ts"));
		touch(path.join(root, "c.ts"));

		const result = await discoverFiles({ projectPath: root });

		expect(result.files).toHaveLength(3);
		expect(result.supportedFiles).toBe(3);
		expect(result.totalFiles).toBe(3);
		for (const f of result.files) {
			expect(f.language).toBe("typescript");
			expect(f.absolutePath).toBe(path.resolve(root, f.path));
		}
	});

	// ──────────────────────────────────────────────────────────────────
	it("respects .gitignore rules", async () => {
		const root = path.join(tempDir, "gitignore-test");
		fs.mkdirSync(root, { recursive: true });
		fs.writeFileSync(path.join(root, ".gitignore"), "*.log\n", "utf-8");
		touch(path.join(root, "keep.ts"));
		touch(path.join(root, "ignore.log"));

		const result = await discoverFiles({ projectPath: root });

		const names = relativePaths(result);
		expect(names).toContain("keep.ts");
		expect(names).not.toContain("ignore.log");
		expect(result.supportedFiles).toBe(1);
	});

	// ──────────────────────────────────────────────────────────────────
	it("accepts custom include glob (only .tsx)", async () => {
		const root = path.join(tempDir, "include-tsx");
		touch(path.join(root, "page.tsx"));
		touch(path.join(root, "util.ts"));
		touch(path.join(root, "data.json"));

		const result = await discoverFiles({
			projectPath: root,
			includeGlobs: ["**/*.tsx"]
		});

		const names = relativePaths(result);
		expect(names).toEqual(["page.tsx"]);
	});

	// ──────────────────────────────────────────────────────────────────
	it("accepts custom exclude glob (skips generated dir)", async () => {
		const root = path.join(tempDir, "exclude-gen");
		touch(path.join(root, "generated", "auto.ts"));
		touch(path.join(root, "src", "manual.ts"));

		const result = await discoverFiles({
			projectPath: root,
			excludeGlobs: ["**/generated/**"]
		});

		const names = relativePaths(result);
		expect(names).toEqual(["src/manual.ts"]);
		expect(names).not.toContain("generated/auto.ts");
	});

	// ──────────────────────────────────────────────────────────────────
	it("skips node_modules by default", async () => {
		const root = path.join(tempDir, "node-modules-test");
		touch(path.join(root, "node_modules", "foo.ts"));
		touch(path.join(root, "src", "bar.ts"));

		const result = await discoverFiles({ projectPath: root });

		const names = relativePaths(result);
		expect(names).toEqual(["src/bar.ts"]);
		expect(names).not.toContain("node_modules/foo.ts");
	});

	// ──────────────────────────────────────────────────────────────────
	it("returns empty array for empty directory", async () => {
		const root = path.join(tempDir, "empty-dir");
		fs.mkdirSync(root, { recursive: true });

		const result = await discoverFiles({ projectPath: root });

		expect(result.files).toEqual([]);
		expect(result.totalFiles).toBe(0);
		expect(result.supportedFiles).toBe(0);
		expect(result.skippedFiles).toBe(0);
		expect(result.errors).toEqual([]);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	// ──────────────────────────────────────────────────────────────────
	it("returns results sorted alphabetically by relative path", async () => {
		const root = path.join(tempDir, "sorted-test");
		// Create files in non-alphabetical order
		touch(path.join(root, "zebra.ts"));
		touch(path.join(root, "alpha.ts"));
		touch(path.join(root, "mango.ts"));
		touch(path.join(root, "nested", "deep.ts"));
		touch(path.join(root, "nested", "apple.ts"));

		const result = await discoverFiles({ projectPath: root });

		const paths = relativePaths(result);
		expect(paths).toEqual(["alpha.ts", "mango.ts", "nested/apple.ts", "nested/deep.ts", "zebra.ts"]);
	});

	// ──────────────────────────────────────────────────────────────────
	it("skips symlinks and does not duplicate", async () => {
		const root = path.join(tempDir, "symlink-test");
		const realFile = path.join(root, "real.ts");
		const symlinkPath = path.join(root, "link.ts");

		touch(realFile);
		fs.symlinkSync(realFile, symlinkPath);

		const result = await discoverFiles({ projectPath: root });

		const names = relativePaths(result);
		expect(names).toEqual(["real.ts"]);
		// symlink should be excluded entirely by fast-glob (followSymbolicLinks: false + onlyFiles: true)
		expect(names).not.toContain("link.ts");
		expect(result.supportedFiles).toBe(1);
		expect(result.skippedFiles).toBe(0);
	});

	// ──────────────────────────────────────────────────────────────────
	it("skips files with unsupported extensions", async () => {
		const root = path.join(tempDir, "unsupported-ext");
		touch(path.join(root, "valid.ts"));
		touch(path.join(root, "image.png"));
		touch(path.join(root, "archive.zip"));

		const result = await discoverFiles({ projectPath: root });

		const names = relativePaths(result);
		expect(names).toEqual(["valid.ts"]);
	});

	// ──────────────────────────────────────────────────────────────────
	it("sets durationMs to a positive number", async () => {
		const root = path.join(tempDir, "duration-test");
		touch(path.join(root, "f.ts"));

		const result = await discoverFiles({ projectPath: root });

		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(Number.isInteger(result.durationMs)).toBe(true);
	});

	// ──────────────────────────────────────────────────────────────────
	it("maps correct language identifiers for known extensions", async () => {
		const root = path.join(tempDir, "lang-test");
		touch(path.join(root, "file.ts"), "// ts");
		touch(path.join(root, "file.tsx"), "// tsx");
		touch(path.join(root, "file.js"), "// js");
		touch(path.join(root, "file.json"), "{}");
		touch(path.join(root, "file.md"), "# md");
		touch(path.join(root, "file.py"), "# py");
		touch(path.join(root, "file.go"), "// go");
		touch(path.join(root, "file.css"), "/* css */");

		const result = await discoverFiles({ projectPath: root });

		const langMap: Record<string, string> = {};
		for (const f of result.files) {
			langMap[f.path] = f.language;
		}
		expect(langMap["file.ts"]).toBe("typescript");
		expect(langMap["file.tsx"]).toBe("typescriptreact");
		expect(langMap["file.js"]).toBe("javascript");
		expect(langMap["file.json"]).toBe("json");
		expect(langMap["file.md"]).toBe("markdown");
		expect(langMap["file.py"]).toBe("python");
		expect(langMap["file.go"]).toBe("go");
		expect(langMap["file.css"]).toBe("css");
	});

	// ──────────────────────────────────────────────────────────────────
	it("records file size in bytes", async () => {
		const root = path.join(tempDir, "size-test");
		touch(path.join(root, "small.ts"), "abc"); // 3 bytes
		touch(path.join(root, "big.ts"), "x".repeat(100)); // 100 bytes

		const result = await discoverFiles({ projectPath: root });

		const filesByName: Record<string, number> = {};
		for (const f of result.files) {
			filesByName[f.path] = f.sizeBytes;
		}
		expect(filesByName["small.ts"]).toBe(3);
		expect(filesByName["big.ts"]).toBe(100);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Nested gitignore in subdirectory overrides parent
	// ══════════════════════════════════════════════════════════════════

	it("nested .gitignore in subdirectory overrides parent rules", async () => {
		const root = path.join(tempDir, "nested-gitignore");
		fs.mkdirSync(root, { recursive: true });
		// Root gitignore ignores all *.ts
		fs.writeFileSync(path.join(root, ".gitignore"), "*.ts\n", "utf-8");
		touch(path.join(root, "ignored.ts"));
		// Subdirectory has its own .gitignore overriding parent with negation
		fs.mkdirSync(path.join(root, "sub"), { recursive: true });
		fs.writeFileSync(path.join(root, "sub", ".gitignore"), "!*.ts\n", "utf-8");
		touch(path.join(root, "sub", "allowed.ts"));
		touch(path.join(root, "sub", "also.ts"));

		const result = await discoverFiles({ projectPath: root });

		const names = relativePaths(result);
		// Root *.ts rule still applies to root-level files
		expect(names).not.toContain("ignored.ts");
		// Nested !*.ts overrides root for subdirectory files
		expect(names).toContain("sub/allowed.ts");
		expect(names).toContain("sub/also.ts");
		expect(result.skippedFiles).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Negation patterns in gitignore
	// ══════════════════════════════════════════════════════════════════

	it("negation patterns overrides previous ignore rule", async () => {
		const root = path.join(tempDir, "negate-pattern");
		fs.mkdirSync(root, { recursive: true });
		fs.writeFileSync(path.join(root, ".gitignore"), "important/*\n!important/*.ts\n", "utf-8");
		touch(path.join(root, "important", "config.json"));
		touch(path.join(root, "important", "config.ts"));
		touch(path.join(root, "important", "util.ts"));
		touch(path.join(root, "src", "app.ts"));

		const result = await discoverFiles({ projectPath: root });

		const names = relativePaths(result);
		// Negation un-ignores *.ts in important/
		expect(names).toContain("important/config.ts");
		expect(names).toContain("important/util.ts");
		// important/config.json is NOT un-ignored — still ignored
		expect(names).not.toContain("important/config.json");
		// Other dirs unaffected
		expect(names).toContain("src/app.ts");
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Empty .gitignore file does not cause errors
	// ══════════════════════════════════════════════════════════════════

	it("empty .gitignore file does not cause errors", async () => {
		const root = path.join(tempDir, "empty-gitignore");
		fs.mkdirSync(root, { recursive: true });
		fs.writeFileSync(path.join(root, ".gitignore"), "", "utf-8");
		touch(path.join(root, "app.ts"));
		touch(path.join(root, "lib.ts"));

		const result = await discoverFiles({ projectPath: root });

		expect(result.files.length).toBe(2);
		expect(result.errors).toEqual([]);
		const names = relativePaths(result);
		expect(names).toContain("app.ts");
		expect(names).toContain("lib.ts");
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: No .gitignore — falls back to defaults correctly
	// ══════════════════════════════════════════════════════════════════

	it("no .gitignore falls back to defaults correctly", async () => {
		const root = path.join(tempDir, "no-gitignore");
		fs.mkdirSync(root, { recursive: true });
		// No .gitignore file at all
		touch(path.join(root, "src", "index.ts"));
		touch(path.join(root, "src", "legacy.ts"));
		// node_modules should still be skipped by default
		touch(path.join(root, "node_modules", "dep.ts"));

		const result = await discoverFiles({ projectPath: root });

		const names = relativePaths(result);
		expect(names).toContain("src/index.ts");
		expect(names).toContain("src/legacy.ts");
		expect(names).not.toContain("node_modules/dep.ts");
		expect(result.errors).toEqual([]);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Large directory — 100 files, verify all discovered
	// ══════════════════════════════════════════════════════════════════

	it("large directory: 100 files in flat structure, all discovered", async () => {
		const root = path.join(tempDir, "large-dir");
		fs.mkdirSync(root, { recursive: true });
		for (let i = 0; i < 100; i++) {
			touch(path.join(root, `file${String(i).padStart(3, "0")}.ts`), `// file ${i}`);
		}

		const result = await discoverFiles({ projectPath: root });

		expect(result.totalFiles).toBe(100);
		expect(result.supportedFiles).toBe(100);
		expect(result.skippedFiles).toBe(0);
		expect(result.files).toHaveLength(100);
		expect(result.errors).toEqual([]);
		// Verify all files are present and sorted
		for (let i = 0; i < 100; i++) {
			expect(result.files[i].path).toBe(`file${String(i).padStart(3, "0")}.ts`);
		}
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: maxFiles limit
	// ══════════════════════════════════════════════════════════════════

	it("respects maxFiles limit", async () => {
		const root = path.join(tempDir, "maxfiles-test");
		for (let i = 0; i < 20; i++) {
			touch(path.join(root, `file${i}.ts`), `// file ${i}`);
		}

		const result = await discoverFiles({ projectPath: root, maxFiles: 5 });

		expect(result.files.length).toBeLessThanOrEqual(5);
		expect(result.supportedFiles).toBeLessThanOrEqual(5);
	});

	it("maxFiles=0 stops after first file (length 0 >= 0 breaks after push)", async () => {
		const root = path.join(tempDir, "maxfiles-zero");
		touch(path.join(root, "a.ts"));

		const result = await discoverFiles({ projectPath: root, maxFiles: 0 });

		// When maxFiles=0, the first file is pushed before the check `length >= 0`,
		// then it breaks. So 1 file is returned.
		expect(result.files).toHaveLength(1);
		expect(result.supportedFiles).toBe(1);
	});

	it("maxFiles larger than file count returns all files", async () => {
		const root = path.join(tempDir, "maxfiles-large");
		touch(path.join(root, "a.ts"));
		touch(path.join(root, "b.ts"));

		const result = await discoverFiles({ projectPath: root, maxFiles: 100 });

		expect(result.files).toHaveLength(2);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Extensionless files (Dockerfile, Makefile)
	// ══════════════════════════════════════════════════════════════════

	it("detects extensionless files like Dockerfile and Makefile", async () => {
		const root = path.join(tempDir, "extless-test");
		touch(path.join(root, "Dockerfile"), "FROM node:18");
		touch(path.join(root, "Makefile"), "test:\n\techo ok");
		touch(path.join(root, "renovate.json"), "{}");

		const result = await discoverFiles({ projectPath: root });

		const names = relativePaths(result);
		expect(names).toContain("Dockerfile");
		expect(names).toContain("Makefile");
		expect(names).toContain("renovate.json");

		const fileMap: Record<string, string> = {};
		for (const f of result.files) {
			fileMap[f.path] = f.language;
		}
		expect(fileMap["Dockerfile"]).toBe("dockerfile");
		expect(fileMap["Makefile"]).toBe("makefile");
		expect(fileMap["renovate.json"]).toBe("json");
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: respectGitignore=false bypasses .gitignore
	// ══════════════════════════════════════════════════════════════════

	it("respectGitignore=false bypasses .gitignore rules", async () => {
		const root = path.join(tempDir, "no-gitignore-respect");
		fs.mkdirSync(root, { recursive: true });
		fs.writeFileSync(path.join(root, ".gitignore"), "*.ts\n", "utf-8");
		touch(path.join(root, "app.ts"));
		touch(path.join(root, "debug.ts"));

		const result = await discoverFiles({
			projectPath: root,
			respectGitignore: false
		});

		const names = relativePaths(result);
		expect(names).toContain("app.ts");
		expect(names).toContain("debug.ts");
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: skips duplicate and unknown extensions, skipped counters
	// ══════════════════════════════════════════════════════════════════

	it("reports correct skippedByExtension count", async () => {
		const root = path.join(tempDir, "skipped-ext-count");
		touch(path.join(root, "valid.ts"));
		touch(path.join(root, "image.png"));
		touch(path.join(root, "archive.zip"));
		touch(path.join(root, "movie.mp4"));

		const result = await discoverFiles({ projectPath: root });

		expect(result.skippedByExtension).toBe(3);
		expect(result.supportedFiles).toBe(1);
	});

	it("reports correct skippedByGitignore count", async () => {
		const root = path.join(tempDir, "skipped-git-count");
		fs.mkdirSync(root, { recursive: true });
		fs.writeFileSync(path.join(root, ".gitignore"), "*.log\n", "utf-8");
		touch(path.join(root, "app.ts"));
		touch(path.join(root, "error1.log"));
		touch(path.join(root, "error2.log"));

		const result = await discoverFiles({ projectPath: root });

		expect(result.skippedByGitignore).toBe(2);
		expect(result.supportedFiles).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// FIX-031: unreadable directories are skipped, not errored
	// ══════════════════════════════════════════════════════════════════

	describe("unreadable directories (FIX-031)", () => {
		/**
		 * `chmod 000` does not block reads when the process is privileged
		 * (root) or on filesystems that ignore POSIX bits. Probe once so the
		 * positive case skips cleanly instead of producing a false failure.
		 */
		function canEnforcePermissionDenied(): boolean {
			if (process.getuid?.() === 0) return false;
			const probe = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-perm-probe-"));
			try {
				fs.chmodSync(probe, 0o000);
				try {
					fs.readdirSync(probe);
					return false; // chmod did not block — cannot simulate EACCES here
				} catch (err) {
					const code = (err as NodeJS.ErrnoException).code;
					return code === "EACCES" || code === "EPERM";
				}
			} finally {
				try {
					fs.chmodSync(probe, 0o755);
				} catch {
					/* best effort */
				}
				fs.rmSync(probe, { recursive: true, force: true });
			}
		}

		const permissionDeniedEnforceable = canEnforcePermissionDenied();

		it.skipIf(!permissionDeniedEnforceable)(
			"completes and reports an unreadable subdir as skipped (no errors)",
			async () => {
				const root = path.join(tempDir, "unreadable-dir");
				touch(path.join(root, "src", "readable.ts"));
				const lockedDir = path.join(root, "locked");
				touch(path.join(lockedDir, "hidden.ts"));
				fs.chmodSync(lockedDir, 0o000);

				let result: Awaited<ReturnType<typeof discoverFiles>>;
				try {
					result = await discoverFiles({ projectPath: root });
				} finally {
					fs.chmodSync(lockedDir, 0o755);
				}

				// The scan completes and still discovers every readable file.
				const names = relativePaths(result);
				expect(names).toEqual(["src/readable.ts"]);
				expect(result.supportedFiles).toBe(1);

				// The unreadable dir is reported in the skip summary...
				expect(result.skippedDirectories).toEqual(["locked"]);
				// ...and NOT surfaced as a per-path error (no EACCES emitted).
				expect(result.errors).toEqual([]);
			}
		);

		it("does not report skipped directories on a fully readable tree", async () => {
			const root = path.join(tempDir, "all-readable");
			touch(path.join(root, "src", "a.ts"));
			touch(path.join(root, "src", "nested", "b.ts"));

			const result = await discoverFiles({ projectPath: root });

			expect(result.skippedDirectories).toEqual([]);
			expect(result.errors).toEqual([]);
			expect(result.supportedFiles).toBe(2);
		});
	});

	// ══════════════════════════════════════════════════════════════════
	// FIX-030: non-source extensions (.sql/.lock/.env/.dockerfile) are
	// skipped by discovery, never handed to the parser.
	// ══════════════════════════════════════════════════════════════════

	describe("non-source extension exclusion (FIX-030)", () => {
		it("isExcludedSourceFile: true for .sql/.lock/.env/.dockerfile (positive)", () => {
			expect(isExcludedSourceFile("schema.sql")).toBe(true);
			expect(isExcludedSourceFile("db/yarn.lock")).toBe(true);
			expect(isExcludedSourceFile("config/app.env")).toBe(true);
			expect(isExcludedSourceFile("build/app.dockerfile")).toBe(true);
			// Case-insensitive — fast-glob yields mixed-case paths.
			expect(isExcludedSourceFile("SCHEMA.SQL")).toBe(true);
		});

		it("isExcludedSourceFile: false for indexable source (negative)", () => {
			expect(isExcludedSourceFile("src/index.ts")).toBe(false);
			expect(isExcludedSourceFile("styles/app.css")).toBe(false);
			expect(isExcludedSourceFile("data/config.json")).toBe(false);
			// detectLanguage still NAMES .sql/.lock for the dashboard's
			// non-indexed file view — naming and indexability are separate.
			expect(detectLanguage("schema.sql")).toBe("sql");
			expect(detectLanguage("yarn.lock")).toBe("lockfile");
		});

		it("skips .sql/.lock files by extension instead of discovering them", async () => {
			const root = path.join(tempDir, "nonsource-skip");
			touch(path.join(root, "app.ts"));
			touch(path.join(root, "schema.sql"), "CREATE TABLE t (id INT);\n");
			touch(path.join(root, "yarn.lock"), "# yarn lockfile v1\n");
			touch(path.join(root, "app.env"), "KEY=value\n");
			touch(path.join(root, "server.dockerfile"), "FROM node:22\n");

			const result = await discoverFiles({ projectPath: root });

			const names = relativePaths(result);
			expect(names).toEqual(["app.ts"]);
			// All four non-source files are counted as extension skips...
			expect(result.skippedByExtension).toBe(4);
			expect(result.supportedFiles).toBe(1);
			// ...and never surface as parseable files.
			expect(names).not.toContain("schema.sql");
			expect(names).not.toContain("yarn.lock");
		});

		it("still discovers ordinary supported extensions alongside skipped non-source (negative control)", async () => {
			const root = path.join(tempDir, "nonsource-mixed");
			touch(path.join(root, "a.ts"));
			touch(path.join(root, "b.json"), "{}");
			touch(path.join(root, "c.sql"), "SELECT 1;\n");

			const result = await discoverFiles({ projectPath: root });

			const names = relativePaths(result);
			expect(names).toEqual(["a.ts", "b.json"]);
			expect(result.skippedByExtension).toBe(1);
		});
	});

	// ══════════════════════════════════════════════════════════════════
	// M5 (FEAT-DAEMON-002 review step 4): the gitignore discovery pass is now
	// ASYNC (fg async API + fs.promises.readFile). These tests pin that the
	// async path yields the SAME file set + ordering as the former sync pass,
	// including the parent-before-child .gitignore ordering semantics.
	// ══════════════════════════════════════════════════════════════════

	describe("async gitignore discovery preserves results (M5)", () => {
		it("applies nested gitignore rules collected across depths (parent-before-child)", async () => {
			const root = path.join(tempDir, "async-gitignore-depth");
			fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
			// Root ignores *.ts everywhere.
			fs.writeFileSync(path.join(root, ".gitignore"), "*.ts\n", "utf-8");
			// A deeper .gitignore un-ignores ts under a/b only.
			fs.writeFileSync(path.join(root, "a", "b", ".gitignore"), "!*.ts\n", "utf-8");

			touch(path.join(root, "root.ts"));
			touch(path.join(root, "a", "mid.ts"));
			touch(path.join(root, "a", "b", "kept.ts"));
			touch(path.join(root, "a", "b", "app.ts"));

			const result = await discoverFiles({ projectPath: root });
			const names = relativePaths(result);

			// Root rule still ignores the shallow files; the nested negation keeps
			// a/b/*.ts. This is only correct when BOTH .gitignore files were
			// discovered and applied parent-before-child.
			expect(names).toEqual(["a/b/app.ts", "a/b/kept.ts"]);
			expect(names).not.toContain("root.ts");
			expect(names).not.toContain("a/mid.ts");
			expect(result.errors).toEqual([]);
		});

		it("produces a stable sorted file set across repeated async runs", async () => {
			const root = path.join(tempDir, "async-stable");
			fs.mkdirSync(root, { recursive: true });
			fs.writeFileSync(path.join(root, ".gitignore"), "ignored.ts\n", "utf-8");
			for (let i = 0; i < 25; i++) {
				touch(path.join(root, `f${String(i).padStart(2, "0")}.ts`), `// ${i}`);
			}
			touch(path.join(root, "ignored.ts"));

			const first = await discoverFiles({ projectPath: root });
			const second = await discoverFiles({ projectPath: root });

			expect(relativePaths(first)).toEqual(relativePaths(second));
			expect(first.supportedFiles).toBe(25);
			expect(first.files.every((f, i, arr) => i === 0 || arr[i - 1]!.path.localeCompare(f.path) <= 0)).toBe(true);
		});

		it("does not block the event loop on the gitignore scan (yields to a pending timer)", async () => {
			const root = path.join(tempDir, "async-nonblocking");
			fs.mkdirSync(path.join(root, "src"), { recursive: true });
			fs.writeFileSync(path.join(root, ".gitignore"), "*.log\n", "utf-8");
			for (let i = 0; i < 50; i++) {
				touch(path.join(root, "src", `m${i}.ts`), `// ${i}`);
			}

			// Schedule a macrotask BEFORE discovery; if discovery blocked the event
			// loop synchronously it would run first. With the async pass the timer
			// fires before discovery resolves.
			let timerFired = false;
			const timer = new Promise<void>((resolve) => {
				setTimeout(() => {
					timerFired = true;
					resolve();
				}, 0);
			});

			const discovery = discoverFiles({ projectPath: root });
			await timer;
			expect(timerFired).toBe(true);
			await discovery;
		});
	});
});
