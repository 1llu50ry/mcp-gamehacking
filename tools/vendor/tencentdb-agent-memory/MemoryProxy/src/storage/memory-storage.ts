/**
 * MemoryStorage —— ProxyStorage 的进程内 Map 实现。
 *
 * 定位：兜底后端。当 cos/sqlite/fs 都不可用时保证 proxy 不 crash，等价于当前
 * "什么都没配"的行为。**不适合生产**。
 *
 * TTL：暂不实现 sweeper（memory 后端只用于兜底 / 单元测试，进程重启就没）。
 *
 * 生产可观测性：每次 write 会以 60s 节流的频率打一条 error 日志，提醒运维当
 * 前是危险的兜底状态。见 docs/design/2026-07-13-proxy-multinode-state-audit.md P0-2。
 */
import type { ProxyStorage } from "./proxy-storage.js";

interface Entry {
  value: Buffer;
  updatedAt: number;
}

const TAG = "[storage/memory]";
const WARN_INTERVAL_MS = 60_000;

export class MemoryStorage implements ProxyStorage {
  readonly type = "memory" as const;
  private data = new Map<string, Entry>();
  private lastWarnAt = 0;
  private opsSinceLastWarn = 0;

  /**
   * 60s 一次的节流告警 —— 每次写都调用，累加计数，够 60s 才实际打日志。
   * 目的：让运维在多节点静默降级到 memory 时能在日志里看到大量 write，不会
   * 因为 warn-once 而错过（老实现是 factory 只 warn 一次就静默）。
   */
  private warnUsage(op: string): void {
    this.opsSinceLastWarn++;
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_INTERVAL_MS) return;
    console.error(
      `${TAG} !!! IN-MEMORY STORAGE ACTIVE !!! ${this.opsSinceLastWarn} ops in last`
      + ` ${Math.round((now - this.lastWarnAt) / 1000)}s (latest: ${op}). Data will NOT persist`
      + ` and is NOT visible to other proxy nodes.`,
    );
    this.lastWarnAt = now;
    this.opsSinceLastWarn = 0;
  }

  async putText(key: string, value: string): Promise<void> {
    this.warnUsage("putText");
    this.data.set(key, { value: Buffer.from(value, "utf-8"), updatedAt: Date.now() });
  }

  async putJSON(key: string, value: unknown): Promise<void> {
    return this.putText(key, JSON.stringify(value));
  }

  async putTextIfAbsent(key: string, value: string): Promise<boolean> {
    // JS 单线程 —— has/set 之间没有 race
    if (this.data.has(key)) return false;
    // 走 putText 会重复 warn 计一次，改直接 set 并计一次
    this.warnUsage("putTextIfAbsent");
    this.data.set(key, { value: Buffer.from(value, "utf-8"), updatedAt: Date.now() });
    return true;
  }

  async putJSONIfAbsent(key: string, value: unknown): Promise<boolean> {
    return this.putTextIfAbsent(key, JSON.stringify(value));
  }

  async getText(key: string): Promise<string | null> {
    const e = this.data.get(key);
    return e ? e.value.toString("utf-8") : null;
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await this.getText(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async del(key: string): Promise<void> {
    this.warnUsage("del");
    this.data.delete(key);
  }

  async delPrefix(prefix: string): Promise<number> {
    this.warnUsage("delPrefix");
    let n = 0;
    for (const k of this.data.keys()) {
      if (k.startsWith(prefix)) {
        this.data.delete(k);
        n++;
      }
    }
    return n;
  }

  async listNames(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for (const k of this.data.keys()) {
      if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
    return out;
  }
}
