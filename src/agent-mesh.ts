// ============================================================
// Agent Mesh over MCP
//
// Lets several MCP clients (Claude Code, ChatGPT via Codex,
// Cursor, custom agents) share a workspace through this server:
//
//   - register / list / heartbeat agents
//   - send direct messages (DM) + broadcast on channels
//   - subscribe-and-poll for new messages
//   - hand off tasks between agents with a status machine
//   - cast adversarial votes on findings
//   - write / read a shared knowledge-base (key -> value)
//   - acquire / release named locks for coordination
//
// Persistence: JSON files under `<project>/.agent-mesh/`. No new
// npm deps. Multiple MCP clients writing to the same file are
// coordinated with an in-process `AsyncLock` plus atomic
// write-then-rename.
// ============================================================

import { mkdir, readFile, writeFile, rename, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

interface AgentRecord {
  id: string;
  name: string;
  kind: string;            // 'claude' | 'chatgpt' | 'cursor' | 'custom'
  capabilities: string[];  // free-form tags: ['re', 'exploit', 'bypass']
  registeredAt: number;
  lastSeen: number;
  meta?: Record<string, unknown>;
}

interface Message {
  id: string;
  ts: number;
  from: string;            // agent id
  to: string | null;       // agent id for DM, null for channel broadcast
  channel: string | null;  // channel name for broadcast, null for DM
  text: string;
  meta?: Record<string, unknown>;
  replyTo?: string;        // message id this replies to
}

interface Task {
  id: string;
  createdAt: number;
  updatedAt: number;
  from: string;
  to: string;
  title: string;
  spec: string;            // free-form task description
  status: "pending" | "accepted" | "in_progress" | "completed" | "rejected" | "failed";
  result?: string;
  votes: { by: string; verdict: "approve" | "reject" | "needs_work"; confidence: number; comment?: string; ts: number }[];
}

interface Knowledge {
  key: string;
  value: unknown;
  by: string;
  updatedAt: number;
  version: number;
}

interface Lock {
  resource: string;
  heldBy: string;
  acquiredAt: number;
  expiresAt: number;
  renewToken: string;
}

interface MeshState {
  agents: Record<string, AgentRecord>;
  messages: Message[];
  tasks: Record<string, Task>;
  knowledge: Record<string, Knowledge>;
  locks: Record<string, Lock>;
}

// ------------------------------------------------------------
// Persistence (zero-dep)
// ------------------------------------------------------------

const MESH_DIR_ENV = "MCP_AGENT_MESH_DIR";

async function pathExists(p: string): Promise<boolean> {
  try { await access(p, fsConstants.F_OK); return true; } catch { return false; }
}

class MeshStore {
  private file: string;
  private state: MeshState;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(file: string, initial: MeshState) {
    this.file = file;
    this.state = initial;
  }

  static async open(dir: string): Promise<MeshStore> {
    await mkdir(dir, { recursive: true });
    const file = join(dir, "mesh.json");
    let initial: MeshState = { agents: {}, messages: [], tasks: {}, knowledge: {}, locks: {} };
    if (await pathExists(file)) {
      try {
        const raw = await readFile(file, "utf8");
        initial = { ...initial, ...JSON.parse(raw) };
      } catch { /* ignore corrupt, start fresh */ }
    }
    return new MeshStore(file, initial);
  }

  get(): MeshState { return this.state; }

  async mutate<T>(fn: (s: MeshState) => T): Promise<T> {
    const result = fn(this.state);
    // Enqueue a serialized write so concurrent mutates don't interleave file writes
    this.writeChain = this.writeChain.then(() => this.persist()).catch(() => this.persist());
    await this.writeChain;
    return result;
  }

  private async persist(): Promise<void> {
    const tmp = this.file + "." + process.pid + ".tmp";
    const data = JSON.stringify(this.state, null, 2);
    await writeFile(tmp, data, "utf8");
    await rename(tmp, this.file);
  }
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export async function registerAgentMesh(server: McpServer, projectRoot: string): Promise<void> {
  const dir = process.env[MESH_DIR_ENV] ?? join(projectRoot, ".agent-mesh");
  const store = await MeshStore.open(dir);

  const now = () => Date.now();
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const err = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true as const });

  // --------- agents ---------
  server.tool(
    "mesh_agent_register",
    "Register this client as an agent in the mesh. Returns an agent_id to use in subsequent calls. Idempotent on `name` — same name re-registers and keeps the id.",
    {
      name: z.string().describe("Agent name (unique). E.g. 'claude-code-pat', 'codex-ci', 'cursor-vicky'."),
      kind: z.enum(["claude", "chatgpt", "codex", "cursor", "copilot", "gemini", "custom"]).default("custom"),
      capabilities: z.array(z.string()).default([]).describe("Free-form capability tags, e.g. ['re', 'exploit', 'bypass']"),
      meta: z.record(z.string(), z.unknown()).optional(),
    },
    async ({ name, kind, capabilities, meta }: { name: string; kind: string; capabilities: string[]; meta?: Record<string, unknown> }) => {
      const id = await store.mutate((s) => {
        const existing = Object.values(s.agents).find((a) => a.name === name);
        if (existing) {
          existing.lastSeen = now();
          existing.capabilities = capabilities.length ? capabilities : existing.capabilities;
          if (meta) existing.meta = { ...existing.meta, ...meta };
          return existing.id;
        }
        const newId = randomUUID();
        s.agents[newId] = { id: newId, name, kind, capabilities, registeredAt: now(), lastSeen: now(), meta };
        return newId;
      });
      return ok(`registered agent_id=${id} name=${name} kind=${kind}`);
    }
  );

  server.tool(
    "mesh_agent_list",
    "List agents currently in the mesh. Optional filter by kind or capability.",
    {
      kind: z.string().optional(),
      capability: z.string().optional(),
      activeWithinSec: z.number().optional().describe("Only show agents heard from within last N seconds."),
    },
    async ({ kind, capability, activeWithinSec }: { kind?: string; capability?: string; activeWithinSec?: number }) => {
      const s = store.get();
      const cutoff = activeWithinSec ? now() - activeWithinSec * 1000 : 0;
      const rows = Object.values(s.agents)
        .filter((a) => (!kind || a.kind === kind))
        .filter((a) => (!capability || a.capabilities.includes(capability)))
        .filter((a) => (!cutoff || a.lastSeen >= cutoff))
        .map((a) => `- **${a.name}** (${a.kind}) id=${a.id} caps=${a.capabilities.join(",") || "-"} lastSeen=${new Date(a.lastSeen).toISOString()}`);
      if (!rows.length) return ok("no agents");
      return ok(`# Agents (${rows.length})\n\n${rows.join("\n")}`);
    }
  );

  server.tool(
    "mesh_agent_heartbeat",
    "Heartbeat for an agent. Keeps `lastSeen` fresh so other agents filter stale actors with `activeWithinSec`.",
    { agent_id: z.string() },
    async ({ agent_id }: { agent_id: string }) => {
      const found = await store.mutate((s) => { const a = s.agents[agent_id]; if (!a) return false; a.lastSeen = now(); return true; });
      return found ? ok(`heartbeat ${agent_id}`) : err(`unknown agent_id ${agent_id}`);
    }
  );

  // --------- messaging ---------
  server.tool(
    "mesh_send",
    "Send a direct message to another agent (`to`) OR broadcast on a channel (`channel`). Exactly one of to/channel must be provided.",
    {
      from: z.string().describe("Your agent_id (from mesh_agent_register)."),
      to: z.string().optional().describe("Target agent_id for a DM."),
      channel: z.string().optional().describe("Channel name for a broadcast (e.g. 'findings', 'bypass-ideas')."),
      text: z.string().describe("Message body (markdown supported)."),
      replyTo: z.string().optional().describe("Message id you are replying to."),
      meta: z.record(z.string(), z.unknown()).optional(),
    },
    async ({ from, to, channel, text, replyTo, meta }: { from: string; to?: string; channel?: string; text: string; replyTo?: string; meta?: Record<string, unknown> }) => {
      if ((to && channel) || (!to && !channel)) return err("exactly one of `to` or `channel` must be set");
      const sender = store.get().agents[from];
      if (!sender) return err(`unknown sender agent_id ${from}`);
      if (to && !store.get().agents[to]) return err(`unknown recipient agent_id ${to}`);
      const id = randomUUID();
      await store.mutate((s) => {
        s.messages.push({ id, ts: now(), from, to: to ?? null, channel: channel ?? null, text, meta, replyTo });
        if (s.messages.length > 5000) s.messages.splice(0, s.messages.length - 5000);
        sender.lastSeen = now();
      });
      return ok(`sent id=${id} ${to ? `-> agent ${to}` : `#${channel}`}`);
    }
  );

  server.tool(
    "mesh_read",
    "Read messages for an agent. Returns DMs addressed to the agent and messages on channels they subscribe to. Use `since` for incremental reads.",
    {
      agent_id: z.string().describe("Your agent_id."),
      channels: z.array(z.string()).default([]).describe("Channels this agent cares about."),
      sinceMs: z.number().optional().describe("Return messages newer than this epoch ms. Omit for last 100."),
      limit: z.number().min(1).max(1000).default(100),
    },
    async ({ agent_id, channels, sinceMs, limit }: { agent_id: string; channels: string[]; sinceMs?: number; limit: number }) => {
      const s = store.get();
      const chSet = new Set(channels);
      const msgs = s.messages
        .filter((m) => (sinceMs == null || m.ts > sinceMs))
        .filter((m) => (m.to === agent_id) || (m.channel && chSet.has(m.channel)) || (m.from === agent_id))
        .slice(-limit);
      // mark heartbeat
      await store.mutate((st) => { const a = st.agents[agent_id]; if (a) a.lastSeen = now(); });
      if (!msgs.length) return ok("no new messages");
      const lines = msgs.map((m) => {
        const kind = m.to ? `DM ${m.to}` : `#${m.channel}`;
        return `[${new Date(m.ts).toISOString()}] ${s.agents[m.from]?.name ?? m.from} -> ${kind}${m.replyTo ? ` (replyTo ${m.replyTo})` : ""} :: ${m.text}`;
      });
      return ok(`# messages (${msgs.length})\n\n${lines.join("\n")}\n\n_sinceMs cursor: ${msgs[msgs.length - 1].ts}_`);
    }
  );

  // --------- tasks + handoff ---------
  server.tool(
    "mesh_task_create",
    "Hand off a task to another agent. Returns a task_id.",
    {
      from: z.string(),
      to: z.string(),
      title: z.string(),
      spec: z.string().describe("Full task description, acceptance criteria, context."),
    },
    async ({ from, to, title, spec }: { from: string; to: string; title: string; spec: string }) => {
      if (!store.get().agents[from]) return err(`unknown sender ${from}`);
      if (!store.get().agents[to]) return err(`unknown recipient ${to}`);
      const id = randomUUID();
      await store.mutate((s) => {
        s.tasks[id] = { id, createdAt: now(), updatedAt: now(), from, to, title, spec, status: "pending", votes: [] };
      });
      return ok(`created task_id=${id} ${title}  (${from} -> ${to})`);
    }
  );

  server.tool(
    "mesh_task_update",
    "Update the status / result of a task. Only the current assignee or the task creator can update.",
    {
      actor: z.string().describe("Your agent_id."),
      task_id: z.string(),
      status: z.enum(["accepted", "in_progress", "completed", "rejected", "failed"]),
      result: z.string().optional().describe("Final result, errors, or progress note."),
    },
    async ({ actor, task_id, status, result }: { actor: string; task_id: string; status: Task["status"]; result?: string }) => {
      const r = await store.mutate((s) => {
        const t = s.tasks[task_id]; if (!t) return "not_found";
        if (actor !== t.to && actor !== t.from) return "forbidden";
        t.status = status; t.updatedAt = now(); if (result) t.result = result;
        return "ok";
      });
      if (r === "not_found") return err(`task ${task_id} not found`);
      if (r === "forbidden") return err("only the task's from / to may update");
      return ok(`task ${task_id} -> ${status}`);
    }
  );

  server.tool(
    "mesh_task_list",
    "List tasks involving an agent, filtered by status.",
    {
      agent_id: z.string(),
      status: z.enum(["pending", "accepted", "in_progress", "completed", "rejected", "failed"]).optional(),
    },
    async ({ agent_id, status }: { agent_id: string; status?: Task["status"] }) => {
      const s = store.get();
      const tasks = Object.values(s.tasks)
        .filter((t) => t.from === agent_id || t.to === agent_id)
        .filter((t) => !status || t.status === status);
      if (!tasks.length) return ok("no tasks");
      const lines = tasks.map((t) => `- **${t.title}** [${t.status}]  id=${t.id}  ${s.agents[t.from]?.name ?? t.from} -> ${s.agents[t.to]?.name ?? t.to}  votes=${t.votes.length}`);
      return ok(`# tasks (${tasks.length})\n\n${lines.join("\n")}`);
    }
  );

  // --------- adversarial voting ---------
  server.tool(
    "mesh_task_vote",
    "Cast an adversarial vote on a task's result. Multiple agents can vote; aggregate confidence drives consensus.",
    {
      voter: z.string(),
      task_id: z.string(),
      verdict: z.enum(["approve", "reject", "needs_work"]),
      confidence: z.number().min(0).max(1).describe("0..1 confidence."),
      comment: z.string().optional(),
    },
    async ({ voter, task_id, verdict, confidence, comment }: { voter: string; task_id: string; verdict: "approve" | "reject" | "needs_work"; confidence: number; comment?: string }) => {
      const r = await store.mutate((s) => {
        const t = s.tasks[task_id]; if (!t) return "not_found";
        t.votes = t.votes.filter((v) => v.by !== voter);
        t.votes.push({ by: voter, verdict, confidence, comment, ts: now() });
        t.updatedAt = now();
        return "ok";
      });
      if (r === "not_found") return err(`task ${task_id} not found`);
      // Return current tally
      const t = store.get().tasks[task_id];
      const tally = { approve: 0, reject: 0, needs_work: 0 };
      for (const v of t.votes) tally[v.verdict] += v.confidence;
      return ok(`vote recorded. tally approve=${tally.approve.toFixed(2)} reject=${tally.reject.toFixed(2)} needs_work=${tally.needs_work.toFixed(2)}`);
    }
  );

  // --------- shared knowledge-base ---------
  server.tool(
    "mesh_kb_set",
    "Write a key -> value entry into the shared knowledge base. Value is any JSON-serializable payload.",
    {
      author: z.string(),
      key: z.string(),
      value: z.unknown(),
    },
    async ({ author, key, value }: { author: string; key: string; value: unknown }) => {
      const v = await store.mutate((s) => {
        const prev = s.knowledge[key];
        const next: Knowledge = { key, value, by: author, updatedAt: now(), version: (prev?.version ?? 0) + 1 };
        s.knowledge[key] = next;
        return next.version;
      });
      return ok(`kb[${key}] = ${JSON.stringify(value).slice(0, 500)} (v${v})`);
    }
  );

  server.tool(
    "mesh_kb_get",
    "Read a key from the shared knowledge base. Supports a glob prefix via `prefix`.",
    { key: z.string().optional(), prefix: z.string().optional() },
    async ({ key, prefix }: { key?: string; prefix?: string }) => {
      const s = store.get();
      if (key) {
        const k = s.knowledge[key];
        if (!k) return err(`kb[${key}] not set`);
        return ok(`${key} = ${JSON.stringify(k.value, null, 2)}\n(set by ${k.by} at ${new Date(k.updatedAt).toISOString()}, v${k.version})`);
      }
      const list = Object.keys(s.knowledge).filter((k) => !prefix || k.startsWith(prefix)).sort();
      if (!list.length) return ok("empty");
      return ok(`# kb keys (${list.length})\n${list.join("\n")}`);
    }
  );

  // --------- locks ---------
  server.tool(
    "mesh_lock_acquire",
    "Acquire a named lock for coordination. Returns a renew token. Lock auto-expires after `ttlSec`.",
    {
      resource: z.string(),
      holder: z.string(),
      ttlSec: z.number().min(1).max(3600).default(60),
    },
    async ({ resource, holder, ttlSec }: { resource: string; holder: string; ttlSec: number }) => {
      const r = await store.mutate((s) => {
        const existing = s.locks[resource];
        if (existing && existing.expiresAt > now() && existing.heldBy !== holder) return { ok: false as const, heldBy: existing.heldBy, expiresAt: existing.expiresAt };
        const token = randomUUID();
        s.locks[resource] = { resource, heldBy: holder, acquiredAt: now(), expiresAt: now() + ttlSec * 1000, renewToken: token };
        return { ok: true as const, token };
      });
      if (!r.ok) return err(`locked by ${r.heldBy} until ${new Date(r.expiresAt).toISOString()}`);
      return ok(`locked ${resource} by ${holder} for ${ttlSec}s. token=${r.token}`);
    }
  );

  server.tool(
    "mesh_lock_release",
    "Release a held lock using the renew token.",
    { resource: z.string(), token: z.string() },
    async ({ resource, token }: { resource: string; token: string }) => {
      const r = await store.mutate((s) => {
        const existing = s.locks[resource];
        if (!existing) return "not_held";
        if (existing.renewToken !== token) return "bad_token";
        delete s.locks[resource];
        return "ok";
      });
      if (r === "not_held") return err("not held");
      if (r === "bad_token") return err("wrong token");
      return ok(`released ${resource}`);
    }
  );

  server.tool(
    "mesh_lock_list",
    "List currently-held locks.",
    {},
    async () => {
      const s = store.get();
      const held = Object.values(s.locks).filter((l) => l.expiresAt > now());
      if (!held.length) return ok("no locks held");
      return ok(held.map((l) => `- ${l.resource} by ${l.heldBy} until ${new Date(l.expiresAt).toISOString()}`).join("\n"));
    }
  );

  // --------- stats ---------
  server.tool(
    "mesh_stats",
    "Return mesh statistics: # agents, # messages, # tasks by status, # kb entries, # locks.",
    {},
    async () => {
      const s = store.get();
      const taskStatus: Record<string, number> = {};
      for (const t of Object.values(s.tasks)) taskStatus[t.status] = (taskStatus[t.status] ?? 0) + 1;
      return ok(
        `# agent-mesh stats\n` +
        `- agents: ${Object.keys(s.agents).length}\n` +
        `- messages: ${s.messages.length}\n` +
        `- tasks: ${JSON.stringify(taskStatus)}\n` +
        `- kb entries: ${Object.keys(s.knowledge).length}\n` +
        `- locks held: ${Object.values(s.locks).filter((l) => l.expiresAt > now()).length}\n` +
        `- dir: ${dir}`
      );
    }
  );
}
