/**
 * DocComment - shared PHPDoc/JSDoc extraction and serialization for symbol
 * metadata.
 *
 * Language visitors capture the raw preceding doc-comment block for a symbol
 * and hand the raw text to `cleanDocBlock` (strips block delimiters and the
 * leading star-colon on each line) then `serializeDocBlock` (parses the summary
 * line, doc-tags and @deprecated, and recomposes a canonical, fully-searchable
 * string).
 *
 * The composed string is stored in `docComment` (mapped to the `doc_comment`
 * column) so it remains FTS5-indexed in `codebase_symbols_fts`. The format is:
 *
 *     <summary line>          (with `[DEPRECATED]` prefix when @deprecated)
 *     <remaining prose lines>
 *     @param ...               (doc-tag lines, in source order)
 *     @return ...
 *     @deprecated ...
 *
 * All words from the original docblock are preserved, so search over the FTS
 * `doc_comment` column matches summary terms and tag terms alike. Single-line,
 * tag-free docblocks (e.g. `Adds two ints.`) round-trip unchanged.
 */

export interface DocTag {
	/** Full tag token including the leading @, e.g. "@param". */
	tag: string;
	/** Everything after the tag name, trimmed; empty when bare (e.g. "@deprecated"). */
	text: string;
}

export interface StructuredDoc {
	/** First non-tag, non-empty line (null when the docblock starts with tags). */
	summary: string | null;
	/** Remaining non-tag prose lines after the summary. */
	description: string[];
	/** Doc-tags in source order. */
	tags: DocTag[];
	/** Whether "@deprecated" (case-insensitive) is present. */
	deprecated: boolean;
}

/**
 * Strip a raw block or line comment into clean lines without the block
 * delimiters, leading `*` or `//` markers.
 */
export function cleanDocBlock(raw: string): string {
	return raw
		.replace(/^\/\/[/!]?\s*/, "") // leading `//`, `///` or `//!`
		.replace(/^\/\*\*?\s*/, "") // leading `/**` or `/*`
		.replace(/\s*\*\/\s*$/, "") // trailing `*/`
		.split("\n")
		.map((line) =>
			line
				.replace(/^\s*\/\/[/!]?\s?/, "")
				.replace(/^\s*#\s?/, "")
				.replace(/^\s*\*\s?/, "")
				.trim()
		)
		.filter((line) => line.length > 0)
		.join("\n")
		.trim();
}

/** Split clean docblock lines into summary, description and doc-tags. */
export function parseDocBlock(cleaned: string): StructuredDoc {
	const lines = cleaned
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	const tags: DocTag[] = [];
	const description: string[] = [];

	for (const line of lines) {
		if (line.startsWith("@")) {
			const end = line.indexOf(" ");
			if (end === -1) {
				tags.push({ tag: line, text: "" });
			} else {
				tags.push({ tag: line.slice(0, end), text: line.slice(end).trim() });
			}
		} else {
			description.push(line);
		}
	}

	const summary = description[0] ?? null;
	const deprecated = tags.some((t) => t.tag.toLowerCase().startsWith("@deprecated"));

	return { summary, description: description.slice(1), tags, deprecated };
}

/**
 * Parse a raw docblock and recompose a canonical, fully-searchable docString.
 * Returns null when there is no content (e.g. an empty comment).
 */
export function serializeDocBlock(raw: string): string | null {
	const cleaned = cleanDocBlock(raw);
	if (cleaned.length === 0) return null;

	const parsed = parseDocBlock(cleaned);
	const out: string[] = [];

	if (parsed.summary) {
		out.push(parsed.deprecated ? `[DEPRECATED] ${parsed.summary}` : parsed.summary);
	}
	out.push(...parsed.description);
	for (const t of parsed.tags) {
		out.push(t.text.length > 0 ? `${t.tag} ${t.text}` : t.tag);
	}

	const text = out.join("\n");
	return text.length > 0 ? text : null;
}
