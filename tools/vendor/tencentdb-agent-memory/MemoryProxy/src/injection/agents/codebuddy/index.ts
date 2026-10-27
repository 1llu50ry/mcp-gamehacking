/**
 * CodeBuddy Adapter.
 *
 * Extends the OpenAI adapter with CodeBuddy-specific system prompt module parsing.
 * Enables targeted injection at specific XML tag boundaries.
 */

export { CODEBUDDY_KNOWN_TAGS, TAG_DISPLAY_NAMES, TOOL_ANCHOR_TAGS, MEMORY_ANCHOR_TAGS } from "./constants.js";
export { parseCodeBuddySystemPrompt, isCodeBuddyPrompt } from "./parser.js";
export type { PromptModule } from "./parser.js";
export {
  rebuildSystemPrompt,
  insertBeforeTag,
  insertAfterTag,
  appendInsideTag,
  prependInsideTag,
} from "./serializer.js";
export { CodeBuddyProfile } from "./profile.js";
