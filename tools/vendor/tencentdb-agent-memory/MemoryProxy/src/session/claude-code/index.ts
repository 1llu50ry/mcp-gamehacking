/**
 * Claude Code Session Init — Public API.
 *
 * 独立的 Claude Code session-init 实现：
 *   - Form: `AskUserQuestion` tool_use (仅 Anthropic SSE)
 *   - Extractor: JSON tool_result 解析
 *   - Cleaner: tool_use id 匹配
 *   - 分页模式: 每页 3 个 agent + "更多→" 按钮
 */

export { handleSessionInit } from "./init.js";
export type { SessionRequestContext, SessionInitResult } from "./init.js";

export { buildFormResponse, containsFormTitle, isSessionInitToolCallId } from "./form.js";
export { TOOL_NAME, TOOLCALL_PREFIX, SKIP_LABEL, MORE_LABEL, TEAM_FORM_TITLE, AGENT_TASK_FORM_TITLE, RETRY_FORM_TITLE } from "./form.js";
export type { FormData, FormStage } from "./form.js";

export { extractFromOptionText, extractTeamFromOptionText, extractTaskFromOptionText, extractStructured, resolveAgent, resolveTask, BYPASS_MARKER, MORE_MARKER } from "./extractor.js";
export { getLastUserMessageText } from "./cleaner.js";
