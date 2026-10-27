/**
 * Session registration — 本地构建 SessionInfo，不再调用 TMC。
 *
 * proxy 通过 SessionStore（L1 内存 + L2 Redis/SQLite）独立持久化 session
 * 状态，不再需要 POST /api/v1/proxy/sessions 写入 TMC。用户身份直接从
 * apiKey → auth/verify 拿到。
 */

import type { SessionInfo, SessionRegistrationData } from "./types.js";

/**
 * 本地构建 SessionInfo（不调用 TMC）。
 *
 * @param spaceId 来自请求 URL path `/proxy/<spaceId>/...` 的内核实例 ID
 *   （如 `mem-example001`）。注入器构造 MetadataClient 时会用它做
 *   `x-tdai-service-id` header —— 若为空字符串，内核会返回
 *   `invalid_user_key`，属于预期行为（caller 已在 session init bypass
 *   中处理）。
 */
export function buildSessionInfo(
  data: SessionRegistrationData,
  userKey?: string,
  spaceId?: string,
): SessionInfo {
  const now = new Date().toISOString();
  return {
    session_id: data.session_id,
    team_id: data.team_id,
    agent_id: data.agent_id,
    user_id: data.user_id,
    task_id: data.task_id,
    user_key: userKey,
    space_id: spaceId,
    created_at: now,
  };
}