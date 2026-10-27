/**
 * `daemon` CLI subcommand (FEAT-DAEMON-001).
 *
 * Turns the local-memory-mcp combined server (dashboard + MCP Streamable HTTP
 * on ONE loopback port) into a true background daemon:
 *
 *   daemon            → fork the worker detached, write its PID, print, exit
 *   daemon stop       → SIGTERM the PID from the file, delete it, print
 *   daemon status     → print "running (pid N)" or "not running"
 *   daemon install    → register the worker with the OS service manager
 *                       (`--force` overwrites; `--working-dir <path>` seeds the
 *                        service WorkingDirectory — FIX-110-B)
 *   daemon uninstall  → deregister it again
 *
 * `install`/`uninstall` are cross-platform (FEAT-DAEMON-001 extension):
 *   - Linux   → systemd user unit (`systemctl --user`), cron `@reboot` fallback
 *   - macOS   → launchd LaunchAgent plist (`launchctl`), manual hint fallback
 *   - Windows → Task Scheduler (`schtasks.exe`), Startup-folder hint fallback
 * All three register an absolute command so the service survives a reboot.
 *
 * The parent NEVER keeps the worker attached: the worker is spawned with
 * `detached: true`, its stdout/stderr redirected to the daemon log file, then
 * `unref()`ed so the parent can exit and the terminal returns to the prompt.
 * The worker itself is re-entered through `--daemon-worker`
 * (see {@link ../cli/combined-server}).
 *
 * PID / log location: alongside the memory database (see
 * {@link resolveDaemonDir}), i.e. `~/.config/local-memory-mcp/daemon.pid` and
 * `~/.config/local-memory-mcp/daemon.log` on Linux. `MEMORY_DB_PATH` (used by
 * tests) and `LOCAL_MEMORY_DAEMON_DIR` relocate both.
 *
 * SINGLE-INSTANCE GUARD (TASK-425): beyond the PID file, a `daemon.lock` file
 * is acquired ATOMICALLY (`O_CREAT | O_EXCL`) BEFORE the worker is forked. This
 * closes the check-then-bind race in which two `daemon start` invocations both
 * passed the PID liveness check and then raced to bind the port, leaving one to
 * crash-loop on `EADDRINUSE`. Stale locks (dead owner) are reclaimed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { loadConfigFileEnv, resolveConfigDir, type EnvMap } from "../utils/config-file";

/** Absolute paths the daemon manages. */
export interface DaemonPaths {
	/** Config directory (same dir as memory.db). */
	dir: string;
	/** PID file path. */
	pidFile: string;
	/** Worker stdout+stderr log file path. */
	logFile: string;
	/**
	 * Single-instance lock file path (TASK-425). Held for the daemon's whole
	 * lifetime; acquired atomically before the worker is forked.
	 */
	lockFile: string;
}

/** Outcome of {@link startDaemon}. */
export interface StartDaemonResult {
	/** Whether a new worker was forked. `false` when one was already running. */
	started: boolean;
	/** PID of the running/forked worker. */
	pid: number;
}

/** Outcome of {@link stopDaemon}. */
export interface StopDaemonResult {
	/** Whether a live process was signalled. */
	stopped: boolean;
	/** PID that was targeted, when a PID file existed. */
	pid?: number;
}

/** Outcome of {@link statusDaemon}. */
export interface StatusDaemonResult {
	running: boolean;
	pid: number | null;
}

/** Injectable seams (all default to the real process/filesystem). */
export interface DaemonIo {
	log: (message: string) => void;
	spawnFn: typeof spawn;
	kill: (pid: number, signal: NodeJS.Signals) => void;
	isAlive: (pid: number) => boolean;
	execPath: string;
	workerArg: string;
}

function defaultIo(): DaemonIo {
	return {
		log: (message) => process.stdout.write(`${message}\n`),
		spawnFn: spawn,
		kill: (pid, signal) => process.kill(pid, signal),
		isAlive: isProcessAlive,
		execPath: process.execPath,
		// process.argv[1] is the bin entry (bin/mcp-memory-server.js) that
		// re-imports dist/mcp/server.js. Re-exec'ing it with `--daemon-worker`
		// re-enters this module's worker branch.
		workerArg: process.argv[1] ?? ""
	};
}

/**
 * Outcome of a lock acquisition attempt (TASK-425).
 *
 * `acquired` is `true` when this call created the lock file (we now own it).
 * When the lock was already held by a LIVE process, `acquired` is `false` and
 * `pid` is the recorded owner pid (or `null` when the lock file had no pid).
 */
export interface AcquireLockResult {
	acquired: boolean;
	pid: number | null;
}

/**
 * Read the pid recorded in a lock file, or `null` when it is absent/empty/not
 * a positive integer. The lock file body is the owning pid (same format as the
 * PID file), so {@link readDaemonPid} is reused.
 */
export function readLockPid(lockFile: string): number | null {
	return readDaemonPid(lockFile);
}

