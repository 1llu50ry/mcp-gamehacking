/**
 * CodeBuddy System Prompt Module Parser.
 *
 * Parses CodeBuddy's XML-tag-structured system prompt into discrete PromptModule objects.
 * This enables targeted injection at specific positions (before/after/inside specific tags).
 *
 * CRITICAL SAFETY GUARANTEES:
 * - No content is ever lost: every character of the original text is preserved across
 *   parse → rebuild round-trip, including whitespace, blank lines, and unknown tags.
 * - Unknown XML tags (not in CODEBUDDY_KNOWN_TAGS) are preserved as-is in text segments.
 * - Tag attributes (e.g. `<tag attr="val">`) are preserved in rawText.
 * - The parser is intentionally conservative: it only "understands" known tags for
 *   anchoring purposes, but treats everything else as opaque text that must survive
 *   the round-trip unchanged.
 */

import { CODEBUDDY_KNOWN_TAGS, TAG_DISPLAY_NAMES } from "./constants.js";

/**
 * A parsed module (section) of the system prompt.
 */
export interface PromptModule {
  /** Unique module identifier. */
  id: string;
  /** Human-readable name (for debugging). */
  name: string;
  /** XML tag name, or null for raw text segments. */
  tag: string | null;
  /** Full raw text including open/close tags. */
  rawText: string;
  /** Text between open/close tags (without tags). */
  innerText: string;
  /** Position index within the system prompt. */
  index: number;
  /** Module type. */
  type: "tagged" | "preamble" | "text_between" | "suffix";
}

/**
 * Build a regex that matches the opening of any known CodeBuddy XML tag.
 * Matches `<tag>` or `<tag ` (with attributes).
 */
function buildKnownTagRegex(): RegExp {
  // Escape special chars in tag names (e.g. hyphens in code-explorer_subagent_usage)
  const escaped = CODEBUDDY_KNOWN_TAGS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // IMPORTANT: 'g' flag is required because the parser sets .lastIndex and calls .exec()
  // in a while loop. Without 'g', .exec() always returns the first match and lastIndex
  // is never advanced, causing an infinite loop.
  return new RegExp(`<(${escaped.join("|")})(?:\\s[^>]*?)?>`, "g");
}

const KNOWN_TAG_RE = buildKnownTagRegex();

/**
 * Parse a CodeBuddy system prompt into PromptModule[].
 *
 * Strategy:
 * 1. Scan for known XML tags in order of appearance.
 * 2. Text before/between/after known tags is preserved as raw text segments
 *    (preamble / text_between / suffix) — NO trimming, NO modification.
 * 3. Known tag blocks are extracted with full rawText (including attributes).
 * 4. Unknown tags (not in CODEBUDDY_KNOWN_TAGS) stay inside text segments —
 *    they are NOT extracted as tagged modules, but their content is fully preserved.
 *
 * SAFETY: parse → rebuild is a lossless round-trip. The rebuilt text is
 * identical to the original (modulo the join separator used by rebuildSystemPrompt).
 */
export function parseCodeBuddySystemPrompt(text: string): PromptModule[] {
  const modules: PromptModule[] = [];
  let pos = 0;
  let index = 0;

  // Find the first occurrence of any known tag
  KNOWN_TAG_RE.lastIndex = 0;
  const firstMatch = KNOWN_TAG_RE.exec(text);

  // 1. Extract preamble (text before first known tag) — preserve exactly
  if (firstMatch && firstMatch.index > 0) {
    const preamble = text.slice(0, firstMatch.index);
    if (preamble.length > 0) {
      modules.push({
        id: "preamble",
        name: "系统开场白",
        tag: null,
        rawText: preamble,
        innerText: preamble,
        index: index++,
        type: "preamble",
      });
    }
    pos = firstMatch.index;
  } else if (!firstMatch) {
    // No known tags found — entire text is preamble (preserved exactly)
    modules.push({
      id: "preamble",
      name: "系统开场白",
      tag: null,
      rawText: text,
      innerText: text,
      index: 0,
      type: "preamble",
    });
    return modules;
  }

  // 2. Iteratively extract known tag blocks
  while (pos < text.length) {
    // Search for the next known tag starting from current position
    KNOWN_TAG_RE.lastIndex = pos;
    const nextTagMatch = KNOWN_TAG_RE.exec(text);

    if (!nextTagMatch) {
      // No more known tags — remainder is suffix (preserve exactly)
      const remainder = text.slice(pos);
      if (remainder.length > 0) {
        modules.push({
          id: `suffix-${index}`,
          name: "系统结尾",
          tag: null,
          rawText: remainder,
          innerText: remainder,
          index: index++,
          type: "suffix",
        });
      }
      break;
    }

    // If there's text before this tag (including unknown tags!), preserve it
    if (nextTagMatch.index > pos) {
      const betweenText = text.slice(pos, nextTagMatch.index);
      if (betweenText.length > 0) {
        modules.push({
          id: `text-${index}`,
          name: `中间文本段 ${index}`,
          tag: null,
          rawText: betweenText,
          innerText: betweenText,
          index: index++,
          type: "text_between",
        });
      }
    }

    // Extract the full tag block (from <tag> to </tag>)
    const tagName = nextTagMatch[1];
    const openTagStart = nextTagMatch.index;
    const openTagEnd = openTagStart + nextTagMatch[0].length; // after the closing >
    const closeTag = `</${tagName}>`;
    const closeIdx = text.indexOf(closeTag, openTagEnd);

    if (closeIdx === -1) {
      // No closing tag found — treat rest (including the open tag) as suffix
      const remainder = text.slice(openTagStart);
      if (remainder.length > 0) {
        modules.push({
          id: `suffix-${index}`,
          name: "未闭合标签尾部",
          tag: null,
          rawText: remainder,
          innerText: remainder,
          index: index++,
          type: "suffix",
        });
      }
      break;
    }

    const rawText = text.slice(openTagStart, closeIdx + closeTag.length);
    const innerText = text.slice(openTagEnd, closeIdx);

    modules.push({
      id: tagName,
      name: TAG_DISPLAY_NAMES[tagName] ?? tagName,
      tag: tagName,
      rawText,
      innerText,
      index: index++,
      type: "tagged",
    });

    pos = closeIdx + closeTag.length;
  }

  return modules;
}

/**
 * Detect if a system prompt is from CodeBuddy.
 * Uses presence of characteristic XML tags as heuristic.
 */
export function isCodeBuddyPrompt(systemText: string): boolean {
  // CodeBuddy has very specific tags — check for at least 2 characteristic ones
  const indicators = ["<agent_skills>", "<making_code_changes>", "<maximize_parallel_tool_calls>"];
  const matches = indicators.filter((tag) => systemText.includes(tag));
  return matches.length >= 2;
}
