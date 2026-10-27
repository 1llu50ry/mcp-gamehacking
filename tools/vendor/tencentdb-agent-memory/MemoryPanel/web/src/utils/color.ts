/**
 * 颜色工具 — 从 App.tsx 抽出
 *
 * 团队头像配色：按 team_id 稳定取色，确保同一团队始终显示同一颜色。
 */

/** 团队头像配色列表 */
export const TEAM_AVATAR_COLORS = [
  'bg-rose-500', 'bg-amber-500', 'bg-blue-500', 'bg-emerald-500', 'bg-violet-500',
  'bg-cyan-600', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500', 'bg-indigo-500',
];

/**
 * 根据 seed（通常是 team_id）稳定取一个 Tailwind 背景色类名。
 * 同一 seed 始终返回同一颜色。
 */
export function teamColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TEAM_AVATAR_COLORS[h % TEAM_AVATAR_COLORS.length];
}
