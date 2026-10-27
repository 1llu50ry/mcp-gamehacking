/**
 * user-asset-store.ts — 用户自建资产（skill / memory）的本地 localStorage 层。
 *
 * 从原 demoStore.ts 中抽出。
 *
 * 用户可以创建自己的 skill 或 memory 资产：
 *   - scope = 'team'    → 团队内共享，所有成员可见并可分配给自己的 Agent
 *   - scope = 'private' → 仅自己可见，只有 owner 可分配给自己的 Agent
 *
 * 团队资产 = 所有成员设为 'team' 的资产合集
 * 固定资产 = 从团队/个人资产中选择分配给具体 Agent 的资产
 *
 * 注：全部资产已切换到真实后端 API，本文件仅保留 localStorage 读写能力
 * 供 ChatMemoryPanel 等组件使用。
 */

import { emitChange, safeParse } from './storage-utils';

const USER_ASSETS_KEY = 'tdai-memory.userAssets.v1';

export type UserAssetKind = 'skill' | 'memory';

export interface UserAsset {
  asset_id: string;
  kind: UserAssetKind;
  owner_user_id: string;
  team_id: string;
  title: string;
  description: string;
  scope: 'team' | 'private';
  created_at_ms: number;
  updated_at_ms: number;
}

function readUserAssets(): UserAsset[] {
  if (typeof window === 'undefined') return [];
  return safeParse<UserAsset[]>(localStorage.getItem(USER_ASSETS_KEY), []);
}

function writeUserAssets(assets: UserAsset[]): void {
  try {
    localStorage.setItem(USER_ASSETS_KEY, JSON.stringify(assets));
  } catch {
    /* ignore */
  }
  emitChange();
}

/** 创建用户自建资产 */
export function createUserAsset(input: {
  kind: UserAssetKind;
  owner_user_id: string;
  team_id: string;
  title: string;
  description?: string;
  scope?: 'team' | 'private';
}): UserAsset {
  const assets = readUserAssets();
  const now = Date.now();
  const asset: UserAsset = {
    asset_id: `ua_${now}_${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    owner_user_id: input.owner_user_id,
    team_id: input.team_id,
    title: input.title.trim(),
    description: (input.description ?? '').trim(),
    scope: input.scope ?? 'team',
    created_at_ms: now,
    updated_at_ms: now,
  };
  assets.push(asset);
  writeUserAssets(assets);
  return asset;
}

/** 更新用户自建资产（只有 owner 可调用） */
export function updateUserAsset(
  asset_id: string,
  patch: Partial<Pick<UserAsset, 'title' | 'description' | 'scope'>>
): void {
  const assets = readUserAssets();
  const target = assets.find((a) => a.asset_id === asset_id);
  if (!target) return;
  if (patch.title !== undefined) target.title = patch.title.trim();
  if (patch.description !== undefined) target.description = patch.description.trim();
  if (patch.scope !== undefined) target.scope = patch.scope;
  target.updated_at_ms = Date.now();
  writeUserAssets(assets);
}

/** 删除用户自建资产 */
export function deleteUserAsset(asset_id: string): void {
  const assets = readUserAssets().filter((a) => a.asset_id !== asset_id);
  writeUserAssets(assets);
}

/** 读取某用户拥有的资产（按 kind 过滤） */
export function getUserAssetsByOwner(owner_user_id: string, kind: UserAssetKind, team_id?: string): UserAsset[] {
  return readUserAssets().filter(
    (a) => a.owner_user_id === owner_user_id && a.kind === kind && (!team_id || a.team_id === team_id)
  );
}

/** 读取团队可见资产 = 该 team 内所有成员设为 scope='team' 的资产 + 当前用户自己的私密资产。
 *  team_id 为空时不按 team 过滤（返回所有 team 的可见资产）。 */
export function getTeamVisibleAssets(
  team_id: string | null | undefined,
  kind: UserAssetKind,
  currentUser?: string
): UserAsset[] {
  return readUserAssets().filter(
    (a) => (!team_id || a.team_id === team_id) && a.kind === kind && (a.scope === 'team' || a.owner_user_id === currentUser)
  );
}


