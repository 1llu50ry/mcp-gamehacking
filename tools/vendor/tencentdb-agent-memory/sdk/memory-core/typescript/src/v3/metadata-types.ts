/**
 * v3 元数据 API 类型（SDK 本地定义，与记忆内核 src/metadata/types.ts 对齐）。
 */

export type UserStatus = "active" | "inactive" | "invited";
export type UserType = "normal" | "system_admin";
export type TeamStatus = "active" | "archived";
export type TeamRole = "admin" | "member" | "reviewer";
export type MemberStatus = "active" | "removed";
export type AgentStatus = "active" | "inactive";
export type TaskStatus = "running" | "completed";
export type TaskSourceType = "manual" | "tapd" | "github" | "other";
export type AssetType = "skill" | "llm_wiki" | "code_graph" | "chat_memory";
export type AssetVisibility = "private" | "team" | "restricted" | "agent" | "task";
export type AssetStatus = "draft" | "candidate" | "approved" | "deprecated" | "archived" | "failed";
export type InjectionMode = "direct" | "summary" | "tool" | "reference";
export type Permission = "read" | "write" | "delete" | "assign" | "share" | "use";
export type AclSubjectType = "user" | "team_role" | "agent";
export type AclEffect = "allow" | "deny";

/** list 接口分页入参（可选；传 limit 或 offset 任一时启用分页响应）。 */
export interface PaginationInput {
  limit?: number;
  offset?: number;
}

/** 解析后的分页参数。 */
export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface UserPublic {
  user_id: string;
  user_type: UserType;
  username: string;
  created_at: string;
}

/** user/create 响应：不含 username。 */
export interface CreateUserResult {
  user_id: string;
  user_type: UserType;
  created_at: string;
  default_user_key: string;
}

export type UserKeyStatus = "active" | "revoked";

/** user-key/list · get 响应（脱敏，不含完整 key_value）。 */
export interface UserKeyPublic {
  key_id: string;
  user_id: string;
  key_prefix: string;
  name?: string | null;
  status: UserKeyStatus;
  is_default: boolean;
  last_used_at?: string | null;
  expires_at?: string | null;
  created_at: string;
  revoked_at?: string | null;
}

/** user-key/create 响应：仅此一次返回完整 key_value。 */
export interface UserKeyCreated extends UserKeyPublic {
  key_value: string;
}

export interface CreateUserKeyRequest {
  user_id?: string;
  name?: string;
  expires_at?: string;
}

export interface ListUserKeysRequest extends PaginationInput {
  user_id?: string;
}

export interface UpdateUserKeyRequest {
  key_id: string;
  name?: string;
  expires_at?: string | null;
}

