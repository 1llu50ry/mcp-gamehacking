/**
 * File-based configuration loader (FEAT-DAEMON-002A).
 *
 * The daemon and MCP server read configuration from the environment. For
 * interactive/agent use it is convenient to keep that configuration on disk,
 * next to the memory database and daemon PID/log files, instead of exporting
 * dozens of variables in every shell or MCP client config. This module loads
 * two optional files from the resolved config directory:
 *
 *   1. `<configDir>/config.jsonc` — a flat JSON object (JSONC: `//` and
 *      `/* *\/` comments + trailing commas allowed). Keys are env var names.
 *   2. `<configDir>/.env` — a dotenv-style `KEY=VALUE` file.
 *
 * PRECEDENCE (highest wins):
 *
 *     explicit process env  >  config.jsonc  >  .env  >  built-in default
 *
 * "Explicit env wins" is enforced by only ever filling keys that are NOT
 * already present in the target env object; `config.jsonc` is applied before
 * `.env`, so a key defined in both files keeps the `config.jsonc` value.
 *
 * The loader is intentionally dependency-free (Node built-ins only) so it can
 * be imported at the very TOP of the generated `bin/mcp-memory-server.js`
 * BEFORE any bundled module — in particular `utils/constants.ts`, which reads
 * `process.env` at module-evaluation time — is evaluated. Missing or malformed
 * files are a silent no-op: defaults apply and nothing crashes. Secret values
 * are NEVER logged.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A flat map of env var name → string value. */
export type EnvMap = Record<string, string>;

/** Result of {@link loadConfigFileEnv}. */
export interface LoadConfigFileResult {
	/** Directory that was searched for `config.jsonc` / `.env`. */
	configDir: string;
	/** Names (never values) of env keys filled in from a config file. */
	applied: string[];
	/** Whether a readable `config.jsonc` contributed at least one key. */
	loadedJsonc: boolean;
	/** Whether a readable `.env` contributed at least one key. */
	loadedDotenv: boolean;
}

/** Options for {@link loadConfigFileEnv}. */
export interface LoadConfigFileOptions {
	/** Config directory to read from. Defaults to {@link resolveConfigDir}. */
	configDir?: string;
	/** Target env object to fill. Defaults to `process.env`. */
	env?: NodeJS.ProcessEnv;
	/**
	 * Create the config directory when it is missing. Defaults to `true` so the
	 * daemon's first run establishes the directory an operator will drop files
	 * into.
	 */
	createDir?: boolean;
}

/**
 * Resolve the config directory (same directory as `memory.db`).
 *
 * Single source of truth shared with the daemon's path resolver
 * (`resolveDaemonDir` in `cli/daemon.ts`), which delegates here. An explicit
 * `LOCAL_MEMORY_DAEMON_DIR` wins; otherwise a non-memory `MEMORY_DB_PATH`
 * contributes its directory, and finally the platform-standard config dir is
 * used (Linux `~/.config/local-memory-mcp`).
 */
export function resolveConfigDir(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform
): string {
	const explicit = env.LOCAL_MEMORY_DAEMON_DIR?.trim();
	if (explicit) return explicit;

	const dbPath = env.MEMORY_DB_PATH?.trim();
	if (dbPath && dbPath !== ":memory:") return path.dirname(dbPath);

	if (platform === "win32") return path.join(os.homedir(), ".local-memory-mcp");
	if (platform === "darwin") {
		return path.join(os.homedir(), "Library", "Application Support", "local-memory-mcp");
	}
	return path.join(os.homedir(), ".config", "local-memory-mcp");
}

/**
 * Strip JSONC comments (`//` line + `/* *\/` block) and trailing commas from
 * `text`, returning strict JSON. String literals (including escapes) are
 * preserved verbatim — a `//` or `,` inside a quoted string is never touched.
 *
 * This is a tiny, dependency-free stand-in for a full JSONC parser (the repo
 * has no JSONC dependency; adding one is not justified for this).
 */
export function stripJsonc(text: string): string {
	let out = "";
	let inString = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		const next = text[i + 1];

		if (inLineComment) {
			if (ch === "\n") {
				inLineComment = false;
				out += ch;
			}
			continue;
		}
		if (inBlockComment) {
			if (ch === "*" && next === "/") {
				inBlockComment = false;
				i++; // consume the '/'
			}
			continue;
		}
		if (inString) {
			out += ch;
			if (ch === "\\") {
				// Preserve the escaped character as-is.
				if (next !== undefined) {
					out += next;
					i++;
				}
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}

		// Not in a string or comment.
		if (ch === '"') {
			inString = true;
			out += ch;
		} else if (ch === "/" && next === "/") {
			inLineComment = true;
			i++;
		} else if (ch === "/" && next === "*") {
			inBlockComment = true;
			i++;
		} else if (ch === ",") {
			// Drop a trailing comma: look ahead past whitespace for `}` or `]`.
			let j = i + 1;
			while (j < text.length && /\s/.test(text[j])) j++;
			const following = text[j];
			if (following === "}" || following === "]") {
				continue; // skip this comma
			}
			out += ch;
		} else {
			out += ch;
		}
	}

	return out;
}

