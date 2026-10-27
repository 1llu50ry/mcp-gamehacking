import { CODE_SEARCH_MAX_REGEX_LENGTH } from "../../utils/constants";

// ═══════════════════════════════════════════════════════════════════════════
// REGEX COMPILATION + ReDoS GUARD
// ═══════════════════════════════════════════════════════════════════════════

/** Thrown when `regex: true` but the needle is not a valid regular expression. */
export class InvalidCodeSearchRegexError extends Error {
	constructor(source: string) {
		super(`Invalid regex for code search: ${source}`);
		this.name = "InvalidCodeSearchRegexError";
	}
}

/**
 * Bounded repeats of a group whose body already carries a quantifier or
 * alternation explode the same way unbounded ones do — `(a|aa){25}` has up to
 * 2^25 backtracking states (OWASP's `(.*a){x}` class). Any `{n}` / `{n,m}`
 * whose min or max reaches this many repetitions is treated as "effectively
 * unbounded" by the guard. Purely a large-count heuristic; ordinary bounded
 * counts like `\d{2,4}` are unaffected (they only matter inside a suspect
 * group anyway).
 */
const REDOS_LARGE_REPEAT_MIN = 16;

/**
 * True when `pattern` contains a nested-unbounded-quantifier shape — the
 * classic ReDoS signature: a GROUP whose body carries an inner quantifier or
 * alternation, and that group is itself quantified without a small bound
 * (`*`, `+`, `{n,}`, or a large `{n}`/`{n,m}` — see REDOS_LARGE_REPEAT_MIN).
 * Repetition of a repetition (or repetition of a choice between overlapping
 * lengths) gives an attacker exponential backtracking against a long line
 * with no match — e.g. `^(a+)+$`, `(a|aa)+`, `(a+)*b`, `((ab)+)+`.
 *
 * The scan is a lightweight tokenizer, deliberately CONSERVATIVE: it can
 * never prove a pattern safe, only that it is NOT obviously catastrophic.
 * - Benign shapes scan clean: `foo.*bar` (single `.*` at top level),
 *   `\b\d{2,4}\b` (bounded count on a top-level atom), `(ab)+` (deterministic
 *   body, no inner quantifier), `(foo|bar)` (alternation but NOT quantified).
 *   These still compile.
 * - Conservative over-rejection is FINE per spec: a program that matches
 *   `(ab|cd)+` (linear in practice, non-overlapping alternatives) is also
 *   rejected — substring mode remains the default, safe path.
 *
 * @returns true when the pattern should be rejected before `new RegExp`.
 */