/**
 * Try to acquire the single-instance lock ATOMICALLY.
 *
 * Uses `fs.openSync(lockFile, "wx")` (`O_CREAT | O_EXCL`): the exclusive
 * create either succeeds (we own the lock) or fails with `EEXIST` (another
 * instance holds it). This is a single atomic syscall, so it closes the
 * check-then-bind race that the PID-file + `process.kill(pid, 0)` scheme left
 * open (two `daemon start`s could both pass the liveness check and then race to
 * bind the port → one crash-loops on `EADDRINUSE`).
 *
 * On `EEXIST` the recorded owner pid is read and its liveness checked via
 * {@link DaemonIo.isAlive}:
 *   - LIVE  → return `{acquired:false, pid}` (caller reports "already running").
 *   - STALE → remove the lock file and retry the exclusive create exactly once.
 *
 * The owning pid is written into the lock file so a later stale-lock recovery
 * (and `stop`) can identify the holder.
 */
export function acquireLock(
	lockFile: string,
	io: Pick<DaemonIo, "isAlive">,
	pid: number = process.pid
): AcquireLockResult {
	fs.mkdirSync(path.dirname(lockFile), { recursive: true });

	const attempt = (): AcquireLockResult | null => {
		try {
			const fd = fs.openSync(lockFile, "wx");
			try {
				fs.writeSync(fd, `${pid}\n`);
			} finally {
				fs.closeSync(fd);
			}
			return { acquired: true, pid };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
			throw error;
		}
	};

	const first = attempt();
	if (first !== null) return first;

	// Lock file already exists — inspect the recorded owner.
	const owner = readLockPid(lockFile);
	if (owner !== null && io.isAlive(owner)) {
		return { acquired: false, pid: owner };
	}

	// Stale lock (dead owner or unreadable/empty body): remove and retry once.
	removeLock(lockFile);
	const second = attempt();
	if (second !== null) return second;
	// Lost the retry race — another process re-acquired between our remove and
	// create. Report its pid when readable.
	return { acquired: false, pid: readLockPid(lockFile) };
}

/** Best-effort removal of the single-instance lock file (TASK-425). */
export function removeLock(lockFile: string): void {
	try {
		fs.unlinkSync(lockFile);
	} catch {
		/* already gone — best effort */
	}
}

/**
 * Resolve the daemon config directory.
 *
 * Mirrors `SQLiteStore`'s DB-path resolution so the PID/log files always sit
 * next to `memory.db`. An explicit `LOCAL_MEMORY_DAEMON_DIR` wins; otherwise a
 * non-memory `MEMORY_DB_PATH` contributes its directory, and finally the
 * platform-standard config dir is used (Linux `~/.config/local-memory-mcp`).
 */
export function resolveDaemonDir(env: NodeJS.ProcessEnv = process.env): string {
	// Single source of truth: `utils/config-file.ts` (FEAT-DAEMON-002A) owns the
	// config-dir resolution because the file-based config loader reads
	// `config.jsonc` / `.env` from the same directory. Delegating keeps the
	// PID/log/lock files and the config files co-located by construction.
	return resolveConfigDir(env);
}

/** Resolve the PID + log + lock file paths for the daemon. */
export function resolveDaemonPaths(env: NodeJS.ProcessEnv = process.env): DaemonPaths {
	const dir = resolveDaemonDir(env);
	return {
		dir,
		pidFile: path.join(dir, "daemon.pid"),
		logFile: path.join(dir, "daemon.log"),
		lockFile: path.join(dir, "daemon.lock")
	};
}

/**
 * Read the daemon PID from the PID file, or `null` when the file is absent,
 * empty, or does not contain a positive integer.
 */
