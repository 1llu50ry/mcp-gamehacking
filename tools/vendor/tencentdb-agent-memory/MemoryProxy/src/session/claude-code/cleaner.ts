/**
 * Claude Code Session Init — LastUser text extractor.
 *
 * 曾经这个文件里有 `stripInitArtifacts` 用来在 session_init 完成后剥离
 * 假表单对话（避免 LLM 看到 form 交互）。**该功能已删除**——现在永远保留
 * 用户的所有真实对话（含 session_init form 交互），不做任何删除。
 *
 * 目前只剩一个 export: `getLastUserMessageText`，用于在 session_init
 * state machine 里读最后一条 user / tool 消息的文本以解析用户选择。
 */

import { containsFormTitle } from "./form.js";

interface RawMessage {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

interface AnthropicBlock {
  type?: unknown;
  text?: unknown;
  content?: unknown;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Get text from last tool message containing Claude Code form answer data.
 *
 * 优先扫最近一条 role=tool 且含 form answer 关键词 (AskUserQuestion /
 * multi_question_result / 表单标题) 的消息 —— 这是 Claude Code 上报用户
 * 选择结果时的 tool_result 载体; fallback 到最近一条 user 消息。
 */
export function getLastUserMessageText(messages: RawMessage[]): string {
  // Priority: tool messages with real answer data (JSON)
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "tool") {
      const text = getMessageText(messages[i]);
      if (text && (text.includes("AskUserQuestion") || text.includes("multi_question_result") || containsFormTitle(text))) {
        return text;
      }
    }
  }

  // Fallback: last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return getMessageText(messages[i]);
    }
  }
  return "";
}

function getMessageText(msg: RawMessage): string {
  const content = msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const raw of content as AnthropicBlock[]) {
      const type = raw.type;
      if (type === "text" && typeof raw.text === "string") {
        parts.push(raw.text);
        continue;
      }
      if (type === "tool_result") {
        const inner = raw.content;
        if (typeof inner === "string") {
          parts.push(inner);
        } else if (Array.isArray(inner)) {
          for (const c of inner as AnthropicBlock[]) {
            if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
          }
        }
      }
    }
    return parts.join("\n");
  }
  return JSON.stringify(content ?? "");
}
