/**
 * Unit tests for the file-based config loader (FEAT-DAEMON-002A).
 *
 * Covers the precedence contract (explicit env > config.jsonc > .env >
 * built-in default), JSONC comment/trailing-comma parsing, malformed input,
 * missing files, and dotenv parsing. All file side effects are confined to a
 * per-test temp dir; `process.env` is never mutated (an explicit `env` object
 * is injected instead).
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfigFileEnv, parseDotEnv, parseJsonc, resolveConfigDir, stripJsonc } from "../utils/config-file";

const tempDirs: string[] = [];

function makeDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmc-config-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

describe("config-file — resolveConfigDir", () => {
	it("prefers LOCAL_MEMORY_DAEMON_DIR", () => {
		expect(resolveConfigDir({ LOCAL_MEMORY_DAEMON_DIR: "/tmp/explicit", MEMORY_DB_PATH: "/tmp/db/memory.db" })).toBe(
			"/tmp/explicit"
		);
	});

	it("derives the dir from a non-memory MEMORY_DB_PATH", () => {
		expect(resolveConfigDir({ MEMORY_DB_PATH: "/tmp/db/memory.db" })).toBe("/tmp/db");
	});

	it("ignores an in-memory MEMORY_DB_PATH and uses the platform config dir", () => {
		expect(resolveConfigDir({ MEMORY_DB_PATH: ":memory:" }, "linux")).toContain("local-memory-mcp");
	});

	it("uses the platform-standard directory per platform", () => {
		expect(resolveConfigDir({}, "linux")).toBe(path.join(os.homedir(), ".config", "local-memory-mcp"));
		expect(resolveConfigDir({}, "darwin")).toBe(
			path.join(os.homedir(), "Library", "Application Support", "local-memory-mcp")
		);
		expect(resolveConfigDir({}, "win32")).toBe(path.join(os.homedir(), ".local-memory-mcp"));
	});
});

describe("config-file — stripJsonc / parseJsonc", () => {
	it("strips line and block comments", () => {
		const input = `{
			// a line comment
			"a": 1, /* a block
			comment */ "b": 2
		}`;
		expect(JSON.parse(stripJsonc(input))).toEqual({ a: 1, b: 2 });
	});

	it("removes trailing commas in objects and arrays", () => {
		expect(parseJsonc('{ "a": [1, 2, 3,], "b": 2, }')).toEqual({ a: [1, 2, 3], b: 2 });
	});

	it("does not treat comment markers inside strings as comments", () => {
		const parsed = parseJsonc('{ "url": "http://example.com/x", "note": "a /* b */ c" }');
		expect(parsed).toEqual({ url: "http://example.com/x", note: "a /* b */ c" });
	});

	it("preserves escaped quotes inside strings", () => {
		expect(parseJsonc('{ "k": "a \\" // b" }')).toEqual({ k: 'a " // b' });
	});

	it("returns undefined for malformed JSON", () => {
		expect(parseJsonc("{ not valid")).toBeUndefined();
	});

	it("returns undefined for non-object JSON", () => {
		expect(parseJsonc("[1, 2, 3]")).toBeUndefined();
		expect(parseJsonc('"just a string"')).toBeUndefined();
	});
});

describe("config-file — parseDotEnv", () => {
	it("parses simple KEY=VALUE pairs, ignoring blank/comment lines", () => {
		const env = parseDotEnv(["# comment", "", "FOO=bar", "  BAZ = qux  "].join("\n"));
		expect(env).toEqual({ FOO: "bar", BAZ: "qux" });
	});

	it("supports export, quoted values, and inline comments", () => {
		const env = parseDotEnv(
			["export EXPORTED=yes", 'DQ="hello world"', "SQ='single'", "INLINE=value # trailing"].join("\n")
		);
		expect(env).toEqual({ EXPORTED: "yes", DQ: "hello world", SQ: "single", INLINE: "value" });
	});

	it("processes escapes in double-quoted values only", () => {
		const env = parseDotEnv('ESC="a\\nb\\tc"');
		expect(env.ESC).toBe("a\nb\tc");
	});

	it("handles CRLF line endings", () => {
		expect(parseDotEnv("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
	});

	it("ignores lines without a valid KEY=", () => {
		expect(parseDotEnv("no-equals\n1INVALID=x\nGOOD=1")).toEqual({ GOOD: "1" });
	});
});

describe("config-file — loadConfigFileEnv precedence", () => {
	it("fills keys from config.jsonc and .env when the env is empty", () => {
		const dir = makeDir();
		fs.writeFileSync(path.join(dir, "config.jsonc"), '{ "FROM_JSONC": "jsonc", "SHARED": "jsonc" }');
		fs.writeFileSync(path.join(dir, ".env"), "FROM_DOTENV=dotenv\nSHARED=dotenv\n");

		const env: NodeJS.ProcessEnv = {};
		const result = loadConfigFileEnv({ configDir: dir, env });

		expect(env.FROM_JSONC).toBe("jsonc");
		expect(env.FROM_DOTENV).toBe("dotenv");
		// config.jsonc wins over .env for a key present in both.
		expect(env.SHARED).toBe("jsonc");
		expect(result.loadedJsonc).toBe(true);
		expect(result.loadedDotenv).toBe(true);
	});

	it("never overrides an explicit env value (explicit env > config file)", () => {
		const dir = makeDir();
		fs.writeFileSync(path.join(dir, "config.jsonc"), '{ "EXPLICIT": "from-file" }');
		fs.writeFileSync(path.join(dir, ".env"), "EXPLICIT=from-dotenv\nOTHER=file\n");

		const env: NodeJS.ProcessEnv = { EXPLICIT: "from-process" };
		loadConfigFileEnv({ configDir: dir, env });

		expect(env.EXPLICIT).toBe("from-process");
		expect(env.OTHER).toBe("file");
	});

	it("is a no-op (defaults apply) when no config files exist", () => {
		const dir = makeDir();
		const env: NodeJS.ProcessEnv = {};
		const result = loadConfigFileEnv({ configDir: dir, env });
		expect(env).toEqual({});
		expect(result.applied).toEqual([]);
		expect(result.loadedJsonc).toBe(false);
		expect(result.loadedDotenv).toBe(false);
	});

	it("ignores a malformed config.jsonc and still loads .env", () => {
		const dir = makeDir();
		fs.writeFileSync(path.join(dir, "config.jsonc"), "{ this is not json");
		fs.writeFileSync(path.join(dir, ".env"), "FALLBACK=ok\n");

		const env: NodeJS.ProcessEnv = {};
		const result = loadConfigFileEnv({ configDir: dir, env });

		expect(env.FALLBACK).toBe("ok");
		expect(result.loadedJsonc).toBe(false);
		expect(result.loadedDotenv).toBe(true);
	});

	it("skips non-scalar jsonc values and records only applied key names", () => {
		const dir = makeDir();
		fs.writeFileSync(
			path.join(dir, "config.jsonc"),
			'{ "STR": "s", "NUM": 42, "BOOL": true, "OBJ": { "nested": 1 }, "ARR": [1, 2] }'
		);

		const env: NodeJS.ProcessEnv = {};
		const result = loadConfigFileEnv({ configDir: dir, env });

		expect(env.STR).toBe("s");
		expect(env.NUM).toBe("42");
		expect(env.BOOL).toBe("true");
		expect(env.OBJ).toBeUndefined();
		expect(env.ARR).toBeUndefined();
		expect(result.applied.sort()).toEqual(["BOOL", "NUM", "STR"]);
	});

	it("creates the config directory when missing", () => {
		const parent = makeDir();
		const dir = path.join(parent, "nested", "config");
		expect(fs.existsSync(dir)).toBe(false);
		loadConfigFileEnv({ configDir: dir, env: {} });
		expect(fs.existsSync(dir)).toBe(true);
	});
});
