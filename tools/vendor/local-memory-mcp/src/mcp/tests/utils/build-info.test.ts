/**
 * Unit tests for the PERF-009 build-identity resolver.
 *
 * The resolver answers "which build is this process running?" — the guard that
 * makes a stale daemon detectable. These tests drive `resolveBuildInfo` against
 * temp directories (never the repo tree) so the stamp/package/git precedence is
 * pinned without depending on the host's git state.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatBuildInfo, resolveBuildInfo } from "../../utils/build-info";

const dirs: string[] = [];

/** Create an isolated temp directory that is cleaned up after the test. */
function tmpDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perf009-build-info-"));
	dirs.push(dir);
	return dir;
}

/** Write `daemon-build.json` into `dir`. */
function writeStamp(dir: string, stamp: unknown): void {
	fs.writeFileSync(path.join(dir, "daemon-build.json"), JSON.stringify(stamp), "utf8");
}

/** Write a `package.json` with the given version into `dir`. */
function writePackage(dir: string, version: string): void {
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", version }), "utf8");
}

afterEach(() => {
	while (dirs.length > 0) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("resolveBuildInfo", () => {
	it("prefers the build stamp (version + sha + builtAt) when present", () => {
		const dir = tmpDir();
		writePackage(dir, "9.9.9");
		writeStamp(dir, { version: "1.2.3", gitSha: "abc1234", builtAt: "2026-09-21T10:00:00.000Z" });

		const info = resolveBuildInfo(dir, dir);

		expect(info).toEqual({
			version: "1.2.3",
			gitSha: "abc1234",
			builtAt: "2026-09-21T10:00:00.000Z",
			source: "stamp"
		});
	});

	it("finds the stamp in a parent directory (dist/ under the repo root)", () => {
		const root = tmpDir();
		const nested = path.join(root, "dist", "mcp");
		fs.mkdirSync(nested, { recursive: true });
		writeStamp(root, { version: "2.0.0", gitSha: "deadbee", builtAt: null });

		const info = resolveBuildInfo(nested, nested);

		expect(info.source).toBe("stamp");
		expect(info.version).toBe("2.0.0");
		expect(info.gitSha).toBe("deadbee");
		expect(info.builtAt).toBeNull();
	});

	it("falls back to package.json when no stamp exists", () => {
		const dir = tmpDir();
		writePackage(dir, "0.48.1");

		const info = resolveBuildInfo(dir, dir);

		expect(info.version).toBe("0.48.1");
		expect(info.source).toBe("runtime");
		expect(info.builtAt).toBeNull();
	});

	it("degrades to 'unknown' when neither stamp nor package.json is found", () => {
		// A bare temp dir has no package.json within the search depth.
		const dir = tmpDir();

		const info = resolveBuildInfo(dir, dir);

		expect(info.version).toBe("unknown");
		expect(info.source).toBe("runtime");
	});

	it("ignores a stamp missing a version and falls back to package.json", () => {
		const dir = tmpDir();
		writePackage(dir, "3.3.3");
		writeStamp(dir, { gitSha: "abc1234", builtAt: "2026-09-21T10:00:00.000Z" });

		const info = resolveBuildInfo(dir, dir);

		expect(info.version).toBe("3.3.3");
		expect(info.source).toBe("runtime");
	});

	it("ignores a corrupt stamp rather than throwing", () => {
		const dir = tmpDir();
		writePackage(dir, "4.4.4");
		fs.writeFileSync(path.join(dir, "daemon-build.json"), "{ not json", "utf8");

		const info = resolveBuildInfo(dir, dir);

		expect(info.version).toBe("4.4.4");
		expect(info.source).toBe("runtime");
	});

	it("never throws when git is unavailable (non-repo cwd)", () => {
		const dir = tmpDir();
		writePackage(dir, "5.0.0");

		// A bare temp dir is not a git repo; `git rev-parse` fails → gitSha null.
		expect(() => resolveBuildInfo(dir, dir)).not.toThrow();
		expect(resolveBuildInfo(dir, dir).gitSha).toBeNull();
	});
});

describe("formatBuildInfo", () => {
	it("renders version + sha + source", () => {
		expect(formatBuildInfo({ version: "0.48.1", gitSha: "d8dd97a", builtAt: null, source: "stamp" })).toBe(
			"0.48.1+d8dd97a [stamp]"
		);
	});

	it("omits the sha when unavailable", () => {
		expect(formatBuildInfo({ version: "0.48.1", gitSha: null, builtAt: null, source: "runtime" })).toBe(
			"0.48.1 [runtime]"
		);
	});

	it("includes the build timestamp when stamped", () => {
		expect(
			formatBuildInfo({
				version: "0.48.1",
				gitSha: "d8dd97a",
				builtAt: "2026-09-21T10:00:00.000Z",
				source: "stamp"
			})
		).toBe("0.48.1+d8dd97a [stamp built 2026-09-21T10:00:00.000Z]");
	});
});
