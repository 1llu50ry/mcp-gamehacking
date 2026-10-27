/**
 * SqliteStorage —— ProxyStorage 的 better-sqlite3 实现。
 *
 * 定位：单实例本地开发 / CI / 兜底。生产多实例必须走 CosStorage。
 *
 * 表结构（proxy_kv）：
 *   k          TEXT PRIMARY KEY
 *   v          BLOB NOT NULL          -- 存 utf-8 字节
 *   bucket     TEXT NOT NULL          -- "ttl" 或 "nottl"（从 key prefix 推断）
 *   updated_at INTEGER NOT NULL       -- ms epoch, put 时刷新（续期）
 *
 * TTL：由 sweep() 显式触发（只清 ttl 桶），或由 factory 起定时器。
 * CAS：`INSERT OR IGNORE` 天然原子，无需事务。
 */
import type Database from "better-sqlite3";
import type { ProxyStorage } from "./proxy-storage.js";
import { bucketOf } from "./proxy-storage.js";

export const PROXY_KV_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS proxy_kv (
  k          TEXT PRIMARY KEY,
  v          BLOB NOT NULL,
  bucket     TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS proxy_kv_bucket_updated ON proxy_kv(bucket, updated_at);
`;

/** Idempotent —— safe to call on an already-migrated db. */
export function applySqliteStorageSchema(db: Database.Database): void {
  db.exec(PROXY_KV_SCHEMA_SQL);
}

export interface SweepOptions {
  /** ttl bucket 生存期（毫秒）。nottl 桶不清。 */
  ttlMs: number;
  /** Injectable for tests. */
  now?: number;
}

export class SqliteStorage implements ProxyStorage {
  readonly type = "sqlite" as const;

  private putStmt: Database.Statement;
  private putIfAbsentStmt: Database.Statement;
  private getStmt: Database.Statement;
  private existsStmt: Database.Statement;
  private delStmt: Database.Statement;
  private delPrefixCountStmt: Database.Statement;
  private delPrefixStmt: Database.Statement;
  private listPrefixStmt: Database.Statement;
  private sweepStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    applySqliteStorageSchema(db);

    this.putStmt = db.prepare(
      "INSERT INTO proxy_kv (k, v, bucket, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(k) DO UPDATE SET v=excluded.v, bucket=excluded.bucket, updated_at=excluded.updated_at",
    );
    this.putIfAbsentStmt = db.prepare(
      "INSERT OR IGNORE INTO proxy_kv (k, v, bucket, updated_at) VALUES (?, ?, ?, ?)",
    );
    this.getStmt = db.prepare("SELECT v FROM proxy_kv WHERE k = ?");
    this.existsStmt = db.prepare("SELECT 1 FROM proxy_kv WHERE k = ?");
    this.delStmt = db.prepare("DELETE FROM proxy_kv WHERE k = ?");
    this.delPrefixCountStmt = db.prepare("SELECT COUNT(*) AS n FROM proxy_kv WHERE k LIKE ? ESCAPE '\\'");
    this.delPrefixStmt = db.prepare("DELETE FROM proxy_kv WHERE k LIKE ? ESCAPE '\\'");
    this.listPrefixStmt = db.prepare("SELECT k FROM proxy_kv WHERE k LIKE ? ESCAPE '\\' ORDER BY k");
    this.sweepStmt = db.prepare("DELETE FROM proxy_kv WHERE bucket = ? AND updated_at < ?");
  }

  async putText(key: string, value: string): Promise<void> {
    this.putStmt.run(key, Buffer.from(value, "utf-8"), bucketOf(key), Date.now());
  }

  async putJSON(key: string, value: unknown): Promise<void> {
    return this.putText(key, JSON.stringify(value));
  }

  async putTextIfAbsent(key: string, value: string): Promise<boolean> {
    const info = this.putIfAbsentStmt.run(key, Buffer.from(value, "utf-8"), bucketOf(key), Date.now());
    return info.changes === 1;
  }

  async putJSONIfAbsent(key: string, value: unknown): Promise<boolean> {
    return this.putTextIfAbsent(key, JSON.stringify(value));
  }

  async getText(key: string): Promise<string | null> {
    const row = this.getStmt.get(key) as { v: Buffer } | undefined;
    if (!row) return null;
    return row.v.toString("utf-8");
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
    return this.existsStmt.get(key) !== undefined;
  }

  async del(key: string): Promise<void> {
    this.delStmt.run(key);
  }

  async delPrefix(prefix: string): Promise<number> {
    const like = escapeLike(prefix) + "%";
    const info = this.delPrefixStmt.run(like);
    return info.changes;
  }

  async listNames(prefix: string): Promise<string[]> {
    const like = escapeLike(prefix) + "%";
    const rows = this.listPrefixStmt.all(like) as Array<{ k: string }>;
    return rows.map((r) => r.k.slice(prefix.length));
  }

  /**
   * Run sweeper once —— deletes rows in the `ttl` bucket whose updated_at is
   * older than `ttlMs`. `nottl` rows are never touched by this sweep.
   */
  sweep(opts: SweepOptions): { removedTtl: number } {
    const now = opts.now ?? Date.now();
    const info = this.sweepStmt.run("ttl", now - opts.ttlMs);
    return { removedTtl: info.changes };
  }
}

/** Escape LIKE special chars (%, _, \) so prefix matching stays literal. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}
