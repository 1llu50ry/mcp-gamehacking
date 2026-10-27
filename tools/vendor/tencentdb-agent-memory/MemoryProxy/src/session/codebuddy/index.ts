/**
 * CodeBuddy Session Init — Public API.
 *
 * 独立的 CodeBuddy session-init 实现：
 *   - Form: `ask_followup_question` tool_call
 *   - Extractor: `<question_answer>` XML
 *   - Cleaner: XML envelope 检测
 *   - 无分页、无选项数限制
 */

export { handleSessionInit } from "./init.js";
export type { SessionRequestContext, SessionInitResult } from "./init.js";

export { buildFormResponse, containsFormTitle, isSessionInitToolCallId } from "./form.js";
export { TOOL_NAME, TOOLCALL_PREFIXES, SKIP_LABEL, TEAM_FORM_TITLE, AGENT_TASK_FORM_TITLE, RETRY_FORM_TITLE, COMBINED_FORM_TITLE } from "./form.js";
export type { FormData, FormStage } from "./form.js";

export { extractFromOptionText, extractTeamFromOptionText, extractStructured, resolveAgent, resolveTask, BYPASS_MARKER } from "./extractor.js";
export { getLastUserMessageText } from "./cleaner.js";