export function readDaemonPid(pidFile: string): number | null {
	try {
		const raw = fs.readFileSync(pidFile, "utf8").trim();
		const pid = Number.parseInt(raw, 10);
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

/** Persist the daemon PID (creates the directory when missing). */
export function writeDaemonPid(pidFile: string, pid: number): void {
	fs.mkdirSync(path.dirname(pidFile), { recursive: true });
	fs.writeFileSync(pidFile, `${pid}\n`, "utf8");
}

/** Best-effort PID-file removal. */
export function removeDaemonPid(pidFile: string): void {
	try {
		fs.unlinkSync(pidFile);
	} catch {
		/* already gone — best effort */
	}
}

/**
 * Whether a process with `pid` is alive. `process.kill(pid, 0)` performs the
 * existence check without delivering a signal; `EPERM` means the process
 * exists but is owned by another user, so it counts as alive.
 */
export function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** Overwrite the pid recorded in the lock file (best effort). */
export function writeLockPid(lockFile: string, pid: number): void {
	try {
		fs.writeFileSync(lockFile, `${pid}\n`, "utf8");
	} catch {
		/* best effort — liveness still tracked via the PID file */
	}
}

/**
 * Fork the detached worker, write its PID, and report.
 *
 * Single-instance guard (TASK-425): the PID file is cleaned of a stale entry,
 * a live PID is reported idempotently, and then the single-instance lock is
 * acquired ATOMICALLY (see {@link acquireLock}) BEFORE the fork — closing the
 * check-then-bind race that allowed a second daemon to start and crash-loop on
 * `EADDRINUSE`. When the lock is held by a live process, the existing PID is
 * reported (no fork). The worker's stdout and stderr are redirected to the
 * daemon log file; the inherited log descriptor is closed in the parent
 * immediately after spawn.
 */
export function startDaemon(options: { paths?: DaemonPaths; io?: Partial<DaemonIo> } = {}): StartDaemonResult {
	const paths = options.paths ?? resolveDaemonPaths();
	const io = { ...defaultIo(), ...options.io };

	// 1. Clean a stale PID file (recorded process is gone) before doing anything.
	const existing = readDaemonPid(paths.pidFile);
	if (existing !== null && io.isAlive(existing)) {
		io.log(`Daemon already running (pid ${existing})`);
		return { started: false, pid: existing };
	}
	if (existing !== null) removeDaemonPid(paths.pidFile);

	// 2. Acquire the single-instance lock atomically BEFORE binding/forking.
	// FIX-025: an fs failure here (permissions, vanished config dir) must be an
	// actionable message, not an uncaught stack trace out of the CLI.
	let lock: AcquireLockResult;
	try {
		lock = acquireLock(paths.lockFile, io);
	} catch (error) {
		throw new Error(
			`Failed to acquire the daemon single-instance lock at ${paths.lockFile}: ` +
				`${error instanceof Error ? error.message : String(error)}. ` +
				"Check that the config directory is writable, then retry.",
			{ cause: error }
		);
	}
	if (!lock.acquired) {
		const owner = lock.pid ?? readDaemonPid(paths.pidFile) ?? 0;
		io.log(`Daemon already running (pid ${owner})`);
		return { started: false, pid: owner };
	}

	// 3. Fork. On any spawn failure the lock must be released so a retry works.
	fs.mkdirSync(paths.dir, { recursive: true });

	// FEAT-DAEMON-002A: merge file-based config (config.jsonc then .env) from the
	// resolved config dir into process.env so the forked worker inherits it.
	// Explicit env vars always win; a missing/malformed file is a silent no-op.
	// This also guarantees the child sees the config even when it is re-exec'd
	// through a code path that does not load it itself.
	loadConfigFileEnv({ configDir: paths.dir });

	let child: ChildProcess;
	try {
		const logFd = fs.openSync(paths.logFile, "a");
		try {
			child = io.spawnFn(io.execPath, [io.workerArg, "--daemon-worker"], {
				detached: true,
				shell: false,
				windowsHide: true,
				stdio: ["ignore", logFd, logFd],
				env: { ...process.env },
				cwd: process.cwd()
			});
		} finally {
			// The child holds its own duplicate of the descriptor; the parent's
			// copy must be closed or it would keep the log file open for the
			// process' (short) lifetime.
			fs.closeSync(logFd);
		}
	} catch (error) {
		removeLock(paths.lockFile);
		throw error;
	}

	const pid = child.pid ?? 0;
	if (pid > 0) {
		writeDaemonPid(paths.pidFile, pid);
		// The parent exits right after the fork, so the lock must record the
		// WORKER's pid — otherwise a later start would see the dead parent as a
		// stale holder while the worker is still serving.
		writeLockPid(paths.lockFile, pid);
	}
	child.unref();
	io.log(`Daemon started (pid ${pid})`);
	return { started: true, pid };
}

/**
 * Stop the daemon: SIGTERM the recorded PID, remove the PID file, and release
 * the single-instance lock.
 *
 * A missing PID file, or a stale PID whose process is already gone, is
 * reported as "Daemon not running" (and the stale PID/lock files are cleaned
 * up).
 */
export function stopDaemon(options: { paths?: DaemonPaths; io?: Partial<DaemonIo> } = {}): StopDaemonResult {
	const paths = options.paths ?? resolveDaemonPaths();
	const io = { ...defaultIo(), ...options.io };

	const pid = readDaemonPid(paths.pidFile);
	if (pid === null) {
		removeLock(paths.lockFile);
		io.log("Daemon not running");
		return { stopped: false };
	}

	if (io.isAlive(pid)) {
		try {
			io.kill(pid, "SIGTERM");
		} catch {
			// ESRCH race: the process exited between the liveness check and the
			// signal — treat as stopped.
		}
		removeDaemonPid(paths.pidFile);
		removeLock(paths.lockFile);
		io.log("Daemon stopped");
		return { stopped: true, pid };
	}

	// Stale PID file: the recorded process no longer exists.
	removeDaemonPid(paths.pidFile);
	removeLock(paths.lockFile);
	io.log("Daemon not running");
	return { stopped: false, pid };
}

/** Report whether the daemon is running. */
export function statusDaemon(options: { paths?: DaemonPaths; io?: Partial<DaemonIo> } = {}): StatusDaemonResult {
	const paths = options.paths ?? resolveDaemonPaths();
	const io = { ...defaultIo(), ...options.io };

	const pid = readDaemonPid(paths.pidFile);
	const running = pid !== null && io.isAlive(pid);
	io.log(running ? `running (pid ${pid})` : "not running");
	return { running, pid: running ? pid : null };
}

/** systemd user-unit name (Linux). */
export const SYSTEMD_UNIT_NAME = "local-memory-mcp";
/** launchd LaunchAgent label (macOS). */
export const LAUNCHD_LABEL = "io.github.vheins.local-memory-mcp";
/** Task Scheduler task name (Windows). */
export const WINDOWS_TASK_NAME = "local-memory-mcp-daemon";

/** An absolute program + its argument vector, ready to be registered with an OS service manager. */
export interface ServiceCommand {
	/** Absolute path to the executable (never relative — relative paths break on reboot). */
	program: string;
	/** Arguments passed to {@link program}. */
	args: string[];
}

/** Result of a captured subprocess invocation. */
export interface ServiceRunResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

/** Injectable seams for service installation (all default to the real system). */
export interface ServiceIo {
	log: (message: string) => void;
	run: (command: string, args: string[]) => ServiceRunResult;
	platform: NodeJS.Platform;
	homedir: string;
	execPath: string;
	workerArg: string;
	username: string;
}

/** Outcome of {@link installDaemon}. */
export interface InstallDaemonResult {
	/** Whether the service definition was written. */
	installed: boolean;
	platform: NodeJS.Platform;
	/** Path of the written service file (Linux/macOS). */
	servicePath?: string;
	/** `true` when an existing definition was found and `--force` was not given. */
	alreadyInstalled?: boolean;
	/** `true` when the platform's service tool was unavailable and a hint was printed. */
	hint?: boolean;
}

/** Outcome of {@link uninstallDaemon}. */
export interface UninstallDaemonResult {
	/** Whether an existing definition was removed. */
	uninstalled: boolean;
	platform: NodeJS.Platform;
	servicePath?: string;
	/** `true` when a hint was printed instead of running the service tool. */
	hint?: boolean;
}

function defaultServiceIo(): ServiceIo {
	return {
		log: (message) => process.stdout.write(`${message}\n`),
		run: (command, args) => {
			try {
				const result = spawnSync(command, args, { encoding: "utf8" });
				return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
			} catch {
				return { status: null, stdout: "", stderr: "" };
			}
		},
		platform: process.platform,
		homedir: os.homedir(),
		execPath: process.execPath,
		workerArg: process.argv[1] ?? "",
		username: process.env.USERNAME ?? process.env.USER ?? ""
	};
}

/** Absolute-path check for the given platform (injected platform may differ from the host). */
function isAbsoluteFor(platform: NodeJS.Platform, value: string): boolean {
	return platform === "win32" ? path.win32.isAbsolute(value) : path.isAbsolute(value);
}

/** Worker argument vector for a platform: `daemon --daemon-worker` (POSIX) or `--daemon-worker`. */
function workerArgs(platform: NodeJS.Platform): string[] {
	return platform === "darwin" || platform === "win32" ? ["--daemon-worker"] : ["daemon", "--daemon-worker"];
}

/** Whether a command is resolvable on PATH (`which` / `where.exe`). */
function commandExists(io: ServiceIo, command: string): boolean {
	const locator = io.platform === "win32" ? "where.exe" : "which";
	return io.run(locator, [command]).status === 0;
}

/**
 * Resolve the absolute command the service manager should launch.
 *
 * Prefers the globally installed `local-memory-mcp` binary (so `npx`/global
 * installs run through their shim); when it cannot be found, falls back to
 * `node <absolute entrypoint>`. Both branches are absolute.
 */
export function resolveServiceCommand(io: ServiceIo): ServiceCommand {
	const locator = io.platform === "win32" ? "where.exe" : "which";
	const found = io.run(locator, ["local-memory-mcp"]);
	if (found.status === 0) {
		const first = found.stdout
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) => line.length > 0);
		if (first && isAbsoluteFor(io.platform, first)) {
			return { program: first, args: workerArgs(io.platform) };
		}
	}
	return { program: io.execPath, args: [io.workerArg, ...workerArgs(io.platform)] };
}

