/**
 * Unit tests for the `daemon` CLI lifecycle (FEAT-DAEMON-001).
 *
 * Covers PID-file management, daemon-dir resolution, process liveness, and the
 * start/stop/status orchestration. All process/filesystem side effects are
 * injected (`DaemonIo`) or confined to a per-test temp dir, so no real daemon
 * is ever forked and no config-dir file is touched.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { spawn } from "node:child_process";
import {
	acquireLock,
	buildLaunchdPlist,
	buildSchtasksCommand,
	buildSystemdUnit,
	installDaemon,
	isProcessAlive,
	launchdPlistPath,
	readDaemonPid,
	readLockPid,
	removeDaemonPid,
	removeLock,
	resolveDaemonDir,
	resolveDaemonPaths,
	resolveServiceCommand,
	resolveServiceEnv,
	servicePath,
	startDaemon,
	statusDaemon,
	stopDaemon,
	systemdUnitPath,
	uninstallDaemon,
	writeDaemonPid,
	LAUNCHD_LABEL,
	SERVICE_ENV_ALLOWLIST,
	SYSTEMD_UNIT_NAME,
	WINDOWS_TASK_NAME,
	type DaemonIo,
	type DaemonPaths,
	type ServiceIo,
	type ServiceRunResult
} from "../cli/daemon";

const tempDirs: string[] = [];

function makePaths(): DaemonPaths {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmc-daemon-"));
	tempDirs.push(dir);
	return {
		dir,
		pidFile: path.join(dir, "daemon.pid"),
		logFile: path.join(dir, "daemon.log"),
		lockFile: path.join(dir, "daemon.lock")
	};
}

/** Collect log lines emitted by the injected io. */
function collector(): { lines: string[]; log: (message: string) => void } {
	const lines: string[] = [];
	return { lines, log: (message: string) => lines.push(message) };
}

