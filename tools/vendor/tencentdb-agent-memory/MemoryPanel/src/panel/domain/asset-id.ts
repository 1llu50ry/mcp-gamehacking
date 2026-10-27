import type { AssetType } from './entities.js';
import { ulid } from 'ulid';

const PREFIX: Record<AssetType, string> = {
  skill: 'skl',
  llm_wiki: 'wiki',
  code_graph: 'cg',
  chat_memory: 'mem',
};

/** Control 侧按资产类型生成外部 asset_id（设计 §4.1.1）。 */
export function newExternalAssetId(assetType: AssetType): string {
  return `${PREFIX[assetType]}-${ulid().toLowerCase().slice(-12)}`;
}
