/**
 * Tests for the language/framework-agnostic project-detection gate that
 * prevents the startup auto-index from walking a non-project root (most
 * commonly the user's HOME directory — the daemon auto-index incident).
 *
 * Strategy: real filesystem via `fs.mkdtemp` (per AGENTS.md — never write into
 * the repo tree), plus `vi.spyOn` on `os.homedir` for the non-project-root
 * assertions (the test process' real home must never be indexed or asserted
 * against).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	evaluateAutoIndexTarget,
	findProjectMarkers,
	isNonProjectRoot
} from "../../codebase-index/services/project-detection";

const tempDirs: string[] = [];

function makeDir(files: string[] = []): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projdetect-"));
	tempDirs.push(dir);
	for (const file of files) {
		const abs = path.join(dir, file);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, "");
	}
	return dir;
}

afterEach(() => {
	vi.restoreAllMocks();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("findProjectMarkers", () => {
	it("detects a Node project via package.json", () => {
		expect(findProjectMarkers(makeDir(["package.json"]))).toContain("package.json");
	});

	it("detects a PHP project via composer.json", () => {
		expect(findProjectMarkers(makeDir(["composer.json"]))).toContain("composer.json");
	});

	it("detects a Python project via pyproject.toml", () => {
		expect(findProjectMarkers(makeDir(["pyproject.toml"]))).toContain("pyproject.toml");
	});

	it("detects a Rust project via Cargo.toml", () => {
		expect(findProjectMarkers(makeDir(["Cargo.toml"]))).toContain("Cargo.toml");
	});

	it("detects a Go project via go.mod", () => {
		expect(findProjectMarkers(makeDir(["go.mod"]))).toContain("go.mod");
	});

	it("detects a JVM project via pom.xml / build.gradle", () => {
		expect(findProjectMarkers(makeDir(["pom.xml"]))).toContain("pom.xml");
		expect(findProjectMarkers(makeDir(["build.gradle"]))).toContain("build.gradle");
	});

	it("detects a Flutter project via pubspec.yaml", () => {
		expect(findProjectMarkers(makeDir(["pubspec.yaml"]))).toContain("pubspec.yaml");
	});

	it("detects a .NET project via a *.csproj suffix", () => {
		expect(findProjectMarkers(makeDir(["MyApp.csproj"]))).toContain("MyApp.csproj");
	});

	it("detects an Xcode project via a *.xcodeproj suffix", () => {
		expect(findProjectMarkers(makeDir(["App.xcodeproj"]))).toContain("App.xcodeproj");
	});

	it("detects a bare git repository via .git", () => {
		expect(findProjectMarkers(makeDir([".git/config"]))).toContain(".git");
	});

	it("matches marker files case-insensitively (Makefile / CMakeLists.txt)", () => {
		expect(findProjectMarkers(makeDir(["Makefile"]))).toContain("Makefile");
		expect(findProjectMarkers(makeDir(["CMakeLists.txt"]))).toContain("CMakeLists.txt");
	});

	it("returns an empty array for a directory with no markers", () => {
		expect(findProjectMarkers(makeDir(["random.txt", "notes.md"]))).toEqual([]);
	});

	it("returns an empty array when the directory cannot be read", () => {
		expect(findProjectMarkers("/nonexistent/definitely/not/here")).toEqual([]);
	});

	it("only inspects the TOP LEVEL (a nested manifest is not a marker)", () => {
		expect(findProjectMarkers(makeDir(["sub/package.json"]))).toEqual([]);
	});
});

describe("isNonProjectRoot", () => {
	it("treats the home directory as a non-project root", () => {
		expect(isNonProjectRoot(os.homedir())).toBe(true);
	});

	it("treats the home directory's parent as a non-project root", () => {
		expect(isNonProjectRoot(path.dirname(os.homedir()))).toBe(true);
	});

	it("treats the filesystem root as a non-project root", () => {
		expect(isNonProjectRoot(path.parse(process.cwd()).root)).toBe(true);
	});

	it("does not treat an ordinary project directory as a non-project root", () => {
		expect(isNonProjectRoot(makeDir(["package.json"]))).toBe(false);
	});
});

describe("evaluateAutoIndexTarget", () => {
	it("is eligible for a directory that carries a project marker", () => {
		const dir = makeDir(["package.json"]);
		const result = evaluateAutoIndexTarget(dir);
		expect(result.eligible).toBe(true);
		expect(result.reason).toBeUndefined();
		expect(result.markers).toContain("package.json");
	});

	it("is NOT eligible for a marker-less directory (not_a_project)", () => {
		const dir = makeDir(["random.txt"]);
		const result = evaluateAutoIndexTarget(dir);
		expect(result.eligible).toBe(false);
		expect(result.reason).toBe("not_a_project");
	});

	it("is NOT eligible for the home directory EVEN IF it carries a marker", () => {
		// A stray ~/package.json must not re-enable indexing the whole home tree.
		const fakeHome = makeDir(["package.json", "composer.json"]);
		vi.spyOn(os, "homedir").mockReturnValue(fakeHome);

		const result = evaluateAutoIndexTarget(fakeHome);
		expect(result.eligible).toBe(false);
		expect(result.reason).toBe("non_project_root");
		// The markers are still reported for observability.
		expect(result.markers).toContain("package.json");
	});

	it("is NOT eligible for the filesystem root", () => {
		const root = path.parse(process.cwd()).root;
		const result = evaluateAutoIndexTarget(root);
		expect(result.eligible).toBe(false);
		expect(result.reason).toBe("non_project_root");
	});
});