/**
 * Parse a JSONC document. Returns `undefined` when the input is not valid
 * JSONC or does not decode to a JSON object (a flat key/value map is expected).
 * Never throws.
 */
export function parseJsonc(text: string): Record<string, unknown> | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripJsonc(text));
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
	return parsed as Record<string, unknown>;
}

/**
 * Convert a parsed `config.jsonc` value to an env string. Primitives are
 * stringified; `null`, arrays, and nested objects are not valid env values and
 * are skipped (returns `undefined`).
 */
function jsoncValueToEnv(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "boolean") return String(value);
	return undefined;
}

/** A valid dotenv key: `[A-Za-z_][A-Za-z0-9_]*`. */
const DOTENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse a dotenv-style file into a flat map.
 *
 * Supports: blank lines, `#` comment lines, `export KEY=VALUE`, single- and
 * double-quoted values (quotes stripped; double quotes process `\n`, `\r`,
 * `\t`, `\\`, `\"`), inline `#` comments on unquoted values, and CRLF line
 * endings. Lines without a valid `KEY=` are ignored. Never throws.
 */
export function parseDotEnv(text: string): EnvMap {
	const result: EnvMap = {};
	for (const rawLine of text.split(/\r?\n/)) {
		let line = rawLine.trim();
		if (line === "" || line.startsWith("#")) continue;
		if (line.startsWith("export ")) line = line.slice("export ".length).trimStart();

		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		if (!DOTENV_KEY.test(key)) continue;

		let value = line.slice(eq + 1).trim();
		const first = value[0];
		if (first === '"' || first === "'") {
			// Quoted value: find the matching closing quote.
			const closing = value.indexOf(first, 1);
			if (closing !== -1) {
				const inner = value.slice(1, closing);
				value = first === '"' ? unescapeDoubleQuoted(inner) : inner;
			} else {
				// Unterminated quote — take the remainder literally.
				value = value.slice(1);
			}
		} else {
			// Unquoted: strip an inline comment introduced by ` #`.
			const hash = value.search(/\s#/);
			if (hash !== -1) value = value.slice(0, hash).trimEnd();
		}
		result[key] = value;
	}
	return result;
}

/** Process backslash escapes inside a double-quoted dotenv value. */
function unescapeDoubleQuoted(inner: string): string {
	let out = "";
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === "\\" && i + 1 < inner.length) {
			const next = inner[++i];
			if (next === "n") out += "\n";
			else if (next === "r") out += "\r";
			else if (next === "t") out += "\t";
			else out += next; // \\ → \, \" → ", \' → ', etc.
		} else {
			out += ch;
		}
	}
	return out;
}

/** Read a file as UTF-8, or `undefined` when it is missing/unreadable. */
function readFileOrUndefined(filePath: string): string | undefined {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch {
		return undefined;
	}
}

/**
 * Load `config.jsonc` then `.env` from `configDir` and fill the target env with
 * any key not already present (explicit env wins; `config.jsonc` wins over
 * `.env`). Missing/malformed files are a silent no-op. Never logs values.
 */
export function loadConfigFileEnv(options: LoadConfigFileOptions = {}): LoadConfigFileResult {
	const env = options.env ?? process.env;
	const configDir = options.configDir ?? resolveConfigDir(env);
	const result: LoadConfigFileResult = { configDir, applied: [], loadedJsonc: false, loadedDotenv: false };

	if (options.createDir !== false) {
		try {
			fs.mkdirSync(configDir, { recursive: true });
		} catch {
			/* best effort — a read-only dir still gets read below */
		}
	}

	const fill = (key: string, value: string): boolean => {
		if (env[key] !== undefined) return false; // explicit env (or earlier file) wins
		env[key] = value;
		return true;
	};

	// 1. config.jsonc (highest file precedence).
	const jsoncText = readFileOrUndefined(path.join(configDir, "config.jsonc"));
	if (jsoncText !== undefined) {
		const parsed = parseJsonc(jsoncText);
		if (parsed) {
			for (const [key, raw] of Object.entries(parsed)) {
				if (!DOTENV_KEY.test(key)) continue;
				const value = jsoncValueToEnv(raw);
				if (value === undefined) continue;
				if (fill(key, value)) {
					result.applied.push(key);
					result.loadedJsonc = true;
				}
			}
		}
	}

	// 2. .env (lower file precedence).
	const dotenvText = readFileOrUndefined(path.join(configDir, ".env"));
	if (dotenvText !== undefined) {
		const parsed = parseDotEnv(dotenvText);
		for (const [key, value] of Object.entries(parsed)) {
			if (fill(key, value)) {
				result.applied.push(key);
				result.loadedDotenv = true;
			}
		}
	}

	return result;
}