export interface TeamEntity {
  team_id: string;
  name: string;
  description?: string | null;
  owner_user_id: string;
  status: TeamStatus;
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

export interface TeamMemberEntity {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamRole;
  joined_at: string;
  status: MemberStatus;
  /** team-member/list · get 响应附带（读时 JOIN，v3.2.2+） */
  username?: string;
}

export interface AgentEntity {
  agent_id: string;
  team_id: string;
  owner_user_id: string;
  name: string;
  description?: string | null;
  prompt?: string | null;
  visibility: AssetVisibility;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

export interface TaskEntity {
  task_id: string;
  team_id: string;
  creator_user_id: string;
  title: string;
  description?: string | null;
  source_type: TaskSourceType;
  source_url?: string | null;
  status: TaskStatus;
  auto_assign_floating_assets: boolean;
  risk_level?: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

export interface TaskAgentEntity {
  id: string;
  task_id: string;
  agent_id: string;
  role_in_task?: string | null;
  status: MemberStatus;
  created_at: string;
}

export interface ParticipationLogEntity {
  id: string;
  team_id: string;
  task_id: string;
  agent_id: string;
  user_id: string;
  source: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface AppendParticipationLogRequest {
  team_id: string;
  task_id: string;
  agent_id: string;
  user_id: string;
  created_at?: string;
  source?: string;
  metadata_json?: string;
}

export interface ListParticipationLogsRequest extends PaginationInput {
  team_id: string;
  task_id?: string;
  agent_id?: string;
  user_id?: string;
  created_after?: string;
  created_before?: string;
  dedupe?: boolean;
}

export interface AssetEntity {
  asset_id: string;
  team_id: string;
  asset_type: AssetType;
  name: string;
  description?: string | null;
  owner_user_id: string;
  source_type: string;
  source_ref?: string | null;
  version: number;
  visibility: AssetVisibility;
  status: AssetStatus;
  confidence?: number | null;
  expires_at?: string | null;
  last_used_at?: string | null;
  usage_count: number;
  content_ref?: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

export interface FixedAssetBindingEntity {
  id: string;
  agent_id: string;
  asset_id: string;
  asset_type: AssetType;
  injection_mode: InjectionMode;
  priority: number;
  created_by: string;
  created_at: string;
}

export interface AclEntity {
  id: string;
  asset_id: string;
  subject_type: AclSubjectType;
  subject_id: string;
  permission: Permission;
  effect: AclEffect;
  granted_by: string;
  created_at: string;
  updated_at: string;
}

export interface BatchDeleteResult {
  deleted_ids: string[];
  failed: Array<{ id: string; reason: string }>;
}

export interface AgentBasicData {
  agent_id: string;
  team_id: string;
  owner_user_id: string;
  prompt: string | null;
  visibility: AssetVisibility;
  status: string;
}

export interface AgentAssetView {
  asset_id: string;
  asset_type: AssetType;
  name: string;
  description: string | null;
  status: AssetStatus;
  visibility: AssetVisibility;
  injection_mode: InjectionMode;
  priority: number;
  created_at: string;
}

export interface AgentFixedAssetDetailResult {
  agent: AgentBasicData;
  items: AgentAssetView[];
  total: number;
  limit: number;
  offset: number;
}

export interface FixedAssetTypeCounts {
  skill: number;
  code_graph: number;
  llm_wiki: number;
  chat_memory: number;
}

export interface AgentFixedAssetSummary {
  agent_id: string;
  counts: FixedAssetTypeCounts;
  total: number;
}

export interface AgentFixedAssetSummaryResult {
  items: AgentFixedAssetSummary[];
  total: number;
}

export interface SummarizeAgentFixedAssetsRequest {
  agent_ids: string[];
  asset_id?: string;
}

export interface PermCheckResult {
  allowed: boolean;
  reason: string;
}

export interface AuthVerifyResult {
  valid: boolean;
  user: UserPublic | null;
}

// ── 请求类型 ──
export interface CreateUserRequest {
  username: string;
}

/** user/list 请求（v3.1.1+ / v3.2.1）：team_id 仅 system_admin 可省略。 */
export interface ListUsersRequest extends PaginationInput {
  team_id?: string;
  user_ids?: string[];
  /** 精确匹配 username（大小写敏感；用于查重等）。 */
  username?: string;
}
export interface CreateTeamRequest {
  name: string;
  /** 创建时指定；须等于 caller。创建后不可通过 update 修改。 */
  owner_user_id: string;
  description?: string;
  status?: TeamStatus;
  metadata_json?: string;
}
/** team/update：不含 `owner_user_id`（归属不可改）。 */
export interface UpdateTeamRequest {
  team_id: string;
  name?: string;
  description?: string;
  status?: TeamStatus;
  metadata_json?: string;
}
export interface AddTeamMemberRequest {
  team_id: string;
  user_id: string;
  role?: TeamRole;
}
export interface CreateAgentRequest {
  team_id: string;
  /** 创建时指定；须等于 caller。创建后不可通过 update 修改。 */
  owner_user_id: string;
  name: string;
  description?: string;
  prompt?: string;
  visibility?: AssetVisibility;
  status?: AgentStatus;
  metadata_json?: string;
}
/** agent/update：不含 `owner_user_id`（归属不可改）。 */
export interface UpdateAgentRequest {
  agent_id: string;
  name?: string;
  description?: string;
  prompt?: string;
  visibility?: AssetVisibility;
  status?: AgentStatus;
  metadata_json?: string;
}
export interface ListAgentsRequest extends PaginationInput {
  team_id?: string;
  /** 列表过滤（非修改归属）。 */
  owner_user_id?: string;
  status?: AgentStatus;
  /** 精确匹配 agent name（大小写敏感；用于查重等）。 */
  name?: string;
}

/** team/list 请求。 */
export interface ListTeamsRequest extends PaginationInput {
  user_id?: string;
  user_key?: string;
  /** 精确匹配 team name（大小写敏感；用于查重等）。 */
  name?: string;
}

/** task/list 请求。 */
export interface ListTasksRequest extends PaginationInput {
  team_id?: string;
  /** 列表过滤（非修改归属）。 */
  creator_user_id?: string;
  creator_user_key?: string;
  status?: TaskStatus;
  /** 精确匹配 task title（大小写敏感；用于查重等）。 */
  title?: string;
}
export interface CreateTaskRequest {
  team_id: string;
  /** 创建时指定；须等于 caller。创建后不可通过 update 修改。 */
  creator_user_id: string;
  title: string;
  description?: string;
  source_type?: TaskSourceType;
  source_url?: string;
  status?: TaskStatus;
  auto_assign_floating_assets?: boolean;
  risk_level?: string;
  metadata_json?: string;
  linked_agents?: Array<{ agent_id: string; role_in_task?: string }>;
}
/** task/update：不含 `creator_user_id`（归属不可改）。 */
export interface UpdateTaskRequest {
  task_id: string;
  title?: string;
  description?: string;
  source_type?: TaskSourceType;
  source_url?: string;
  status?: TaskStatus;
  auto_assign_floating_assets?: boolean;
  risk_level?: string;
  metadata_json?: string;
}
export interface CreateAssetRequest {
  /** 由调用方（外部资产系统）提供；元数据模块不生成 asset_id。 */
  asset_id: string;
  team_id: string;
  asset_type: AssetType;
  name: string;
  /** 创建时指定；须等于 caller。创建后不可通过 update 修改。 */
  owner_user_id: string;
  source_type: string;
  description?: string;
  source_ref?: string;
  visibility?: AssetVisibility;
  status?: AssetStatus;
  confidence?: number;
  expires_at?: string;
  content_ref?: string;
  metadata_json?: string;
}
/** asset/update：不含 `owner_user_id`（归属不可改；仅 asset owner 可调用）。 */
export interface UpdateAssetRequest {
  asset_id: string;
  name?: string;
  description?: string;
  visibility?: AssetVisibility;
  status?: AssetStatus;
  confidence?: number;
  expires_at?: string;
  content_ref?: string;
  version?: number;
  source_ref?: string;
  metadata_json?: string;
}
export interface ListAssetsRequest extends PaginationInput {
  team_id: string;
  asset_type?: AssetType;
  status?: AssetStatus;
  /** 列表过滤（非修改归属）。 */
  owner_user_id?: string;
  visibility?: AssetVisibility;
}
export interface FixedAssetBindingInput {
  asset_id: string;
  asset_type: AssetType;
  injection_mode?: InjectionMode;
  priority?: number;
  created_by: string;
}
export interface ListWithDetailRequest extends PaginationInput {
  agent_id: string;
  apply_visibility_filter?: boolean;
  touch_usage?: boolean;
}
export interface GrantAclRequest {
  asset_id: string;
  subject_type: AclSubjectType;
  subject_id: string;
  permission: Permission;
  effect?: AclEffect;
  granted_by: string;
}
export interface CheckAclRequest {
  user_id?: string;
  user_key?: string;
  asset_id: string;
  action: Permission;
  agent_id?: string;
}
export interface ListAccessibleAssetsRequest extends PaginationInput {
  user_id?: string;
  user_key?: string;
  team_id?: string;
  asset_type?: AssetType;
  action?: Permission;
  agent_id?: string;
}
export interface GetUserRequest {
  user_id?: string;
  user_key?: string;
}

// ── ConfigParam (v3.2) ──

export interface InstanceQuotaLimits {
  max_users_per_instance: number;
  max_teams_per_instance: number;
}

export interface UserConfigViewItem {
  module: string;
  param_name: string;
  param_key: string;
  description: string;
  effective_value: string;
}

export interface UserConfigView {
  user_id: string;
  module: string;
  module_description: string;
  items: UserConfigViewItem[];
}

export interface GetUserConfigRequest {
  user_id: string;
  module: string;
  param_name?: string;
}

export interface SetUserConfigRequest {
  user_id: string;
  module: string;
  params: Record<string, string>;
}

// ── Knowledge (v3 管理面实体，/v3/knowledge/*) ──
// 与记忆内核 src/core/store/types.ts 的 KnowledgeEntity / src/gateway/knowledge-schemas.ts 对齐。

export type KnowledgeType = "wiki" | "code-graph";

export interface KnowledgeEntity {
  knowledge_id: string;
  type: KnowledgeType;
  service_url: string;
  name: string;
  summary: string | null;
  team_id: string;
  /** 预留：agent 绑定维度（当前写 ""，绑定权威在 meta_assets）。 */
  agent_id?: string;
  user_id: string | null;
  repo_url?: string;
  branch?: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeListResult {
  items: KnowledgeEntity[];
  total: number;
}

export interface CreateKnowledgeRequest {
  knowledge_id: string;
  type: KnowledgeType;
  /** Knowledge Service 数据面地址（如 http://host:8421/v3）。 */
  service_url: string;
  name: string;
  summary?: string | null;
  team_id: string;
  user_id?: string;
  repo_url?: string;
  branch?: string;
}

export interface UpdateKnowledgeRequest {
  knowledge_id: string;
  team_id?: string;
  name?: string;
  summary?: string | null;
  service_url?: string;
  repo_url?: string;
  branch?: string;
}

export interface ListKnowledgeRequest extends PaginationInput {
  team_id: string;
  type?: KnowledgeType;
  /** 按 id 批量联查明细（proxy 解析 agent 绑定后取渲染字段用）。 */
  knowledge_ids?: string[];
}
