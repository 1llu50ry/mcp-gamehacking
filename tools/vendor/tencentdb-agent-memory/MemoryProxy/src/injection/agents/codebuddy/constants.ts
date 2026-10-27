/**
 * CodeBuddy system prompt known XML tags and their display names.
 */

/**
 * All known XML tag names in CodeBuddy's system prompt, in typical order.
 */
export const CODEBUDDY_KNOWN_TAGS = [
  "content_policy",
  "communication",
  "tool_calling",
  "maximize_parallel_tool_calls",
  "maximize_context_understanding",
  "code-explorer_subagent_usage",
  "making_code_changes",
  "citing_code",
  "inline_line_numbers",
  "task_management",
  "mcp_protocol",
  "integrations_protocol",
  "response_language",
  "agent_skills",
  "automations",
  "memories",
  "rules",
  "project_context",
  "cb_summary",
  "conversation_history_summary",
  "additional_data",
  "system_reminder",
  // Tags injected by CodeBuddy IDE into user messages (not system prompt),
  // but also recognized here for completeness and future anchoring.
  "user_info",
  "git_status",
  "open_and_recently_viewed_files",
  "always_applied_workspace_rules",
  // Nested sub-tags used inside agent_skills / available_skills
  "available_skills",
  "skill",
  "name",
  "description",
  "location",
] as const;

export type CodeBuddyTag = (typeof CODEBUDDY_KNOWN_TAGS)[number];

/**
 * Human-readable names for each tag (for debugging).
 */
export const TAG_DISPLAY_NAMES: Record<string, string> = {
  content_policy: "内容安全策略",
  communication: "通信规范",
  tool_calling: "工具调用规范",
  maximize_parallel_tool_calls: "并行工具调用指导",
  maximize_context_understanding: "上下文理解指导",
  "code-explorer_subagent_usage": "代码探索子Agent",
  making_code_changes: "代码修改规范",
  citing_code: "代码引用规范",
  inline_line_numbers: "行号规范",
  task_management: "任务管理",
  mcp_protocol: "MCP协议",
  integrations_protocol: "集成协议",
  response_language: "响应语言",
  agent_skills: "Agent技能",
  automations: "自动化任务",
  memories: "记忆",
  rules: "规则",
  project_context: "项目上下文",
  cb_summary: "对话摘要",
  conversation_history_summary: "对话历史摘要",
  additional_data: "附加数据",
  system_reminder: "系统提醒",
  user_info: "用户环境信息",
  git_status: "Git状态",
  open_and_recently_viewed_files: "最近打开文件",
  always_applied_workspace_rules: "工作区规则",
};

/**
 * Tags that serve as "tool/skill injection anchors" in CodeBuddy.
 */
export const TOOL_ANCHOR_TAGS = ["agent_skills"] as const;

/**
 * Tags that serve as "memory injection anchors".
 */
export const MEMORY_ANCHOR_TAGS = ["memories"] as const;

// ── Unknown Tag Detection ────────────────────────────────────────────────────────

const KNOWN_TAG_SET: Set<string> = new Set(CODEBUDDY_KNOWN_TAGS);

/**
 * Scan a text for XML tags that are NOT in CODEBUDDY_KNOWN_TAGS.
 * Returns a list of unique unknown tag names found.
 *
 * This is useful for detecting when CodeBuddy IDE adds new tags that we
 * haven't yet catalogued. Call this on the system prompt at request time
 * (in debug/logging path) to get early warning of format changes.
 */
export function detectUnknownTags(text: string): string[] {
  const tagRegex = /<(\w[\w-]*)(?:\s[^>]*?)?>/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    const tagName = match[1];
    if (!KNOWN_TAG_SET.has(tagName)) {
      found.add(tagName);
    }
  }
  return Array.from(found).sort();
}

/**
 * Scan a text for ALL XML tags (both known and unknown).
 * Returns { known: string[], unknown: string[] }.
 */
export function classifyTags(text: string): { known: string[]; unknown: string[] } {
  const tagRegex = /<(\w[\w-]*)(?:\s[^>]*?)?>/g;
  const known = new Set<string>();
  const unknown = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    const tagName = match[1];
    if (KNOWN_TAG_SET.has(tagName)) {
      known.add(tagName);
    } else {
      unknown.add(tagName);
    }
  }
  return {
    known: Array.from(known).sort(),
    unknown: Array.from(unknown).sort(),
  };
}
