/**
 * CosStorage —— ProxyStorage 的对象存储实现（COS / S3-compatible）。
 *
 * 定位：生产多实例首选。
 *
 * 依赖注入：不直接 `import COS from "cos-nodejs-sdk-v5"`，而是接一个最小
 * `CosLikeBackend` 接口（PUT / GET / HEAD / DELETE / LIST），由 factory 层
 * 用真实 SDK 实例注入。这样单元测试可以用 mock backend 全流程验证 CosStorage
 * 逻辑，不打真桶；生产环境注入的是 openclaw 插件的 SharedCosClient wrapper。
 *
 * 语义要点：
 *   - putIfAbsent 走 COS `If-None-Match: "*"` header —— 存在返回 412
 *   - TTL 由桶 lifecycle rule 兜底（按 lastModified）
 *   - 凭据 403 / 重试逻辑由底层 backend 负责，不在这层处理
 */
import type { ProxyStorage } from "./proxy-storage.js";

/**
 * CosLikeBackend 契约 —— **定义在 cos-types.ts，这里 re-export 保持向后兼容**。
 *
 * 生产实现：cost-guard submodule 里的 CosStorageBackendMultiSpace（走
 * `await import("@context-proxy/cost-guard")`）。测试：用 in-memory mock
 * （见 cos-storage.test.ts）。
 *
 * 2026-07-13 抽 submodule 后新增 cos-types.ts 承载 CosLikeBackend +
 * KernelStsCosOptions；本文件只 re-export，签名不变，避免破坏老 caller
 * `import { CosLikeBackend } from "./cos-storage.js"`。
 */
export type { CosLikeBackend } from "./cos-types.js";
import type { CosLikeBackend } from "./cos-types.js";

export class CosStorage implements ProxyStorage {
  readonly type = "cos" as const;

  constructor(private readonly backend: CosLikeBackend) {}

  async putText(key: string, value: string): Promise<void> {
    await this.backend.putObject(key, Buffer.from(value, "utf-8"));
  }

  async putJSON(key: string, value: unknown): Promise<void> {
    return this.putText(key, JSON.stringify(value));
  }

  async putTextIfAbsent(key: string, value: string): Promise<boolean> {
    try {
      await this.backend.putObject(key, Buffer.from(value, "utf-8"), { "If-None-Match": "*" });
      return true;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 412) return false; // Preconditions failed = key existed
      throw err;
    }
  }

  async putJSONIfAbsent(key: string, value: unknown): Promise<boolean> {
    return this.putTextIfAbsent(key, JSON.stringify(value));
  }

  async getText(key: string): Promise<string | null> {
    const buf = await this.backend.getObject(key);
    if (!buf) return null;
    return buf.toString("utf-8");
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
    return this.backend.headObject(key);
  }

  async del(key: string): Promise<void> {
    await this.backend.deleteObject(key);
  }

  async delPrefix(prefix: string): Promise<number> {
    const keys = await this.backend.listKeys(prefix);
    let n = 0;
    for (const k of keys) {
      await this.backend.deleteObject(k).catch(() => { /* best-effort */ });
      n++;
    }
    return n;
  }

  async listNames(prefix: string): Promise<string[]> {
    const keys = await this.backend.listKeys(prefix);
    return keys.map((k) => (k.startsWith(prefix) ? k.slice(prefix.length) : k));
  }
}
