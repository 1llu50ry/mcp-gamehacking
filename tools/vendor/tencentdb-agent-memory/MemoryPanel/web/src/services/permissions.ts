/**
 * permissions.ts — 全局权限判断的唯一权威实现。
 *
 * 从原 demoStore.ts 中抽出。isGlobalAdmin 是全站唯一的"全局 admin"判定
 * 入口（与 team/agent/task 的后端实现无关，纯前端 auth state 判断）。
 */

/**
 * 全局 admin 判断：admin 拥有所有权限，可见所有内容。
 *
 * 唯一权威来源：auth/verify 响应的 `user.user_type === 'system_admin'`，
 * 由 LoginGate 在登录时写入 `AuthState.isAdmin`。
 *
 * 不再保留 `username === 'admin'` 字符串兜底——该兜底是早期演示阶段遗留，
 * 会导致 display_name / username 恰好为 "admin" 的普通用户被误判为全局 admin，
 * 尤其在"用户没有归属任何 team"或"team 里只有自己一个人"时，
 * roleInTeam 返回 null，UI 会按 admin 逻辑渲染（如 ResourcePage 显示 AdminResourceLock），
 * 出现 normal/member 用户看到 admin 锁定页的问题。
 */
export function isGlobalAdmin(_currentUser: string, isAdminFlag?: boolean): boolean {
  return isAdminFlag === true;
}
