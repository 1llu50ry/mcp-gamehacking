/**
 * useCurrentRole — 获取当前登录用户的角色
 *
 * 返回 'admin' | 'member' | 'reviewer' | null（null = 未登录）。
 *
 * 角色模型（唯一权威口径，勿再改回"按 team 成员表判断 admin"）：
 *   - admin  是**全局角色**，与是否创建/加入任何 team 无关（哪怕当前没有任何 team，也始终是 admin）。
 *     admin 的职责是管理 team（建团队、录入成员），不管理具体资源。
 *   - member 是**team 内角色**，即某个 team 的成员，负责在 team 内管理资源（agent/skill/wiki/code/memory）。
 *   - 因此判断顺序必须是：先判是不是全局 admin；不是，才去查其在 active team 里的成员角色。
 *     反过来"先查 team 成员表、查不到就当无角色"是错的——会导致"admin 账号下没有 team 时
 *     被误判为非 admin（甚至 null）"。
 */
import { useMemo } from 'react';
import { useTeams, roleInTeam, isGlobalAdmin } from '@/services';
import { useAuthStore } from '@/stores/auth';

export type TeamRole = 'admin' | 'member' | 'reviewer';

export function useCurrentRole(): TeamRole | null {
  const { auth } = useAuthStore();
  const { activeTeam } = useTeams();
  return useMemo(() => {
    if (!auth) return null;
    // 全局 admin：独立于 team，始终是 admin（不依赖 activeTeam / team.members 查询结果）
    // isAdmin 来自 auth/verify 的 user_type === 'system_admin'，是唯一权威字段。
    if (isGlobalAdmin(auth.user, auth.isAdmin)) return 'admin';
    // 非 admin：角色取决于其在当前 active team 里的成员记录（一般就是 'member'）
    return roleInTeam(activeTeam, auth.user_id);
  }, [activeTeam, auth]);
}
