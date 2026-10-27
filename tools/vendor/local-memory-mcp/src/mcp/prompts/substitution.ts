/**
 * Shared {{placeholder}} substitution for prompt content.
 *
 * Single source of truth for prompt argument substitution, used by every path
 * that renders a prompt with user args: the SDK prompts/get handler
 * (sdk-index.ts), the upstream prompts router (registry.ts), and the
 * prompt-read tool (tools/prompt.read.ts).
 *
 * User-supplied args are substituted first; `current_repo` / `current_owner`
 * are reserved keys that are NEVER read from args and are always injected
 * afterwards from the session-derived `ctx`, so a client cannot spoof the
 * auto-injected context.
 */

/** Placeholder keys reserved for session auto-injection — never honored from user args. */
const RESERVED_CONTEXT_KEYS = new Set(["current_repo", "current_owner"]);

/** Regex metacharacters escaped in a client-supplied key before building the matcher. */
const KEY_ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

/**
 * Substitutes `{{arg}}` placeholders in prompt `content` with `args` values,
 * then unconditionally injects `{{current_repo}}` and `{{current_owner}}`
 * from `ctx`.
 *
 * Keys are regex-escaped so a client-supplied key like "(" or "a.b" can never
 * throw a RegExp SyntaxError, and values are inserted via a replacement
 * function so `$&` / `$1`-style patterns are treated as literal text.
 *
 * @param content Prompt body containing {{placeholder}} tokens.
 * @param args User-supplied substitution values (reserved keys ignored).
 * @param ctx Session-derived context injected for current_repo/current_owner.
 * @returns Content with all matching placeholders substituted.
 */
export function substitutePromptArgs(
	content: string,
	args: Record<string, string> | undefined,
	ctx: { owner: string; repo: string }
): string {
	let text = content;

	for (const [key, value] of Object.entries(args ?? {})) {
		if (RESERVED_CONTEXT_KEYS.has(key)) continue;
		const escapedKey = key.replace(KEY_ESCAPE_REGEX, "\\$&");
		text = text.replace(new RegExp(`\\{{${escapedKey}\\}}`, "g"), () => value);
	}

	text = text.replace(/\{\{current_repo\}\}/g, () => ctx.repo);
	text = text.replace(/\{\{current_owner\}\}/g, () => ctx.owner);

	return text;
}
