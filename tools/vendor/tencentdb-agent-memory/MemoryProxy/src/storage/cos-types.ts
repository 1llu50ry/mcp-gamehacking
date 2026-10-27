/**
 * CosLikeBackend / KernelStsCosOptions 主仓侧类型定义 —— **权威源**。
 *
 * cost-guard 侧 `packages/cost-guard/src/storage/cos-types.ts` 有一份结构等价的
 * 独立定义（避免反向依赖主仓）。两份都是 5 个方法接口，结构类型下天然兼容 ——
 * 主仓通过 `await import("@context-proxy/cost-guard")` 拿到装配函数的返回值
 * （cost-guard 侧的 CosLikeBackend 实例），赋给主仓期望的 CosLikeBackend
 * 变量时 TypeScript 会自动接受。
 *
 * 让 tsc 编译**不依赖 submodule 是否存在** —— 开源用户 clone 后即使
 * `packages/cost-guard/` 目录为空，主仓 `tsc` 依然能过（因为 CosLikeBackend
 * 类型定义在这里，不 import 自 cost-guard）。
 *
 * 详见 docs/design/2026-07-11-cos-submodule-extraction-plan.md §4.2 决策 1 + §4.4。
 */

/**
 * 最小 COS 后端契约 —— CosStorage 会向下调这 5 个方法。
 */
export interface CosLikeBackend {
  /**
   * PUT object.
   * @param headers 额外 header —— CAS 场景传 `{ "If-None-Match": "*" }`；
   *                后端遇到 412 应该抛 `{ statusCode: 412 }`
   */
  putObject(key: string, body: Buffer, headers?: Record<string, string>): Promise<void>;
  getObject(key: string): Promise<Buffer | null>;
  headObject(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<void>;
  /** List all keys under prefix (may paginate internally). Return full key path. */
  listKeys(prefix: string): Promise<string[]>;
  /**
   * 可选：踢掉某个 spaceId 的 per-space backend + STS 凭证缓存。
   *
   * 仅 kernel-sts 装配（cost-guard `CosStorageBackendMultiSpace`）会实现；
   * 单-space 或无 pool 的实现（例如未来主仓可能挂的 mock backend）应保持
   * 不定义。`/v3/instance/proxy-destroy` handler 通过 optional-call 检测。
   *
   * 命中返回 `true`，未命中或不支持返回 `false`。
   */
  evictSpace?(spaceId: string): Promise<boolean>;
}

/**
 * `openKernelStsCosBackend` 的入参 —— 跟 `StorageConfig.cos` 结构镜像
 * （去掉了跟 kernel-sts 无关的字段）。
 */
export interface KernelStsCosOptions {
  /** COS key 业务命名空间前缀，例如 `"proxy_cache/"`（跟 core 的 memory_v2/cos_data 隔离）。 */
  rootPrefix: string;
  /**
   * 可选：强制走 VPC 内网 / 自定义域名（例：`"cos.example.com"`）。
   * 空则用 Shark 返回 CosUrl 里的 host。
   */
  endpointDomain?: string;
  /**
   * Shark 拉临时凭证 —— 每个 spaceId 独立 STS，权限严格绑到
   * `proxy_cache/{ttl|nottl}/{spaceId}/*` 两个前缀。
   */
  shark: {
    baseUrl: string;
    timeoutMs?: number;
    retryCount?: number;
    refreshBufferMs?: number;
    maxSpaces?: number;
    graceCloseDelayMs?: number;
  };
}
