/**
 * Real-server harness for the integration suite, the drift test and
 * `npm run schema:update`. Spawns the `ai-memory` binary named by
 * `AI_MEMORY_BIN` on a free loopback port with a temporary data directory and
 * an environment built from scratch: no `AI_MEMORY_*` variable from the
 * developer's shell reaches the server.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface ServerOptions {
  /** Mount `/api/v1` (`--enable-api`). Default true. */
  api?: boolean;
  /** Serve under a URL prefix (`--base-path`). */
  basePath?: string;
  /** Stateful streamable HTTP (`--http-stateful`). */
  stateful?: boolean;
}

export interface ServerHandle {
  /** Base URL, including the base path when one is set. */
  readonly url: string;
  /** The synthetic root bearer token. */
  readonly rootToken: string;
  /** Run an `ai-memory` CLI command against this server's data dir. */
  cli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }>;
  /** Create a human DB user and an `aim_` key for it; returns the key. */
  addUser(username: string): Promise<string>;
  /** Record a completed session with three observations; returns its id. */
  seedSession(workspace: string, project: string, nativeId: string): Promise<string>;
  /** Stop the server and remove its temporary directory. */
  stop(): Promise<void>;
}

/**
 * The binary under test, from `AI_MEMORY_BIN`. A relative path is resolved
 * against the directory the tests run from: the server is spawned with its
 * own temporary `cwd`, where `../../target/debug/ai-memory` would not exist,
 * and a failed spawn never emits the `exit` the harness waits on.
 */
export function serverBinary(): string {
  const bin = process.env["AI_MEMORY_BIN"];
  if (bin === undefined || bin === "") {
    throw new Error(
      "AI_MEMORY_BIN must name a built ai-memory binary (cargo build --bin ai-memory)",
    );
  }
  return resolve(bin);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(
  bin: string,
  args: string[],
  env: Record<string, string>,
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Start one isolated server and wait until `/identity` answers. */
export async function startServer(options: ServerOptions = {}): Promise<ServerHandle> {
  const bin = serverBinary();
  const root = await mkdtemp(join(tmpdir(), "ai-memory-ts-it-"));
  const home = join(root, "home");
  const data = join(root, "data");
  const tmp = join(root, "tmp");
  const project = join(root, "project");
  await Promise.all([home, data, tmp, project].map((dir) => mkdir(dir, { recursive: true })));
  const gitconfig = join(root, "gitconfig");
  await writeFile(gitconfig, "");
  const port = await freePort();
  const rootToken = `FAKEsdkroot${randomBytes(12).toString("hex")}`;
  const basePath = options.basePath ?? "";
  const url = `http://127.0.0.1:${port}${basePath}`;

  const env: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    TMPDIR: tmp,
    PATH: "/usr/bin:/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_SYSTEM: gitconfig,
    AI_MEMORY_HOME: home,
    AI_MEMORY_EMBEDDING_PROVIDER: "none",
    AI_MEMORY_BACKFILL_ON_START: "false",
    AI_MEMORY_CONSOLIDATE_ON_SESSION_END: "false",
    AI_MEMORY_AUTO_IMPROVE__SCHEDULER__ENABLED: "false",
    AI_MEMORY_AUTH_TOKEN: rootToken,
    AI_MEMORY_AUTH__TOKEN_PEPPER: `FAKEsdkpepper${randomBytes(16).toString("hex")}`,
    RUST_LOG: "off",
  };
  const args = [
    "--data-dir",
    data,
    "serve",
    "--transport",
    "http",
    "--bind",
    `127.0.0.1:${port}`,
    "--no-watcher",
  ];
  if (options.api !== false) args.push("--enable-api");
  if (basePath !== "") args.push("--base-path", basePath);
  if (options.stateful === true) args.push("--http-stateful");

  const logPath = join(root, "server.log");
  const logFd = openSync(logPath, "w");
  const child: ChildProcess = spawn(bin, args, {
    env,
    cwd: project,
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);
  let exited = false;
  child.once("exit", () => (exited = true));

  const stop = async (): Promise<void> => {
    if (!exited) {
      const done = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGTERM");
      const killer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      await done;
      clearTimeout(killer);
    }
    await rm(root, { recursive: true, force: true });
  };

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited) {
      const log = await readFile(logPath, "utf8").catch(() => "");
      await rm(root, { recursive: true, force: true });
      throw new Error(`ai-memory exited before it was ready:\n${log.slice(-2000)}`);
    }
    try {
      const response = await fetch(`${url}/identity`, {
        headers: { Authorization: `Bearer ${rootToken}` },
        signal: AbortSignal.timeout(1_000),
      });
      await response.arrayBuffer();
      if (response.ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error("ai-memory did not become ready within 60 s");
    }
    await sleep(100);
  }

  const cliEnv = { ...env, AI_MEMORY_SERVER_URL: url };
  const cli = (cliArgs: string[]) => runCommand(bin, ["--data-dir", data, ...cliArgs], cliEnv, project);

  const addUser = async (username: string): Promise<string> => {
    const user = await cli(["user", "add-human", "--username", username, "--json"]);
    if (user.code !== 0) throw new Error(`user add-human failed: ${user.stderr}`);
    const key = await cli(["api-key", "add", "--username", username, "--label", "sdk-test", "--json"]);
    if (key.code !== 0) throw new Error(`api-key add failed: ${key.stderr}`);
    const token = (JSON.parse(key.stdout) as { token?: unknown }).token;
    if (typeof token !== "string") throw new Error("api-key add printed no token");
    return token;
  };

  const seedSession = async (workspace: string, projectName: string, nativeId: string) => {
    const cwd = `/work/${nativeId}`;
    for (const event of ["session-start", "user-prompt-submit", "session-end"]) {
      const response = await fetch(`${url}/hook/batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${rootToken}`, "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            url:
              `/hook?event=${event}&agent=claude-code` +
              `&workspace=${encodeURIComponent(workspace)}&project=${encodeURIComponent(projectName)}`,
            body: { session_id: nativeId, cwd, prompt: `Seeded prompt for ${nativeId}.` },
          },
        ]),
      });
      const ack = (await response.json()) as { accepted?: number };
      if (!response.ok || ack.accepted !== 1) throw new Error(`hook ${event} was not stored`);
    }
    const listing = await fetch(
      `${url}/api/v1/workspaces/${encodeURIComponent(workspace)}/projects/` +
        `${encodeURIComponent(projectName)}/sessions?include_open=true`,
      { headers: { Authorization: `Bearer ${rootToken}` } },
    );
    const { sessions } = (await listing.json()) as { sessions: { session_id: string; cwd: string }[] };
    const match = sessions.find((session) => session.cwd === cwd);
    if (match === undefined) throw new Error("seeded session not listed");
    return match.session_id;
  };

  return { url, rootToken, cli, addUser, seedSession, stop };
}
