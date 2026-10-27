/**
 * CodeBuddy System Prompt Module Serializer.
 * Reconstructs a system prompt from PromptModule[], with injected content.
 *
 * CRITICAL SAFETY GUARANTEES:
 * - rebuildSystemPrompt produces text that is byte-identical to the original
 *   (when no injections have been applied), because each module stores its
 *   exact rawText and they are concatenated without any separator.
 * - appendInsideTag / prependInsideTag preserve the original tag attributes
 *   (e.g. `<tag attr="val">`) by extracting the open-tag prefix from rawText
 *   rather than reconstructing `<tag>` from scratch.
 */

import type { PromptModule } from "./parser.js";

/**
 * Rebuild system prompt from modules.
 *
 * Concatenates all modules' rawText WITHOUT any separator.
 * This ensures that when no injections have been applied, the output is
 * byte-identical to the original text (since each module stores its exact
 * original rawText).
 *
 * When injections have been applied, injected modules are inserted between
 * original modules at their fractional index positions.
 */
export function rebuildSystemPrompt(modules: PromptModule[]): string {
  return modules
    .sort((a, b) => a.index - b.index)
    .map((m) => m.rawText)
    .join("");
}

/**
 * Extract the open-tag prefix from a tagged module's rawText.
 * For `<tag attr="val">content</tag>`, returns `<tag attr="val">`.
 * For `<tag>content</tag>`, returns `<tag>`.
 *
 * This preserves any attributes the original tag had.
 */
function extractOpenTag(mod: PromptModule): string {
  const tag = mod.tag;
  if (!tag) return "";
  const raw = mod.rawText;
  const openEnd = raw.indexOf(">") + 1;
  if (openEnd <= 0) return `<${tag}>`;
  return raw.slice(0, openEnd);
}

/**
 * Insert text before a specific tagged module.
 * Returns a new modules array with the insertion.
 */
export function insertBeforeTag(
  modules: PromptModule[],
  tag: string,
  text: string,
): PromptModule[] {
  const result: PromptModule[] = [];
  let inserted = false;

  for (const mod of modules) {
    if (mod.tag === tag && !inserted) {
      result.push({
        id: `injected-before-${tag}`,
        name: `注入内容(${tag}之前)`,
        tag: null,
        rawText: text,
        innerText: text,
        index: mod.index - 0.5,
        type: "text_between",
      });
      inserted = true;
    }
    result.push(mod);
  }

  return result;
}

/**
 * Insert text after a specific tagged module.
 * Returns a new modules array with the insertion.
 */
export function insertAfterTag(
  modules: PromptModule[],
  tag: string,
  text: string,
): PromptModule[] {
  const result: PromptModule[] = [];
  let inserted = false;

  for (const mod of modules) {
    result.push(mod);
    if (mod.tag === tag && !inserted) {
      result.push({
        id: `injected-after-${tag}`,
        name: `注入内容(${tag}之后)`,
        tag: null,
        rawText: text,
        innerText: text,
        index: mod.index + 0.5,
        type: "text_between",
      });
      inserted = true;
    }
  }

  return result;
}

/**
 * Append text inside a tagged module (at end of innerText).
 * Preserves the original open-tag attributes.
 */
export function appendInsideTag(
  modules: PromptModule[],
  tag: string,
  text: string,
): PromptModule[] {
  return modules.map((mod) => {
    if (mod.tag === tag) {
      const openTag = extractOpenTag(mod);
      const newInner = mod.innerText + "\n" + text;
      const newRaw = `${openTag}${newInner}</${tag}>`;
      return { ...mod, innerText: newInner, rawText: newRaw };
    }
    return mod;
  });
}

/**
 * Prepend text inside a tagged module (at beginning of innerText).
 * Preserves the original open-tag attributes.
 */
export function prependInsideTag(
  modules: PromptModule[],
  tag: string,
  text: string,
): PromptModule[] {
  return modules.map((mod) => {
    if (mod.tag === tag) {
      const openTag = extractOpenTag(mod);
      const newInner = text + "\n" + mod.innerText;
      const newRaw = `${openTag}${newInner}</${tag}>`;
      return { ...mod, innerText: newInner, rawText: newRaw };
    }
    return mod;
  });
}