function hasNestedUnboundedQuantifiers(pattern: string): boolean {
	interface GroupFrame {
		/** An atom inside this group is followed by any quantifier. */
		innerQuantified: boolean;
		/** An alternation `|` appears at this group's body level. */
		hasAlternation: boolean;
	}

	const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";

	/**
	 * If `pattern[start]` begins a quantifier (`*`, `+`, `?`, `{n}`, `{n,}`,
	 * `{n,m}`) return it with the index AFTER it and whether it is
	 * "effectively unbounded" (`*`, `+`, `{n,}`, or a repeat count reaching
	 * REDOS_LARGE_REPEAT_MIN — large bounded repeats of an ambiguous group are
	 * equally catastrophic). Returns null when `start` is not a quantifier —
	 * notably a `{` that does not form a valid count, which is a literal in JS
	 * regex syntax.
	 */
	function readQuantifier(start: number): { unbounded: boolean; end: number } | null {
		const ch = pattern[start];
		if (ch === "*" || ch === "+") {
			// Lazy variant `x*?` / `x+?` — consume the trailing `?` too.
			const end = pattern[start + 1] === "?" ? start + 2 : start + 1;
			return { unbounded: true, end };
		}
		if (ch === "?") return { unbounded: false, end: start + 1 };
		if (ch === "{") {
			let j = start + 1;
			while (isDigit(pattern[j])) j++;
			const min = Number.parseInt(pattern.slice(start + 1, j), 10) || 0;
			if (pattern[j] === ",") {
				// `{n,}` unbounded; `{n,m}` bounded — unless either count is
				// large enough to be catastrophic on its own.
				let k = j + 1;
				while (isDigit(pattern[k])) k++;
				const max = k > j + 1 ? Number.parseInt(pattern.slice(j + 1, k), 10) || 0 : Infinity;
				return { unbounded: max >= REDOS_LARGE_REPEAT_MIN || min >= REDOS_LARGE_REPEAT_MIN, end: k + 1 };
			}
			if (pattern[j] === "}") return { unbounded: min >= REDOS_LARGE_REPEAT_MIN, end: j + 1 };
			return null; // `{` not forming a valid count — a literal char.
		}
		return null;
	}

	const stack: GroupFrame[] = [];

	let i = 0;
	while (i < pattern.length) {
		const ch = pattern[i];

		// Zero-width anchors are not atoms: a quantifier after them binds to
		// nothing and must not pollute the enclosing group's accounting.
		if (ch === "^" || ch === "$") {
			i++;
			continue;
		}

		if (ch === "\\") {
			i += 2; // escaped atom (`\d`, `\.`, `\b`, …)
			const q = readQuantifier(i);
			if (q !== null) {
				if (stack.length > 0) stack[stack.length - 1].innerQuantified = true;
				i = q.end;
			}
			continue;
		}

		if (ch === "[") {
			i++;
			while (i < pattern.length && pattern[i] !== "]") {
				if (pattern[i] === "\\") i++;
				i++;
			}
			i++; // past the closing `]` — the class is one atom
			const q = readQuantifier(i);
			if (q !== null) {
				if (stack.length > 0) stack[stack.length - 1].innerQuantified = true;
				i = q.end;
			}
			continue;
		}

		if (ch === "(") {
			const frame: GroupFrame = { innerQuantified: false, hasAlternation: false };
			// Skip the opener, advancing to the body start: plain `(`, `(?:`,
			// `(?=`, `(?!`, `(?<=`, `(?<!`, and named groups `(?<name>…`.
			if (pattern[i + 1] === "?") {
				if (pattern[i + 2] === "<" && pattern[i + 3] !== "=" && pattern[i + 3] !== "!") {
					const gt = pattern.indexOf(">", i + 3);
					i = gt === -1 ? pattern.length - 1 : gt;
				} else {
					i += 2;
					if (pattern[i] === "<") i++; // lookbehind opener `(?<=` / `(?<!`
				}
			}
			stack.push(frame);
			i++;
			continue;
		}

		if (ch === ")") {
			const closed = stack.pop();
			if (closed) {
				const suspect = closed.innerQuantified || closed.hasAlternation;
				const q = readQuantifier(i + 1);
				if (q !== null) {
					if (suspect && q.unbounded) return true; // the ReDoS signature
					// The quantified group is itself a repeated atom for the
					// enclosing level — nested repetition that must be flagged
					// when the outer group is later quantified (e.g. `((ab)+)+`).
					if (stack.length > 0) stack[stack.length - 1].innerQuantified = true;
					i = q.end;
					continue;
				}
			}
			i++;
			continue;
		}

		if (ch === "|") {
			if (stack.length > 0) stack[stack.length - 1].hasAlternation = true;
			i++;
			continue;
		}

		// Plain atom (literal char, `.`, or a bare quantifier char) — bind any
		// following quantifier to it.
		const q = readQuantifier(i + 1);
		if (q !== null && stack.length > 0) stack[stack.length - 1].innerQuantified = true;
		i = q !== null ? q.end : i + 1;
	}

	return false;
}

/**
 * Compile the regex form of a code search. Throws InvalidCodeSearchRegexError
 * so the handler can surface a clean INVALID_REGEX envelope.
 *
 * ReDoS guard (TASK-344): the caller-supplied needle is compiled with
 * `new RegExp(needle, "i")` and run per line against indexed files WITHOUT a
 * timeout (V8 has no RegExp timeout) on the PROCESS-SHARED server. Two cheap
 * provenance checks run BEFORE `new RegExp`:
 *   1. Length cap — needles over CODE_SEARCH_MAX_REGEX_LENGTH chars are
 *      rejected outright.
 *   2. Nested unbounded quantifiers — `^(a+)+$` / `(a|aa)+` / `(a+)*b` are
 *      the canonical exponential-backtracking signatures.
 * Both rejections propagate as InvalidCodeSearchRegexError so the handler
 * surfaces the existing INVALID_REGEX envelope instead of hanging.
 */
export function compileCodeSearchRegex(needle: string): RegExp {
	if (needle.length > CODE_SEARCH_MAX_REGEX_LENGTH) {
		throw new InvalidCodeSearchRegexError(
			`pattern exceeds the ${CODE_SEARCH_MAX_REGEX_LENGTH}-character limit for code-search regexes`
		);
	}
	if (hasNestedUnboundedQuantifiers(needle)) {
		throw new InvalidCodeSearchRegexError(
			"pattern contains nested unbounded quantifiers (potential ReDoS) — use substring mode instead"
		);
	}
	try {
		// Case-insensitive by default — mirrors the substring matcher.
		return new RegExp(needle, "i");
	} catch (err) {
		throw new InvalidCodeSearchRegexError(err instanceof Error ? err.message : String(err));
	}
}