/** Quote an argument for a systemd `ExecStart` line when it contains whitespace. */
function systemdArg(arg: string): string {
	return /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

/**
 * Non-secret performance/ops knobs that `daemon install` persists into the
 * service definition so the daemon boots with the operator's tuning (thread /
 * pool sizes, port, timeouts) after a reboot (FEAT-DAEMON-002F).
 *
 * SECURITY: only keys on this allowlist are ever written in PLAINTEXT into the
 * systemd unit (`Environment=`) or the launchd plist (`EnvironmentVariables`).
 * Secret-bearing keys (tokens, credentials) are deliberately excluded: on
 * systemd they stay in the mode-restricted `.env` imported via
 * `EnvironmentFile=`, and on EVERY platform the daemon also reads
 * `<configDir>/config.jsonc` + `<configDir>/.env` itself at boot
 * (FEAT-DAEMON-002A), so secrets are never duplicated into the unit/plist.
 *
 * Values are sourced from the SAME config-file loader — never a second reader.
 */
export const SERVICE_ENV_ALLOWLIST: readonly string[] = [
	"WORKER_POOL_SIZE",
	"EMBEDDING_WORKER_POOL_SIZE",
	"EMBEDDING_ONNX_THREADS",
	"OMP_NUM_THREADS",
	"CODEBASE_INDEX_WORKERS",
	"CODEBASE_INDEX_PARSE_CONCURRENCY",
	"CODEBASE_INDEX_PARSE_TIMEOUT_MS",
	"MCP_HTTP_PORT",
	"MCP_HTTP_SESSION_IDLE_TTL_MS",
	"MEMORY_DB_BUSY_TIMEOUT_MS"
];

/**
 * Resolve the non-secret service environment to persist (FEAT-DAEMON-002F).
 *
 * Delegates to the FEAT-DAEMON-002A config-file loader so the values written
 * into the service definition are exactly the ones the daemon resolves at boot
 * from `<configDir>/config.jsonc` then `<configDir>/.env` (`config.jsonc` wins
 * over `.env`). Only {@link SERVICE_ENV_ALLOWLIST} keys are returned, so a
 * secret in `.env` is never copied into the unit/plist in plaintext.
 *
 * NOTE: config changes require re-running `daemon install` (or a restart of the
 * installed service) — the service file is a snapshot, not a live reader.
 */
export function resolveServiceEnv(configDir: string): EnvMap {
	const env: NodeJS.ProcessEnv = {};
	// `createDir: false` — resolution must not have filesystem side effects.
	loadConfigFileEnv({ configDir, env, createDir: false });
	const resolved: EnvMap = {};
	for (const key of SERVICE_ENV_ALLOWLIST) {
		const value = env[key];
		if (value !== undefined && value !== "") resolved[key] = value;
	}
	return resolved;
}

/**
 * Resolve the `PATH` the generated service should run with (FIX-129).
 *
 * A launchd/systemd job inherits only a minimal `PATH`, so the global shim
 * whose shebang is `#!/usr/bin/env node` cannot resolve `node` (nvm/fnm/volta/
 * asdf), exits 127, and crash-loops under KeepAlive/Restart. Seed the
 * installing Node's own directory first, then the operator's shell `PATH`,
 * then the platform defaults — deduped, in that order.
 */
export function servicePath(io: ServiceIo): string {
	const delimiter = io.platform === "win32" ? ";" : ":";
	const fromEnv = (process.env.PATH ?? "").split(delimiter).filter((entry) => entry.length > 0);
	const entries = [path.dirname(io.execPath), ...fromEnv, "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
	return [...new Set(entries)].join(delimiter);
}

/** Render a single systemd `Environment=KEY=VALUE` assignment (quoted when needed). */
function systemdEnvAssignment(key: string, value: string): string {
	if (!/[\s"\\]/.test(value)) return `${key}=${value}`;
	return `${key}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Render a systemd `EnvironmentFile=` line. The leading `-` makes a missing
 * file a non-fatal no-op, so the line is always safe to emit before the
 * operator has created `<configDir>/.env`.
 */
function systemdEnvironmentFile(filePath: string): string {
	const quoted = /[\s"\\]/.test(filePath) ? `"${filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : filePath;
	return `EnvironmentFile=-${quoted}`;
}

/** Environment entries to embed in a service definition (FEAT-DAEMON-002F). */
export interface ServiceEnvOptions {
	/** Absolute path of a systemd `EnvironmentFile=` (systemd only). */
	environmentFile?: string;
	/** Resolved non-secret keys (systemd `Environment=` / launchd dict). */
	env?: EnvMap;
}

/**
 * Build the systemd user-unit file body.
 *
 * `workingDir` (FIX-110-B) seeds `WorkingDirectory=` so a daemon started by
 * systemd does NOT inherit `/` as its CWD — which would leave owner/repo
 * unresolvable for a rootless HTTP client (see FIX-110-A). Omitted when not
 * provided (back-compat for callers that build a unit without a seed).
 *
 * `serviceEnv` (FEAT-DAEMON-002F) seeds the environment block: an
 * `EnvironmentFile=-<configDir>/.env` (secrets stay in the mode-restricted file)
 * plus one `Environment=KEY=VALUE` line per resolved non-secret knob. Both are
 * omitted when not provided (back-compat).
 */
export function buildSystemdUnit(
	command: ServiceCommand,
	workingDir?: string,
	serviceEnv: ServiceEnvOptions = {}
): string {
	const envLines: string[] = [];
	if (serviceEnv.environmentFile) envLines.push(systemdEnvironmentFile(serviceEnv.environmentFile));
	for (const [key, value] of Object.entries(serviceEnv.env ?? {})) {
		envLines.push(`Environment=${systemdEnvAssignment(key, value)}`);
	}
	return [
		"[Unit]",
		"Description=local-memory-mcp daemon (combined dashboard + MCP HTTP)",
		"After=network.target",
		"",
		"[Service]",
		"Type=simple",
		`ExecStart=${[command.program, ...command.args].map(systemdArg).join(" ")}`,
		...(workingDir ? [`WorkingDirectory=${workingDir}`] : []),
		...envLines,
		"Restart=on-failure",
		"RestartSec=5",
		"",
		"[Install]",
		"WantedBy=default.target",
		""
	].join("\n");
}

/** Escape a string for inclusion in an XML text node / attribute. */
function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Build the launchd LaunchAgent plist body.
 *
 * `workingDir` (FIX-110-B) seeds `<key>WorkingDirectory</key>` so launchd
 * starts the daemon with the operator's project directory as its CWD rather
 * than `/`. Omitted when not provided.
 *
 * `serviceEnv` (FEAT-DAEMON-002F) seeds an `<key>EnvironmentVariables</key>`
 * dict of the resolved non-secret knobs. launchd has no `EnvironmentFile`
 * equivalent, so SECRETS ARE NEVER WRITTEN HERE — only allowlisted perf knobs;
 * secret values remain in `<configDir>/.env`, which the daemon loads itself at
 * boot (FEAT-DAEMON-002A). Omitted when not provided (back-compat).
 */
export function buildLaunchdPlist(
	command: ServiceCommand,
	logFile: string,
	workingDir?: string,
	serviceEnv: ServiceEnvOptions = {}
): string {
	const args = [command.program, ...command.args].map((arg) => `\t\t<string>${escapeXml(arg)}</string>`).join("\n");
	const envEntries = Object.entries(serviceEnv.env ?? {});
	const envDict =
		envEntries.length > 0
			? [
					"\t<key>EnvironmentVariables</key>",
					"\t<dict>",
					...envEntries.flatMap(([key, value]) => [
						`\t\t<key>${escapeXml(key)}</key>`,
						`\t\t<string>${escapeXml(value)}</string>`
					]),
					"\t</dict>"
				]
			: [];
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		"<dict>",
		"\t<key>Label</key>",
		`\t<string>${LAUNCHD_LABEL}</string>`,
		"\t<key>ProgramArguments</key>",
		"\t<array>",
		args,
		"\t</array>",
		...(workingDir ? ["\t<key>WorkingDirectory</key>", `\t<string>${escapeXml(workingDir)}</string>`] : []),
		...envDict,
		"\t<key>RunAtLoad</key>",
		"\t<true/>",
		"\t<key>KeepAlive</key>",
		"\t<true/>",
		"\t<key>StandardOutPath</key>",
		`\t<string>${escapeXml(logFile)}</string>`,
		"\t<key>StandardErrorPath</key>",
		`\t<string>${escapeXml(logFile)}</string>`,
		"</dict>",
		"</plist>",
		""
	].join("\n");
}

/**
 * Build the `schtasks /tr` command string (`"<program>" <args>`).
 *
 * NOTE (FIX-110-B): Windows Task Scheduler has no direct WorkingDirectory
 * equivalent in `schtasks /create`. The scheduled task inherits its start-in
 * directory from the task definition, which this CLI does not set; operators
 * needing a project CWD on Windows should set `LOCAL_MEMORY_DEFAULT_OWNER`/
 * `_REPO` (FIX-110-A) or `GITHUB_REPOSITORY` instead.
 */
export function buildSchtasksCommand(command: ServiceCommand): string {
	return `"${command.program}" ${command.args.join(" ")}`.trim();
}

/** Absolute path of the systemd user unit (Linux). */
export function systemdUnitPath(homedir: string): string {
	return path.join(homedir, ".config", "systemd", "user", `${SYSTEMD_UNIT_NAME}.service`);
}

/** Absolute path of the launchd LaunchAgent plist (macOS). */
export function launchdPlistPath(homedir: string): string {
	return path.join(homedir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

/**
 * Resolve the WorkingDirectory seed for the service definition (FIX-110-B).
 * Precedence: explicit option → the install-time process CWD → `os.homedir()`.
 * `process.cwd()` is wrapped so a deleted CWD (common when installing from a
 * removed shell) degrades to the home directory rather than throwing.
 */
function resolveWorkingDir(explicit?: string): string {
	if (explicit && explicit.trim().length > 0) return explicit;
	try {
		const cwd = process.cwd();
		if (cwd && cwd !== "/") return cwd;
	} catch {
		/* CWD unavailable — fall through to homedir */
	}
	return os.homedir();
}

/**
 * Install the daemon as an OS-managed service (Linux systemd / macOS launchd / Windows Task Scheduler).
 *
 * `workingDir` (FIX-110-B) seeds the service's working directory (systemd
 * `WorkingDirectory=`, launchd `WorkingDirectory`). Defaults to the install-
 * time CWD, falling back to `os.homedir()` — so a service-started daemon does
 * not inherit `/` as its CWD and can still resolve owner/repo (FIX-110-A).
 */
export function installDaemon(
	options: { force?: boolean; workingDir?: string; paths?: DaemonPaths; io?: Partial<ServiceIo> } = {}
): InstallDaemonResult {
	const io = { ...defaultServiceIo(), ...options.io };
	const paths = options.paths ?? resolveDaemonPaths();
	const force = options.force === true;
	const workingDir = resolveWorkingDir(options.workingDir);

	if (io.platform === "darwin") return installLaunchd(io, paths, force, workingDir);
	if (io.platform === "win32") return installWindows(io, force);
	return installSystemd(io, paths, force, workingDir);
}

/** Remove the daemon's OS-managed service definition. */
export function uninstallDaemon(options: { io?: Partial<ServiceIo> } = {}): UninstallDaemonResult {
	const io = { ...defaultServiceIo(), ...options.io };

	if (io.platform === "darwin") return uninstallLaunchd(io);
	if (io.platform === "win32") return uninstallWindows(io);
	return uninstallSystemd(io);
}

function installSystemd(io: ServiceIo, paths: DaemonPaths, force: boolean, workingDir?: string): InstallDaemonResult {
	const unitPath = systemdUnitPath(io.homedir);
	if (fs.existsSync(unitPath) && !force) {
		io.log(`Daemon service already installed (${unitPath}). Use --force to overwrite.`);
		return { installed: false, platform: io.platform, servicePath: unitPath, alreadyInstalled: true };
	}

	const command = resolveServiceCommand(io);
	if (!commandExists(io, "systemctl")) {
		io.log("systemctl not found — cannot install a systemd user service.");
		io.log("Add this line to your crontab (`crontab -e`) instead:");
		io.log(`@reboot ${command.program} ${command.args.join(" ")}`);
		return { installed: false, platform: io.platform, servicePath: unitPath, hint: true };
	}

	// FEAT-DAEMON-002F: persist the resolved non-secret knobs into the unit and
	// import the config `.env` via EnvironmentFile= (secrets stay in that
	// mode-restricted file, never copied into the unit in plaintext).
	const serviceEnv: ServiceEnvOptions = {
		environmentFile: path.join(paths.dir, ".env"),
		// FIX-129: seed PATH first so the `#!/usr/bin/env node` shim resolves
		// under systemd's minimal PATH; an allowlisted PATH would still win.
		env: { PATH: servicePath(io), ...resolveServiceEnv(paths.dir) }
	};

	fs.mkdirSync(path.dirname(unitPath), { recursive: true });
	fs.writeFileSync(unitPath, buildSystemdUnit(command, workingDir, serviceEnv), "utf8");
	io.run("systemctl", ["--user", "daemon-reload"]);
	io.run("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT_NAME]);
	io.log(`Daemon service installed (systemd user unit: ${unitPath})`);
	return { installed: true, platform: io.platform, servicePath: unitPath };
}

function uninstallSystemd(io: ServiceIo): UninstallDaemonResult {
	const unitPath = systemdUnitPath(io.homedir);
	if (!fs.existsSync(unitPath)) {
		io.log("Daemon service not installed");
		return { uninstalled: false, platform: io.platform, servicePath: unitPath };
	}

	if (!commandExists(io, "systemctl")) {
		fs.rmSync(unitPath, { force: true });
		io.log(`systemctl not found — removed ${unitPath} and the crontab @reboot entry manually.`);
		return { uninstalled: true, platform: io.platform, servicePath: unitPath, hint: true };
	}

	io.run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT_NAME]);
	fs.rmSync(unitPath, { force: true });
	io.run("systemctl", ["--user", "daemon-reload"]);
	io.log("Daemon service uninstalled");
	return { uninstalled: true, platform: io.platform, servicePath: unitPath };
}

function installLaunchd(io: ServiceIo, paths: DaemonPaths, force: boolean, workingDir?: string): InstallDaemonResult {
	const plistPath = launchdPlistPath(io.homedir);
	if (fs.existsSync(plistPath) && !force) {
		io.log(`Daemon service already installed (${plistPath}). Use --force to overwrite.`);
		return { installed: false, platform: io.platform, servicePath: plistPath, alreadyInstalled: true };
	}

	const command = resolveServiceCommand(io);
	if (!commandExists(io, "launchctl")) {
		io.log("launchctl not found — cannot install a LaunchAgent.");
		io.log("Start the daemon manually at login:");
		io.log(`${command.program} ${command.args.join(" ")}`);
		return { installed: false, platform: io.platform, servicePath: plistPath, hint: true };
	}

	fs.mkdirSync(path.dirname(plistPath), { recursive: true });
	// FEAT-DAEMON-002F: launchd has no EnvironmentFile equivalent, so only the
	// non-secret allowlisted knobs are written into EnvironmentVariables —
	// secrets stay in `<configDir>/.env`, loaded by the daemon itself at boot.
	fs.writeFileSync(
		plistPath,
		buildLaunchdPlist(command, paths.logFile, workingDir, {
			// FIX-129: seed PATH first so the `#!/usr/bin/env node` shim resolves
			// under launchd's minimal PATH; an allowlisted PATH would still win.
			env: { PATH: servicePath(io), ...resolveServiceEnv(paths.dir) }
		}),
		"utf8"
	);
	io.run("launchctl", ["load", "-w", plistPath]);
	io.log(`Daemon service installed (launchd LaunchAgent: ${plistPath})`);
	return { installed: true, platform: io.platform, servicePath: plistPath };
}

function uninstallLaunchd(io: ServiceIo): UninstallDaemonResult {
	const plistPath = launchdPlistPath(io.homedir);
	if (!fs.existsSync(plistPath)) {
		io.log("Daemon service not installed");
		return { uninstalled: false, platform: io.platform, servicePath: plistPath };
	}

	if (!commandExists(io, "launchctl")) {
		fs.rmSync(plistPath, { force: true });
		io.log(`launchctl not found — removed ${plistPath} manually.`);
		return { uninstalled: true, platform: io.platform, servicePath: plistPath, hint: true };
	}

	io.run("launchctl", ["unload", "-w", plistPath]);
	fs.rmSync(plistPath, { force: true });
	io.log("Daemon service uninstalled");
	return { uninstalled: true, platform: io.platform, servicePath: plistPath };
}

function installWindows(io: ServiceIo, force: boolean): InstallDaemonResult {
	const command = resolveServiceCommand(io);
	if (!commandExists(io, "schtasks")) {
		io.log("schtasks not found — cannot create a scheduled task.");
		io.log("Add a shortcut to the Startup folder (Win+R → `shell:startup`) that runs:");
		io.log(buildSchtasksCommand(command));
		return { installed: false, platform: io.platform, hint: true };
	}

	const existing = io.run("schtasks", ["/query", "/tn", WINDOWS_TASK_NAME]);
	if (existing.status === 0 && !force) {
		io.log(`Daemon service already installed (scheduled task "${WINDOWS_TASK_NAME}"). Use --force to overwrite.`);
		return { installed: false, platform: io.platform, alreadyInstalled: true };
	}

	io.run("schtasks", [
		"/create",
		"/tn",
		WINDOWS_TASK_NAME,
		"/tr",
		buildSchtasksCommand(command),
		"/sc",
		"ONLOGON",
		"/ru",
		io.username,
		"/f"
	]);
	io.log(`Daemon service installed (scheduled task "${WINDOWS_TASK_NAME}")`);
	return { installed: true, platform: io.platform };
}

function uninstallWindows(io: ServiceIo): UninstallDaemonResult {
	if (!commandExists(io, "schtasks")) {
		io.log("schtasks not found — remove the Startup-folder shortcut manually.");
		return { uninstalled: false, platform: io.platform, hint: true };
	}

	const existing = io.run("schtasks", ["/query", "/tn", WINDOWS_TASK_NAME]);
	if (existing.status !== 0) {
		io.log("Daemon service not installed");
		return { uninstalled: false, platform: io.platform };
	}

	io.run("schtasks", ["/delete", "/tn", WINDOWS_TASK_NAME, "/f"]);
	io.log("Daemon service uninstalled");
	return { uninstalled: true, platform: io.platform };
}

/**
 * Extract the `--working-dir <path>` value from `daemon install` args
 * (FIX-110-B). Supports both `--working-dir <path>` and `--working-dir=<path>`.
 * Returns `undefined` when absent so `installDaemon` applies its own default
 * (install-time CWD → `os.homedir()`).
 */
function parseWorkingDirArg(argv: string[]): string | undefined {
	const eqForm = argv.find((a) => a.startsWith("--working-dir="));
	if (eqForm) {
		const value = eqForm.slice("--working-dir=".length).trim();
		return value.length > 0 ? value : undefined;
	}
	const idx = argv.indexOf("--working-dir");
	if (idx !== -1) {
		const value = argv[idx + 1];
		return value && !value.startsWith("--") ? value : undefined;
	}
	return undefined;
}

/**
 * Dispatch the `daemon` subcommand. Always exits the parent process:
 * `start` forks and returns to the shell, `stop`/`status` complete inline.
 *
 * @param argv - Arguments AFTER the `daemon` token (`process.argv.slice(3)`).
 */
export function runDaemonCli(argv: string[] = process.argv.slice(3)): void {
	const sub = argv[0];
	try {
		if (sub === "stop") {
			stopDaemon();
		} else if (sub === "status") {
			statusDaemon();
		} else if (sub === "install") {
			installDaemon({ force: argv.includes("--force"), workingDir: parseWorkingDirArg(argv) });
		} else if (sub === "uninstall") {
			uninstallDaemon();
		} else if (sub === undefined || sub === "start") {
			startDaemon();
		} else {
			process.stderr.write(
				`Unknown daemon subcommand: ${sub} (expected: start | stop | status | install | uninstall)\n`
			);
			process.exit(1);
		}
	} catch (error) {
		// FIX-025: a lock/spawn failure is reported as an actionable message and
		// a clean non-zero exit — never an uncaught stack trace.
		process.stderr.write(`Daemon command failed: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	}
	process.exit(0);
}
