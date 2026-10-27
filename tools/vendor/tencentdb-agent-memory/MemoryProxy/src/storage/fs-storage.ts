/**
 * FsStorage —— ProxyStorage 的本地文件系统实现。
 *
 * 定位：离线/私有部署或 docker 只读兜底。生产不推荐（多进程共享目录会 race）。
 *
 * 语义：
 *   - key 是相对路径，禁止绝对路径 / 路径穿越（安全守卫）
 *   - putText/putJSON 用 tmp + rename 保证原子；putIfAbsent 用 O_EXCL 保证 CAS
 *   - 目录自动创建
 *
 * TTL：不实现 sweeper（`fs.stat().mtime` 在某些容器 FS 上不可靠）——
 * 由运维用 tmpwatch / systemd-tmpfiles 清理。见方案 §3.3.3。
 */
import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { randomBytes } from "node:crypto";
import type { ProxyStorage } from "./proxy-storage.js";

export class FsStorage implements ProxyStorage {
  readonly type = "fs" as const;

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!key || key.length === 0) throw new Error(`[fs-storage] invalid empty key`);
    if (isAbsolute(key)) throw new Error(`[fs-storage] absolute path not allowed: ${key}`);
    const normalized = normalize(key);
    if (normalized.startsWith("..") || normalized.split(sep).includes("..")) {
      throw new Error(`[fs-storage] path traversal not allowed: ${key}`);
    }
    const full = join(this.root, normalized);
    // Double check: the resolved path must stay inside root.
    const rel = relative(this.root, full);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`[fs-storage] path escapes root: ${key}`);
    }
    return full;
  }

  private async ensureDir(filePath: string): Promise<void> {
    await fs.mkdir(dirname(filePath), { recursive: true });
  }

  async putText(key: string, value: string): Promise<void> {
    const full = this.resolve(key);
    await this.ensureDir(full);
    // atomic write: tmp + rename
    const tmp = full + "." + randomBytes(6).toString("hex") + ".tmp";
    await fs.writeFile(tmp, value, "utf-8");
    await fs.rename(tmp, full);
  }

  async putJSON(key: string, value: unknown): Promise<void> {
    return this.putText(key, JSON.stringify(value));
  }

  async putTextIfAbsent(key: string, value: string): Promise<boolean> {
    const full = this.resolve(key);
    await this.ensureDir(full);
    try {
      const handle = await fs.open(full, "wx"); // O_CREAT | O_EXCL
      try {
        await handle.writeFile(value, "utf-8");
      } finally {
        await handle.close();
      }
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
  }

  async putJSONIfAbsent(key: string, value: unknown): Promise<boolean> {
    return this.putTextIfAbsent(key, JSON.stringify(value));
  }

  async getText(key: string): Promise<string | null> {
    const full = this.resolve(key);
    try {
      return await fs.readFile(full, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
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
    const full = this.resolve(key);
    try {
      await fs.access(full);
      return true;
    } catch {
      return false;
    }
  }

  async del(key: string): Promise<void> {
    const full = this.resolve(key);
    try {
      await fs.unlink(full);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async delPrefix(prefix: string): Promise<number> {
    // prefix 是目录形式；把它当目录 rmdir -r。为了统计删除数量，先 list 再逐个 unlink 目录。
    const names = await this.listNames(prefix);
    let n = 0;
    for (const name of names) {
      await this.del(prefix + name);
      n++;
    }
    // 顺带清理空目录（best-effort），不影响计数。
    try {
      const fullPrefixDir = this.resolve(prefix.replace(/\/+$/, "") || ".");
      await fs.rm(fullPrefixDir, { recursive: true, force: true });
    } catch { /* ignore */ }
    return n;
  }

  async listNames(prefix: string): Promise<string[]> {
    // prefix 通常以 "/" 结尾，代表一个目录；否则视为"目录 basename"过滤器。
    const dirPart = prefix.endsWith("/") ? prefix : prefix + "/";
    let dirAbs: string;
    try {
      dirAbs = this.resolve(dirPart.replace(/\/+$/, "") || ".");
    } catch {
      return [];
    }
    const out: string[] = [];
    await this.walk(dirAbs, "", out);
    return out;
  }

  private async walk(absDir: string, relPrefix: string, out: string[]): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const e of entries) {
      const relName = relPrefix + e.name;
      if (e.isDirectory()) {
        await this.walk(join(absDir, e.name), relName + "/", out);
      } else {
        out.push(relName);
      }
    }
  }
}
