/**
 * KvVersionPinRepo —— skill 版本锁 (ProxyStorage-backed).
 *
 * 见 docs/design/2026-07-12-cos-shark-sts-credential-plan.md §3.2 §3.6。
 *
 * Key 路径：
 *   nottl/<spaceId>/<userId>/<agentSource>/<sessionId>/skill-vpin/<skillId>.txt
 *
 * spaceId 是 P4 (kernel-sts) 新增的隔离段。老 caller 传空字符串时用 `_default` 兜底。
 *
 * 关键设计 vs 原 Redis 版本：
 *   1. **拆 key**：从 map-in-one-object 改成 "一 skill 一对象"，消除 R-M-W 写放大
 *      与并发覆盖风险
 *   2. **CAS 语义**：`pinMany` 走 `putTextIfAbsent`（COS If-None-Match / SQLite
 *      INSERT OR IGNORE / Fs O_EXCL / Memory Map.has），首次写入权威，
 *      **无需依赖 sticky routing**
 *
 * `upsertVersion` 是覆盖写（对应 post-write 场景，plugin 返回 v+1）。
 */
import type { ProxyStorage } from "../storage/proxy-storage.js";
import { sessionDirOf, assertKeySegment } from "../storage/key-utils.js";

function vpinDir(
  spaceId: string,
  userId: string,
  agentSource: string,
  sessionId: string,
): string {
  const sp = spaceId || "_default";
  return `${sessionDirOf("nottl", sp, userId, agentSource, sessionId)}skill-vpin/`;
}

function keyOf(
  spaceId: string,
  userId: string,
  agentSource: string,
  sessionId: string,
  skillId: string,
): string {
  assertKeySegment("skillId", skillId);
  return `${vpinDir(spaceId, userId, agentSource, sessionId)}${skillId}.txt`;
}

export class KvVersionPinRepo {
  constructor(private readonly storage: ProxyStorage | null) {}

  async getVersion(
    spaceId: string,
    userId: string,
    agentSource: string,
    sessionId: string,
    skillId: string,
  ): Promise<number | null> {
    if (!this.storage) return null;
    try {
      const raw = await this.storage.getText(
        keyOf(spaceId, userId, agentSource, sessionId, skillId),
      );
      if (raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  /**
   * 首次访问快照 —— 每对 (skillId, version) 走 putTextIfAbsent，天然是 HSETNX 语义。
   * 静默降级：任一写失败不抛，与原 Redis 版本一致。
   */
  async pinMany(
    spaceId: string,
    userId: string,
    agentSource: string,
    sessionId: string,
    pairs: Array<{ skillId: string; version: number }>,
  ): Promise<void> {
    if (!this.storage || pairs.length === 0) return;
    await Promise.all(
      pairs.map((p) =>
        this.storage!
          .putTextIfAbsent(
            keyOf(spaceId, userId, agentSource, sessionId, p.skillId),
            String(p.version),
          )
          .catch(() => false),
      ),
    );
  }

  /** 写操作后的强制覆盖 —— 覆写不需要 CAS。 */
  async upsertVersion(
    spaceId: string,
    userId: string,
    agentSource: string,
    sessionId: string,
    skillId: string,
    version: number,
  ): Promise<void> {
    if (!this.storage) return;
    await this.storage
      .putText(keyOf(spaceId, userId, agentSource, sessionId, skillId), String(version))
      .catch(() => { /* silent */ });
  }
}
