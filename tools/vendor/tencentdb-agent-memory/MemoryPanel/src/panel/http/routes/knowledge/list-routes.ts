/**
 * /api/v1/knowledge/wiki/team-assets
 * /api/v1/knowledge/code-graph/team-assets
 *
 * 团队池：meta list-accessible（visibility=team）→ KS get 补运营状态。
 */
import type { Hono } from 'hono';
import { validatePanelMetaHeaders } from '../../middleware/validate-panel-headers.js';
import { respondControlError, respondEnvelope } from '../../envelope.js';
import type { PanelDeps } from '../../../panel-deps.js';
import {
  buildCtx,
  readJson,
  str,
  okEnvelope,
  requireTeamMember,
  fetchAllMetaListItems,
  joinKnowledgeAssetsWithKs,
  mergeWithKsOnlyItems,
  isActiveMetaAsset,
  ASSET_TYPE_WIKI,
  ASSET_TYPE_CODE_GRAPH,
  type KnowledgeAssetMetaRaw,
} from './common.js';

function registerTeamAssets(
  api: Hono,
  deps: PanelDeps,
  path: string,
  assetType: typeof ASSET_TYPE_WIKI | typeof ASSET_TYPE_CODE_GRAPH,
): void {
  const mw = validatePanelMetaHeaders(deps);
  api.post(path, mw, async (c) => {
    const ctx = buildCtx(c);
    const body = await readJson(c);
    const teamId = str(body, 'team_id');
    if (!teamId) return respondControlError(c, 400, 'MISSING_TEAM_ID');
    const gate = await requireTeamMember(deps, c, ctx, teamId);
    if ('error' in gate) return gate.error;

    const assets = await fetchAllMetaListItems<KnowledgeAssetMetaRaw>(
      deps,
      ctx,
      'asset/list-accessible',
      {
        user_id: gate.userId,
        team_id: teamId,
        asset_type: assetType,
        action: 'read',
        visibility: 'team',
      },
    );
    const active = assets.filter((a) => isActiveMetaAsset(a.status));
    const joined = await joinKnowledgeAssetsWithKs(deps, ctx, active, assetType);
    // 补充 KS 侧未注册 meta 的资源（创建中/失败的 code-graph 等）
    const items = await mergeWithKsOnlyItems(deps, ctx, teamId, joined, assetType);
    return respondEnvelope(c, okEnvelope(c, { items, total: items.length }));
  });
}

export function registerKnowledgeListRoutes(api: Hono, deps: PanelDeps): void {
  registerTeamAssets(api, deps, '/knowledge/wiki/team-assets', ASSET_TYPE_WIKI);
  registerTeamAssets(api, deps, '/knowledge/code-graph/team-assets', ASSET_TYPE_CODE_GRAPH);
}