afterEach(() => {
	while (tempDirs.length > 0) {
		fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

describe("daemon — path resolution", () => {
	it("prefers LOCAL_MEMORY_DAEMON_DIR", () => {
		const env = { LOCAL_MEMORY_DAEMON_DIR: "/tmp/explicit", MEMORY_DB_PATH: "/tmp/db/memory.db" };
		expect(resolveDaemonDir(env)).toBe("/tmp/explicit");
	});

	it("derives the dir from MEMORY_DB_PATH when no explicit dir is set", () => {
		expect(resolveDaemonDir({ MEMORY_DB_PATH: "/tmp/db/memory.db" })).toBe("/tmp/db");
	});

	it("ignores an in-memory MEMORY_DB_PATH and falls back to the platform config dir", () => {
		const dir = resolveDaemonDir({ MEMORY_DB_PATH: ":memory:" });
		expect(dir).toContain("local-memory-mcp");
	});

	it("places daemon.pid, daemon.log, and daemon.lock in the resolved dir", () => {
		const paths = resolveDaemonPaths({ LOCAL_MEMORY_DAEMON_DIR: "/tmp/lmc" });
		expect(paths.pidFile).toBe(path.join("/tmp/lmc", "daemon.pid"));
		expect(paths.logFile).toBe(path.join("/tmp/lmc", "daemon.log"));
		expect(paths.lockFile).toBe(path.join("/tmp/lmc", "daemon.lock"));
	});
});

describe("daemon — PID file", () => {
	it("round-trips a pid", () => {
		const paths = makePaths();
		writeDaemonPid(paths.pidFile, 4242);
		expect(readDaemonPid(paths.pidFile)).toBe(4242);
	});

	it("returns null when the pid file is missing", () => {
		expect(readDaemonPid("/tmp/does-not-exist-daemon.pid")).toBeNull();
	});

	it("returns null for a non-numeric pid file", () => {
		const paths = makePaths();
		fs.writeFileSync(paths.pidFile, "not-a-pid\n", "utf8");
		expect(readDaemonPid(paths.pidFile)).toBeNull();
	});

	it("removeDaemonPid is idempotent", () => {
		const paths = makePaths();
		writeDaemonPid(paths.pidFile, 1);
		removeDaemonPid(paths.pidFile);
		expect(fs.existsSync(paths.pidFile)).toBe(false);
		expect(() => removeDaemonPid(paths.pidFile)).not.toThrow();
	});
});

describe("daemon — liveness", () => {
	it("reports the current process as alive", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
	});

	it("reports an out-of-range pid as dead", () => {
		expect(isProcessAlive(0)).toBe(false);
		expect(isProcessAlive(-1)).toBe(false);
	});
});

describe("daemon — start", () => {
	it("forks a detached worker, writes its pid, and logs 'Daemon started'", () => {
		const paths = makePaths();
		const { lines, log } = collector();
		const unref = vi.fn();
		const spawnFn = (() => ({ pid: 5150, unref })) as unknown as typeof spawn;

		const result = startDaemon({
			paths,
			io: { spawnFn, log, execPath: "/usr/bin/node", workerArg: "/bin/mcp-memory-server.js" }
		});

		expect(result).toEqual({ started: true, pid: 5150 });
		expect(unref).toHaveBeenCalledTimes(1);
		expect(readDaemonPid(paths.pidFile)).toBe(5150);
		expect(lines).toEqual(["Daemon started (pid 5150)"]);
		expect(fs.existsSync(paths.logFile)).toBe(true);
		// The single-instance lock is created and records the WORKER pid.
		expect(readLockPid(paths.lockFile)).toBe(5150);
	});

	it("does not fork when a live daemon is already recorded", () => {
		const paths = makePaths();
		writeDaemonPid(paths.pidFile, 777);
		const { lines, log } = collector();
		const spawnFn = vi.fn() as unknown as typeof spawn;

		const result = startDaemon({ paths, io: { spawnFn, log, isAlive: () => true } });

		expect(result).toEqual({ started: false, pid: 777 });
		expect(spawnFn).not.toHaveBeenCalled();
		expect(lines).toEqual(["Daemon already running (pid 777)"]);
	});

	it("replaces a stale pid file (recorded process is gone)", () => {
		const paths = makePaths();
		writeDaemonPid(paths.pidFile, 111);
		const { log } = collector();
		const spawnFn = (() => ({ pid: 222, unref: () => undefined })) as unknown as typeof spawn;

		const result = startDaemon({ paths, io: { spawnFn, log, isAlive: () => false } });

		expect(result).toEqual({ started: true, pid: 222 });
		expect(readDaemonPid(paths.pidFile)).toBe(222);
		expect(readLockPid(paths.lockFile)).toBe(222);
	});

	it("releases the lock when the spawn itself throws", () => {
		const paths = makePaths();
		const { log } = collector();
		const spawnFn = (() => {
			throw new Error("spawn failed");
		}) as unknown as typeof spawn;

		expect(() => startDaemon({ paths, io: { spawnFn, log } })).toThrow("spawn failed");
		expect(fs.existsSync(paths.lockFile)).toBe(false);
	});
});

describe("daemon — single-instance lock (TASK-425)", () => {
	it("acquireLock creates the lock file and records the pid", () => {
		const paths = makePaths();
		const result = acquireLock(paths.lockFile, { isAlive: () => false }, 4242);

		expect(result).toEqual({ acquired: true, pid: 4242 });
		expect(readLockPid(paths.lockFile)).toBe(4242);
	});

	it("two sequential startDaemon calls → only the first starts; the second reports the first pid", () => {
		const paths = makePaths();
		const { lines, log } = collector();
		const first = (() => ({ pid: 6001, unref: () => undefined })) as unknown as typeof spawn;

		const r1 = startDaemon({ paths, io: { spawnFn: first, log, isAlive: () => true } });
		expect(r1).toEqual({ started: true, pid: 6001 });

		// Second start: the lock file now exists and its owner is alive.
		const second = vi.fn() as unknown as typeof spawn;
		const r2 = startDaemon({ paths, io: { spawnFn: second, log, isAlive: () => true } });

		expect(r2).toEqual({ started: false, pid: 6001 });
		expect(second).not.toHaveBeenCalled();
		expect(lines).toEqual(["Daemon started (pid 6001)", "Daemon already running (pid 6001)"]);
	});

	it("reports the lock holder's pid when the lock is present but the PID file is absent", () => {
		const paths = makePaths();
		// Simulate a lock held by a live process, no PID file (parent crashed
		// between lock acquisition and PID write, or file was removed).
		fs.writeFileSync(paths.lockFile, "9100\n", "utf8");
		const { lines, log } = collector();
		const spawnFn = vi.fn() as unknown as typeof spawn;

		const result = startDaemon({ paths, io: { spawnFn, log, isAlive: () => true } });

		expect(result).toEqual({ started: false, pid: 9100 });
		expect(spawnFn).not.toHaveBeenCalled();
		expect(lines).toEqual(["Daemon already running (pid 9100)"]);
	});

	it("removes a stale lock held by a dead process and starts", () => {
		const paths = makePaths();
		fs.writeFileSync(paths.lockFile, "9999\n", "utf8");
		const { lines, log } = collector();
		const spawnFn = (() => ({ pid: 7007, unref: () => undefined })) as unknown as typeof spawn;

		const result = startDaemon({ paths, io: { spawnFn, log, isAlive: () => false } });

		expect(result).toEqual({ started: true, pid: 7007 });
		expect(readLockPid(paths.lockFile)).toBe(7007);
		expect(lines).toEqual(["Daemon started (pid 7007)"]);
	});

	it("removes an empty/corrupt lock file (no readable pid) and starts", () => {
		const paths = makePaths();
		fs.writeFileSync(paths.lockFile, "not-a-pid\n", "utf8");
		const { log } = collector();
		const spawnFn = (() => ({ pid: 7100, unref: () => undefined })) as unknown as typeof spawn;

		const result = startDaemon({ paths, io: { spawnFn, log, isAlive: () => true } });

		expect(result).toEqual({ started: true, pid: 7100 });
		expect(readLockPid(paths.lockFile)).toBe(7100);
	});

	it("cleans a stale PID file AND a stale lock, then starts", () => {
		const paths = makePaths();
		writeDaemonPid(paths.pidFile, 111);
		fs.writeFileSync(paths.lockFile, "222\n", "utf8");
		const { log } = collector();
		const spawnFn = (() => ({ pid: 333, unref: () => undefined })) as unknown as typeof spawn;

		const result = startDaemon({ paths, io: { spawnFn, log, isAlive: () => false } });

		expect(result).toEqual({ started: true, pid: 333 });
		expect(readDaemonPid(paths.pidFile)).toBe(333);
		expect(readLockPid(paths.lockFile)).toBe(333);
	});
});

describe("daemon — lock failure hardening (FIX-025)", () => {
	it("wraps an fs failure acquiring the lock in an actionable message (not a raw error)", () => {
		// Point the lock at a path whose parent "directory" is actually a FILE,
		// so acquireLock's mkdirSync throws ENOTDIR — the class of fs failure
		// that previously escaped the CLI as an uncaught stack trace.
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmc-lockfail-"));
		tempDirs.push(dir);
		const notADir = path.join(dir, "blocker");
		fs.writeFileSync(notADir, "x", "utf8");
		const paths: DaemonPaths = {
			dir,
			pidFile: path.join(dir, "daemon.pid"),
			logFile: path.join(dir, "daemon.log"),
			lockFile: path.join(notADir, "daemon.lock")
		};
		const { log } = collector();

		expect(() => startDaemon({ paths, io: { log } })).toThrow(/Failed to acquire the daemon single-instance lock/);
	});

	it("still starts normally when the lock is acquirable (positive control)", () => {
		const paths = makePaths();
		const { log } = collector();
		const spawnFn = (() => ({ pid: 4321, unref: () => undefined })) as unknown as typeof spawn;

		const result = startDaemon({ paths, io: { spawnFn, log, isAlive: () => false } });

		expect(result).toEqual({ started: true, pid: 4321 });
		expect(readLockPid(paths.lockFile)).toBe(4321);
	});
});

describe("daemon — stop", () => {
	it("SIGTERMs the recorded pid, removes the pid file, and logs 'Daemon stopped'", () => {
		const paths = makePaths();
		writeDaemonPid(paths.pidFile, 888);
		const { lines, log } = collector();
		const kill = vi.fn();

		const result = stopDaemon({ paths, io: { log, kill, isAlive: () => true } });

		expect(result).toEqual({ stopped: true, pid: 888 });
		expect(kill).toHaveBeenCalledWith(888, "SIGTERM");
		expect(fs.existsSync(paths.pidFile)).toBe(false);
		expect(lines).toEqual(["Daemon stopped"]);
	});

	it("releases the single-instance lock file (TASK-425)", () => {
		const paths = makePaths();
		writeDaemonPid(paths.pidFile, 888);
		fs.writeFileSync(paths.lockFile, "888\n", "utf8");
		const { log } = collector();
		const kill = vi.fn();

		const result = stopDaemon({ paths, io: { log, kill, isAlive: () => true } });

		expect(result).toEqual({ stopped: true, pid: 888 });
		expect(fs.existsSync(paths.pidFile)).toBe(false);
		expect(fs.existsSync(paths.lockFile)).toBe(false);
	});

	it("releases the lock even when only a stale PID file exists", () => {
		const paths = makePaths();
		writeDaemonPid(paths.pidFile, 999);
		fs.writeFileSync(paths.lockFile, "999\n", "utf8");
		const { log } = collector();

		const result = stopDaemon({ paths, io: { log, isAlive: () => false } });

		expect(result.stopped).toBe(false);
		expect(fs.existsSync(paths.pidFile)).toBe(false);
		expect(fs.existsSync(paths.lockFile)).toBe(false);
	});

	it("removeLock is idempotent", () => {
		const paths = makePaths();
		expect(() => removeLock(paths.lockFile)).not.toThrow();
		fs.writeFileSync(paths.lockFile, "1\n", "utf8");
		removeLock(paths.lockFile);
		expect(fs.existsSync(paths.lockFile)).toBe(false);
		expect(() => removeLock(paths.lockFile)).not.toThrow();
	});

	it("logs 'Daemon not running' when there is no pid file", () => {
		const paths = makePaths();
		const { lines, log } = collector();
		const kill = vi.fn();

		const result = stopDaemon({ paths, io: { log, kill } });

		expect(result.stopped).toBe(false);
		expect(kill).not.toHaveBeenCalled();
		expect(lines).toEqual(["Daemon not running"]);
	});

	it("cleans up a stale pid file and reports 'Daemon not running'", () => {
		const paths = makePaths();
		writeDaemonPid(paths.pidFile, 999);
		const { lines, log } = collector();

		const result = stopDaemon({ paths, io: { log, isAlive: () => false } });

		expect(result.stopped).toBe(false);
		expect(fs.existsSync(paths.pidFile)).toBe(false);
		expect(lines).toEqual(["Daemon not running"]);
	});

	it("treats an ESRCH race during kill as stopped", () => {
		const paths = makePaths();
		writeDaemonPid(paths.pidFile, 333);
		const { log } = collector();
		const kill = vi.fn(() => {
			throw Object.assign(new Error("no such process"), { code: "ESRCH" });
		}) as unknown as DaemonIo["kill"];

		const result = stopDaemon({ paths, io: { log, kill, isAlive: () => true } });

		expect(result.stopped).toBe(true);
		expect(fs.existsSync(paths.pidFile)).toBe(false);
	});
});

describe("daemon — status", () => {
	it("prints 'running (pid N)' when the recorded process is alive", () => {
		const paths = makePaths();
		writeDaemonPid(paths.pidFile, 6060);
		const { lines, log } = collector();

		const result = statusDaemon({ paths, io: { log, isAlive: () => true } });

		expect(result).toEqual({ running: true, pid: 6060 });
		expect(lines).toEqual(["running (pid 6060)"]);
	});

	it("prints 'not running' when the recorded process is gone", () => {
		const paths = makePaths();
		writeDaemonPid(paths.pidFile, 4040);
		const { lines, log } = collector();

		const result = statusDaemon({ paths, io: { log, isAlive: () => false } });

		expect(result).toEqual({ running: false, pid: null });
		expect(lines).toEqual(["not running"]);
	});

	it("prints 'not running' when there is no pid file", () => {
		const paths = makePaths();
		const { lines, log } = collector();

		expect(statusDaemon({ paths, io: { log } })).toEqual({ running: false, pid: null });
		expect(lines).toEqual(["not running"]);
	});
});

/**
 * Build a fake {@link ServiceIo} for install/uninstall tests.
 *
 * `available` is the set of service-tool / locator commands the fake treats as
 * present on PATH. `run` records every invocation and returns canned results:
 * locator lookups succeed for `available`, the binary lookup (`local-memory-mcp`)
 * returns `binaryPath` when provided, and everything else succeeds.
 */
function fakeServiceIo(
	platform: NodeJS.Platform,
	homedir: string,
	options: { available?: string[]; binaryPath?: string; username?: string } = {}
): { io: ServiceIo; calls: Array<{ command: string; args: string[] }>; lines: string[] } {
	const available = new Set(options.available ?? []);
	const calls: Array<{ command: string; args: string[] }> = [];
	const lines: string[] = [];
	const locator = platform === "win32" ? "where.exe" : "which";

	const io: ServiceIo = {
		log: (message) => lines.push(message),
		run: (command, args): ServiceRunResult => {
			calls.push({ command, args });
			if (command === locator) {
				const target = args[0];
				if (target === "local-memory-mcp" && options.binaryPath) {
					return { status: 0, stdout: `${options.binaryPath}\n`, stderr: "" };
				}
				if (available.has(target)) return { status: 0, stdout: `/${target}\n`, stderr: "" };
				return { status: 1, stdout: "", stderr: "not found" };
			}
			// A `schtasks /query` probe models "task does not exist yet" unless a
			// test overrides `io.run`.
			if (command === "schtasks" && args[0] === "/query") {
				return { status: 1, stdout: "", stderr: "no task" };
			}
			return { status: 0, stdout: "", stderr: "" };
		},
		platform,
		homedir,
		execPath: "/usr/bin/node",
		workerArg: "/opt/pkg/bin/mcp-memory-server.js",
		username: options.username ?? "testuser"
	};
	return { io, calls, lines };
}

function makeHome(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmc-home-"));
	tempDirs.push(dir);
	return dir;
}

describe("daemon install/uninstall — binary resolution", () => {
	it("prefers the global binary from which()", () => {
		const { io } = fakeServiceIo("linux", makeHome(), { binaryPath: "/usr/local/bin/local-memory-mcp" });
		expect(resolveServiceCommand(io)).toEqual({
			program: "/usr/local/bin/local-memory-mcp",
			args: ["daemon", "--daemon-worker"]
		});
	});

	it("falls back to `node <absolute entrypoint>` when the binary is missing", () => {
		const { io } = fakeServiceIo("linux", makeHome());
		expect(resolveServiceCommand(io)).toEqual({
			program: "/usr/bin/node",
			args: ["/opt/pkg/bin/mcp-memory-server.js", "daemon", "--daemon-worker"]
		});
	});

	it("ignores a relative locator result and falls back to node", () => {
		const { io } = fakeServiceIo("linux", makeHome(), { binaryPath: "bin/local-memory-mcp" });
		expect(resolveServiceCommand(io).program).toBe("/usr/bin/node");
	});

	it("uses --daemon-worker (no daemon token) on Windows", () => {
		const { io } = fakeServiceIo("win32", makeHome(), { binaryPath: "C:\\bin\\local-memory-mcp.cmd" });
		expect(resolveServiceCommand(io)).toEqual({
			program: "C:\\bin\\local-memory-mcp.cmd",
			args: ["--daemon-worker"]
		});
	});

	it("uses --daemon-worker (no daemon token) on macOS", () => {
		const { io } = fakeServiceIo("darwin", makeHome(), { binaryPath: "/opt/homebrew/bin/local-memory-mcp" });
		expect(resolveServiceCommand(io).args).toEqual(["--daemon-worker"]);
	});
});

describe("daemon install — Linux systemd", () => {
	it("writes the unit, reloads, enables, and logs success", () => {
		const home = makeHome();
		const paths = makePaths();
		const { io, calls, lines } = fakeServiceIo("linux", home, {
			available: ["systemctl"],
			binaryPath: "/usr/local/bin/local-memory-mcp"
		});

		const result = installDaemon({ io, paths, workingDir: "/projects/widget" });

		expect(result).toEqual({
			installed: true,
			platform: "linux",
			servicePath: systemdUnitPath(home)
		});
		const unit = fs.readFileSync(systemdUnitPath(home), "utf8");
		expect(unit).toContain("ExecStart=/usr/local/bin/local-memory-mcp daemon --daemon-worker");
		expect(unit).toContain("WantedBy=default.target");
		// FIX-110-B: the seeded WorkingDirectory line must be present.
		expect(unit).toContain("WorkingDirectory=/projects/widget");
		expect(calls).toContainEqual({ command: "systemctl", args: ["--user", "daemon-reload"] });
		expect(calls).toContainEqual({ command: "systemctl", args: ["--user", "enable", "--now", SYSTEMD_UNIT_NAME] });
		expect(lines.some((line) => line.includes("systemd user unit"))).toBe(true);
	});

	it("warns and does not overwrite when already installed (no --force)", () => {
		const home = makeHome();
		fs.mkdirSync(path.dirname(systemdUnitPath(home)), { recursive: true });
		fs.writeFileSync(systemdUnitPath(home), "existing\n", "utf8");
		const { io, calls, lines } = fakeServiceIo("linux", home, { available: ["systemctl"] });

		const result = installDaemon({ io });

		expect(result.alreadyInstalled).toBe(true);
		expect(fs.readFileSync(systemdUnitPath(home), "utf8")).toBe("existing\n");
		expect(calls.some((call) => call.command === "systemctl")).toBe(false);
		expect(lines.some((line) => line.includes("already installed"))).toBe(true);
	});

	it("overwrites when --force is given", () => {
		const home = makeHome();
		const paths = makePaths();
		fs.mkdirSync(path.dirname(systemdUnitPath(home)), { recursive: true });
		fs.writeFileSync(systemdUnitPath(home), "existing\n", "utf8");
		const { io } = fakeServiceIo("linux", home, { available: ["systemctl"] });

		const result = installDaemon({ io, paths, force: true });

		expect(result.installed).toBe(true);
		expect(fs.readFileSync(systemdUnitPath(home), "utf8")).toContain("ExecStart=");
	});

	it("prints a cron @reboot hint when systemctl is unavailable", () => {
		const home = makeHome();
		const paths = makePaths();
		const { io, lines } = fakeServiceIo("linux", home, { binaryPath: "/usr/local/bin/local-memory-mcp" });

		const result = installDaemon({ io, paths });

		expect(result.hint).toBe(true);
		expect(result.installed).toBe(false);
		expect(fs.existsSync(systemdUnitPath(home))).toBe(false);
		expect(lines.some((line) => line.startsWith("@reboot "))).toBe(true);
	});

	it("seeds WorkingDirectory from the install-time CWD by default (FIX-110-B)", () => {
		const home = makeHome();
		const paths = makePaths();
		const { io } = fakeServiceIo("linux", home, {
			available: ["systemctl"],
			binaryPath: "/usr/local/bin/local-memory-mcp"
		});

		installDaemon({ io, paths });

		const unit = fs.readFileSync(systemdUnitPath(home), "utf8");
		// The test process CWD is the repo checkout (never "/"), so the default
		// seed must be the resolved process.cwd().
		expect(unit).toContain(`WorkingDirectory=${process.cwd()}`);
	});
});

describe("daemon uninstall — Linux systemd", () => {
	it("disables, deletes the unit, reloads, and logs success", () => {
		const home = makeHome();
		fs.mkdirSync(path.dirname(systemdUnitPath(home)), { recursive: true });
		fs.writeFileSync(systemdUnitPath(home), "unit\n", "utf8");
		const { io, calls, lines } = fakeServiceIo("linux", home, { available: ["systemctl"] });

		const result = uninstallDaemon({ io });

		expect(result.uninstalled).toBe(true);
		expect(fs.existsSync(systemdUnitPath(home))).toBe(false);
		expect(calls).toContainEqual({ command: "systemctl", args: ["--user", "disable", "--now", SYSTEMD_UNIT_NAME] });
		expect(calls).toContainEqual({ command: "systemctl", args: ["--user", "daemon-reload"] });
		expect(lines).toEqual(["Daemon service uninstalled"]);
	});

	it("is graceful when not installed", () => {
		const home = makeHome();
		const { io, calls, lines } = fakeServiceIo("linux", home, { available: ["systemctl"] });

		const result = uninstallDaemon({ io });

		expect(result.uninstalled).toBe(false);
		expect(calls.some((call) => call.command === "systemctl")).toBe(false);
		expect(lines).toEqual(["Daemon service not installed"]);
	});
});

describe("daemon install/uninstall — macOS launchd", () => {
	it("writes a plist with the required keys and loads it", () => {
		const home = makeHome();
		const { io, calls, lines } = fakeServiceIo("darwin", home, {
			available: ["launchctl"],
			binaryPath: "/opt/homebrew/bin/local-memory-mcp"
		});
		const paths: DaemonPaths = {
			dir: home,
			pidFile: path.join(home, "daemon.pid"),
			logFile: path.join(home, "daemon.log"),
			lockFile: path.join(home, "daemon.lock")
		};

		const result = installDaemon({ io, paths, workingDir: "/projects/widget" });

		expect(result.installed).toBe(true);
		const plist = fs.readFileSync(launchdPlistPath(home), "utf8");
		expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
		expect(plist).toContain("<key>RunAtLoad</key>");
		expect(plist).toContain("<key>KeepAlive</key>");
		expect(plist).toContain(`<string>${paths.logFile}</string>`);
		expect(plist).toContain("<string>--daemon-worker</string>");
		// FIX-110-B: the seeded WorkingDirectory key must be present.
		expect(plist).toContain("<key>WorkingDirectory</key>");
		expect(plist).toContain("<string>/projects/widget</string>");
		expect(calls).toContainEqual({ command: "launchctl", args: ["load", "-w", launchdPlistPath(home)] });
		expect(lines.some((line) => line.includes("launchd LaunchAgent"))).toBe(true);
	});

	it("prints a manual hint when launchctl is unavailable", () => {
		const home = makeHome();
		const { io, lines } = fakeServiceIo("darwin", home, { binaryPath: "/opt/homebrew/bin/local-memory-mcp" });

		const result = installDaemon({ io });

		expect(result.hint).toBe(true);
		expect(fs.existsSync(launchdPlistPath(home))).toBe(false);
		expect(lines.some((line) => line.includes("launchctl not found"))).toBe(true);
	});

	it("unloads and deletes the plist", () => {
		const home = makeHome();
		fs.mkdirSync(path.dirname(launchdPlistPath(home)), { recursive: true });
		fs.writeFileSync(launchdPlistPath(home), "plist\n", "utf8");
		const { io, calls } = fakeServiceIo("darwin", home, { available: ["launchctl"] });

		const result = uninstallDaemon({ io });

		expect(result.uninstalled).toBe(true);
		expect(fs.existsSync(launchdPlistPath(home))).toBe(false);
		expect(calls).toContainEqual({ command: "launchctl", args: ["unload", "-w", launchdPlistPath(home)] });
	});

	it("is graceful when not installed", () => {
		const home = makeHome();
		const { io, lines } = fakeServiceIo("darwin", home, { available: ["launchctl"] });

		const result = uninstallDaemon({ io });

		expect(result.uninstalled).toBe(false);
		expect(lines).toEqual(["Daemon service not installed"]);
	});
});

describe("daemon install/uninstall — Windows Task Scheduler", () => {
	it("creates the ONLOGON task with an absolute command", () => {
		const home = makeHome();
		const { io, calls, lines } = fakeServiceIo("win32", home, {
			available: ["schtasks"],
			binaryPath: "C:\\bin\\local-memory-mcp.cmd",
			username: "alice"
		});

		const result = installDaemon({ io });

		expect(result.installed).toBe(true);
		const create = calls.find((call) => call.args.includes("/create"));
		expect(create?.command).toBe("schtasks");
		expect(create?.args).toEqual([
			"/create",
			"/tn",
			WINDOWS_TASK_NAME,
			"/tr",
			buildSchtasksCommand({ program: "C:\\bin\\local-memory-mcp.cmd", args: ["--daemon-worker"] }),
			"/sc",
			"ONLOGON",
			"/ru",
			"alice",
			"/f"
		]);
		expect(lines.some((line) => line.includes("scheduled task"))).toBe(true);
	});

	it("warns and skips when the task already exists (no --force)", () => {
		const home = makeHome();
		const { io, lines } = fakeServiceIo("win32", home, { available: ["schtasks"] });
		io.run = (command, args) => {
			if (command === "schtasks" && args[0] === "/query") return { status: 0, stdout: "task", stderr: "" };
			if (command === "where.exe") return { status: 0, stdout: "C:\\bin\\local-memory-mcp.cmd\n", stderr: "" };
			return { status: 0, stdout: "", stderr: "" };
		};

		const result = installDaemon({ io });

		expect(result.alreadyInstalled).toBe(true);
		expect(lines.some((line) => line.includes("already installed"))).toBe(true);
	});

	it("prints a Startup-folder hint when schtasks is unavailable", () => {
		const home = makeHome();
		const { io, lines } = fakeServiceIo("win32", home);

		const result = installDaemon({ io });

		expect(result.hint).toBe(true);
		expect(lines.some((line) => line.includes("Startup folder"))).toBe(true);
	});

	it("deletes the task on uninstall", () => {
		const home = makeHome();
		const { io, calls } = fakeServiceIo("win32", home, { available: ["schtasks"] });
		io.run = (command, args) => {
			if (command === "where.exe") return { status: 0, stdout: "schtasks\n", stderr: "" };
			if (command === "schtasks" && args[0] === "/query") return { status: 0, stdout: "task", stderr: "" };
			calls.push({ command, args });
			return { status: 0, stdout: "", stderr: "" };
		};

		const result = uninstallDaemon({ io });

		expect(result.uninstalled).toBe(true);
		expect(calls).toContainEqual({ command: "schtasks", args: ["/delete", "/tn", WINDOWS_TASK_NAME, "/f"] });
	});

	it("is graceful when the task is not installed", () => {
		const home = makeHome();
		const { io, lines } = fakeServiceIo("win32", home, { available: ["schtasks"] });
		io.run = (command, args) => {
			if (command === "where.exe") return { status: 0, stdout: "schtasks\n", stderr: "" };
			if (command === "schtasks" && args[0] === "/query") return { status: 1, stdout: "", stderr: "no task" };
			return { status: 0, stdout: "", stderr: "" };
		};

		const result = uninstallDaemon({ io });

		expect(result.uninstalled).toBe(false);
		expect(lines).toEqual(["Daemon service not installed"]);
	});
});

describe("daemon install — unit/plist builders", () => {
	it("quotes systemd args containing whitespace", () => {
		const unit = buildSystemdUnit({ program: "/usr/bin/node", args: ["/a b/server.js", "daemon"] });
		expect(unit).toContain('ExecStart=/usr/bin/node "/a b/server.js" daemon');
	});

	it("omits WorkingDirectory from the systemd unit when not seeded (back-compat)", () => {
		const unit = buildSystemdUnit({ program: "/usr/bin/node", args: ["daemon"] });
		expect(unit).not.toContain("WorkingDirectory=");
	});

	it("emits WorkingDirectory in the systemd unit when seeded (FIX-110-B)", () => {
		const unit = buildSystemdUnit({ program: "/usr/bin/node", args: ["daemon"] }, "/projects/widget");
		expect(unit).toContain("WorkingDirectory=/projects/widget");
	});

	it("escapes XML in plist values", () => {
		const plist = buildLaunchdPlist({ program: "/usr/bin/node", args: ["/a&b.js"] }, "/log&dir/daemon.log");
		expect(plist).toContain("<string>/a&amp;b.js</string>");
		expect(plist).toContain("<string>/log&amp;dir/daemon.log</string>");
	});

	it("omits the WorkingDirectory key from the plist when not seeded (back-compat)", () => {
		const plist = buildLaunchdPlist({ program: "/usr/bin/node", args: ["daemon"] }, "/log/daemon.log");
		expect(plist).not.toContain("<key>WorkingDirectory</key>");
	});

	it("emits an escaped WorkingDirectory key in the plist when seeded (FIX-110-B)", () => {
		const plist = buildLaunchdPlist({ program: "/usr/bin/node", args: ["daemon"] }, "/log/daemon.log", "/a&b");
		expect(plist).toContain("<key>WorkingDirectory</key>");
		expect(plist).toContain("<string>/a&amp;b</string>");
	});
});

describe("daemon install — PATH seeding (FIX-129)", () => {
	/** A deterministic ServiceIo with the installing Node under an nvm-style dir. */
	function pathIo(platform: NodeJS.Platform): ServiceIo {
		return { ...fakeServiceIo(platform, makeHome()).io, execPath: "/opt/nvm/bin/node" };
	}

	it("servicePath puts the installing node's dir first, dedupes, and appends platform defaults", () => {
		const io = pathIo("linux");
		const parts = servicePath(io).split(":");

		expect(parts[0]).toBe("/opt/nvm/bin");
		// Platform defaults are always present.
		for (const dir of ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
			expect(parts).toContain(dir);
		}
		// Deduped, first-seen order preserved.
		expect(new Set(parts).size).toBe(parts.length);
		// The node dir appears exactly once even if the host PATH already has it.
		expect(parts.filter((part) => part === "/opt/nvm/bin")).toHaveLength(1);
	});

	it("uses `;` as the delimiter on Windows", () => {
		const io = pathIo("win32");
		expect(servicePath(io)).toContain(";");
		expect(servicePath(io).split(";")[0]).toBe("/opt/nvm/bin");
	});

	it("seeds a PATH entry into the launchd plist starting with the node dir", () => {
		const io = pathIo("darwin");
		const plist = buildLaunchdPlist({ program: "/usr/bin/node", args: ["daemon"] }, "/log/daemon.log", undefined, {
			env: { PATH: servicePath(io) }
		});

		expect(plist).toContain("<key>EnvironmentVariables</key>");
		expect(plist).toContain("<key>PATH</key>");
		const match = plist.match(/<key>PATH<\/key>\s*<string>([^<]*)<\/string>/);
		expect(match?.[1].startsWith(path.dirname(io.execPath))).toBe(true);
	});

	it("seeds an Environment=PATH= line into the systemd unit starting with the node dir", () => {
		const io = pathIo("linux");
		const unit = buildSystemdUnit({ program: "/usr/bin/node", args: ["daemon"] }, undefined, {
			env: { PATH: servicePath(io) }
		});

		const line = unit.split("\n").find((entry) => entry.startsWith("Environment=PATH="));
		expect(line).toBeDefined();
		const value = line!.slice("Environment=PATH=".length);
		expect(value.startsWith(path.dirname(io.execPath))).toBe(true);
	});

	it("omits the EnvironmentVariables dict from the plist when no env is seeded (back-compat)", () => {
		const plist = buildLaunchdPlist({ program: "/usr/bin/node", args: ["daemon"] }, "/log/daemon.log", undefined, {});
		expect(plist).not.toContain("<key>EnvironmentVariables</key>");
	});
});

describe("daemon install — service env persistence (FEAT-DAEMON-002F)", () => {
	/** Fresh config dir (mirrors a real `<configDir>`) for env-resolution tests. */
	function makeConfigDir(): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmc-cfg-"));
		tempDirs.push(dir);
		return dir;
	}

	describe("resolveServiceEnv", () => {
		it("reads non-secret knobs from config.jsonc (allowlisted keys only)", () => {
			const dir = makeConfigDir();
			fs.writeFileSync(
				path.join(dir, "config.jsonc"),
				'{ "WORKER_POOL_SIZE": 6, "EMBEDDING_ONNX_THREADS": 4, "MCP_HTTP_PORT": 4000 }'
			);

			expect(resolveServiceEnv(dir)).toEqual({
				WORKER_POOL_SIZE: "6",
				EMBEDDING_ONNX_THREADS: "4",
				MCP_HTTP_PORT: "4000"
			});
		});

		it("reads non-secret knobs from .env and lets config.jsonc win", () => {
			const dir = makeConfigDir();
			fs.writeFileSync(path.join(dir, "config.jsonc"), '{ "WORKER_POOL_SIZE": 6 }');
			fs.writeFileSync(path.join(dir, ".env"), "WORKER_POOL_SIZE=2\nEMBEDDING_WORKER_POOL_SIZE=3\n");

			expect(resolveServiceEnv(dir)).toEqual({
				WORKER_POOL_SIZE: "6",
				EMBEDDING_WORKER_POOL_SIZE: "3"
			});
		});

		it("EXCLUDES a secret key (not on the allowlist) — never surfaced", () => {
			const dir = makeConfigDir();
			fs.writeFileSync(path.join(dir, ".env"), "WORKER_POOL_SIZE=8\nGITHUB_TOKEN=ghp_supersecret\nAPI_KEY=abc123\n");

			const env = resolveServiceEnv(dir);
			expect(env).toEqual({ WORKER_POOL_SIZE: "8" });
			expect(JSON.stringify(env)).not.toContain("supersecret");
			expect(JSON.stringify(env)).not.toContain("abc123");
			// The allowlist itself must not contain obvious secret-bearing names.
			for (const key of SERVICE_ENV_ALLOWLIST) {
				expect(key).not.toMatch(/TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/i);
			}
		});

		it("returns {} when no config files exist (defaults apply, no crash)", () => {
			expect(resolveServiceEnv(makeConfigDir())).toEqual({});
		});

		it("ignores a malformed config.jsonc without crashing", () => {
			const dir = makeConfigDir();
			fs.writeFileSync(path.join(dir, "config.jsonc"), "{ this is not json");
			expect(resolveServiceEnv(dir)).toEqual({});
		});

		it("drops empty-string values", () => {
			const dir = makeConfigDir();
			fs.writeFileSync(path.join(dir, ".env"), "WORKER_POOL_SIZE=\n");
			expect(resolveServiceEnv(dir)).toEqual({});
		});
	});

	describe("buildSystemdUnit env block", () => {
		it("emits EnvironmentFile= plus Environment= lines for resolved knobs", () => {
			const unit = buildSystemdUnit({ program: "/usr/bin/node", args: ["daemon"] }, undefined, {
				environmentFile: "/home/u/.config/local-memory-mcp/.env",
				env: { WORKER_POOL_SIZE: "6", MCP_HTTP_PORT: "4000" }
			});
			expect(unit).toContain("EnvironmentFile=-/home/u/.config/local-memory-mcp/.env");
			expect(unit).toContain("Environment=WORKER_POOL_SIZE=6");
			expect(unit).toContain("Environment=MCP_HTTP_PORT=4000");
		});

		it("quotes an Environment value containing whitespace", () => {
			const unit = buildSystemdUnit({ program: "/usr/bin/node", args: ["daemon"] }, undefined, {
				env: { LOCAL_MEMORY_DEFAULT_REPO: "a b" }
			});
			expect(unit).toContain('Environment=LOCAL_MEMORY_DEFAULT_REPO="a b"');
		});

		it("omits the env block when not provided (back-compat)", () => {
			const unit = buildSystemdUnit({ program: "/usr/bin/node", args: ["daemon"] });
			expect(unit).not.toContain("Environment=");
			expect(unit).not.toContain("EnvironmentFile=");
		});

		it("never writes a secret value into the unit (only the EnvironmentFile reference)", () => {
			const dir = makeConfigDir();
			fs.writeFileSync(path.join(dir, ".env"), "GITHUB_TOKEN=ghp_supersecret\nWORKER_POOL_SIZE=6\n");
			const unit = buildSystemdUnit({ program: "/usr/bin/node", args: ["daemon"] }, undefined, {
				environmentFile: path.join(dir, ".env"),
				env: resolveServiceEnv(dir)
			});
			expect(unit).toContain("Environment=WORKER_POOL_SIZE=6");
			expect(unit).not.toContain("supersecret");
			expect(unit).not.toContain("GITHUB_TOKEN");
		});
	});

	describe("buildLaunchdPlist env block", () => {
		it("emits an EnvironmentVariables dict with the resolved knobs", () => {
			const plist = buildLaunchdPlist({ program: "/usr/bin/node", args: ["daemon"] }, "/log/daemon.log", undefined, {
				env: { WORKER_POOL_SIZE: "6", EMBEDDING_ONNX_THREADS: "4" }
			});
			expect(plist).toContain("<key>EnvironmentVariables</key>");
			expect(plist).toContain("<key>WORKER_POOL_SIZE</key>");
			expect(plist).toContain("<string>6</string>");
			expect(plist).toContain("<key>EMBEDDING_ONNX_THREADS</key>");
			expect(plist).toContain("<string>4</string>");
		});

		it("escapes XML in env keys and values", () => {
			const plist = buildLaunchdPlist({ program: "/usr/bin/node", args: ["daemon"] }, "/log/daemon.log", undefined, {
				env: { LOCAL_MEMORY_DEFAULT_REPO: "a&b" }
			});
			expect(plist).toContain("<string>a&amp;b</string>");
		});

		it("omits the EnvironmentVariables dict when empty (back-compat)", () => {
			const plist = buildLaunchdPlist({ program: "/usr/bin/node", args: ["daemon"] }, "/log/daemon.log");
			expect(plist).not.toContain("<key>EnvironmentVariables</key>");
		});

		it("never writes a secret value into the plist", () => {
			const dir = makeConfigDir();
			fs.writeFileSync(path.join(dir, ".env"), "GITHUB_TOKEN=ghp_supersecret\nWORKER_POOL_SIZE=6\n");
			const plist = buildLaunchdPlist({ program: "/usr/bin/node", args: ["daemon"] }, "/log/daemon.log", undefined, {
				env: resolveServiceEnv(dir)
			});
			expect(plist).toContain("<string>6</string>");
			expect(plist).not.toContain("supersecret");
			expect(plist).not.toContain("GITHUB_TOKEN");
		});
	});

	describe("installDaemon integration — env persisted to the service file", () => {
		it("writes resolved knobs + EnvironmentFile= into the systemd unit", () => {
			const home = makeHome();
			const paths = makePaths();
			fs.writeFileSync(path.join(paths.dir, "config.jsonc"), '{ "WORKER_POOL_SIZE": 6 }');
			fs.writeFileSync(path.join(paths.dir, ".env"), "GITHUB_TOKEN=ghp_supersecret\nEMBEDDING_ONNX_THREADS=4\n");
			const { io } = fakeServiceIo("linux", home, {
				available: ["systemctl"],
				binaryPath: "/usr/local/bin/local-memory-mcp"
			});

			installDaemon({ io, paths });

			const unit = fs.readFileSync(systemdUnitPath(home), "utf8");
			expect(unit).toContain(`EnvironmentFile=-${path.join(paths.dir, ".env")}`);
			expect(unit).toContain("Environment=WORKER_POOL_SIZE=6");
			expect(unit).toContain("Environment=EMBEDDING_ONNX_THREADS=4");
			expect(unit).not.toContain("supersecret");
			expect(unit).not.toContain("GITHUB_TOKEN");
		});

		it("writes resolved knobs into the launchd plist (no secrets)", () => {
			const home = makeHome();
			const paths: DaemonPaths = {
				dir: home,
				pidFile: path.join(home, "daemon.pid"),
				logFile: path.join(home, "daemon.log"),
				lockFile: path.join(home, "daemon.lock")
			};
			fs.writeFileSync(path.join(home, ".env"), "WORKER_POOL_SIZE=6\nGITHUB_TOKEN=ghp_supersecret\n");
			const { io } = fakeServiceIo("darwin", home, {
				available: ["launchctl"],
				binaryPath: "/opt/homebrew/bin/local-memory-mcp"
			});

			installDaemon({ io, paths });

			const plist = fs.readFileSync(launchdPlistPath(home), "utf8");
			expect(plist).toContain("<key>EnvironmentVariables</key>");
			expect(plist).toContain("<key>WORKER_POOL_SIZE</key>");
			expect(plist).toContain("<string>6</string>");
			expect(plist).not.toContain("supersecret");
			expect(plist).not.toContain("GITHUB_TOKEN");
		});

		it("still installs (defaults, no crash) when the config dir has no files", () => {
			const home = makeHome();
			const paths = makePaths();
			const { io } = fakeServiceIo("linux", home, { available: ["systemctl"] });

			const result = installDaemon({ io, paths });

			expect(result.installed).toBe(true);
			const unit = fs.readFileSync(systemdUnitPath(home), "utf8");
			// EnvironmentFile= is still emitted (leading `-` tolerates the missing file).
			expect(unit).toContain(`EnvironmentFile=-${path.join(paths.dir, ".env")}`);
			// FIX-129: PATH is always seeded; no other knob is emitted when the
			// config dir has no files.
			expect(unit).toMatch(/^Environment=PATH=/m);
			expect(unit).not.toMatch(/^Environment=(?!PATH=)/m);
		});
	});
});
