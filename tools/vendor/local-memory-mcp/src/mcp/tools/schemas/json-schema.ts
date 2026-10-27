import { toJSONSchema, type z } from "zod";

/**
 * Single-source-of-truth tool input contracts (TASK-036).
 *
 * The MCP tool `inputSchema` (JSON Schema) is DERIVED from the Zod schemas in
 * `src/mcp/tools/schemas/*` — the Zod schema is the only place a tool's input
 * contract is declared. Hand-editing the `inputSchema` inside `definitions/*`
 * is forbidden; change the Zod schema instead, and the tool contract follows.
 *
 * ## Generation engine
 *
 * Uses Zod 4's native JSON Schema generator (`z.toJSONSchema`, exported as
 * `toJSONSchema`) with:
 *   - `io: "input"`     — emit the INPUT contract (what clients send). This
 *     resolves `.transform()` fields (e.g. `repo` with `normalizeRepo`) to
 *     their pre-transform string type.
 *   - `target: "draft-07"` — matches the MCP tool-schema conventions used
 *     throughout this repo (draft-07 keyword set).
 *   - `unrepresentable: "any"` — never throw on exotic schema shapes.
 *
 * Note: `zod-to-json-schema` v3.25.x was evaluated but REJECTED — it only
 * reads Zod 3-style `_def.typeName` internals (`zod/v3`), so it emits empty
 * schemas for Zod 4.x instances (`{ $schema }` only). Zod 4's built-in
 * `toJSONSchema` is the maintained successor.
 *
 * ## Normalization (documented, generic — not per-tool hacks)
 *
 * The raw generator output is post-processed so the emitted contract matches
 * the repo's existing MCP tool-schema conventions and — critically — preserves
 * the runtime validation semantics of the `@modelcontextprotocol/server` SDK
 * (tool args are validated against `inputSchema` via AJV BEFORE the handler /
 * `normalizeToolArguments` run):
 *
 *   1. Strip `$schema` — the SDK's default validator supports JSON Schema
 *      2020-12 only and throws on any other declared dialect.
 *   2. Drop `required` arrays (at any nesting level) whose members are all
 *      session-injectable fields (`owner`/`repo`). Those fields are
 *      auto-injected/healed from session/roots by `normalizeToolArguments`
 *      (including nested `scope.owner`/`scope.repo`), so marking them required
 *      would reject valid calls before injection. Pass `{ required }` to
 *      keep/force a root list (e.g. `codebase-index` requires `repo`).
 *   3. Drop `additionalProperties: false` on plain objects — absent means
 *      "allowed" in draft-07/AJV, preserving pass-through of legacy/unknown
 *      arguments (current behavior).
 *   4. Collapse open records (`z.record(z.string(), z.unknown())`) to
 *      `{ type: "object" }` — matches the repo convention for `metadata` etc.
 *   5. `type: "integer"` → `"number"` — repo convention; `z.coerce.number()
 *      .int()` still enforces integers at the handler.
 *   6. Drop `minimum`/`maximum` equal to ±`Number.MAX_SAFE_INTEGER` — artifacts
 *      of `z.number().int()`.
 *   7. Drop `pattern` when `format` is present — Zod's uuid regex artifact
 *      (the repo only ever used `format: "uuid"`).
 *   8. Relax every string-typed property that would reject `""` (via
 *      `minLength`, `enum`, `pattern`, or `format`) to `anyOf: [<node>,
 *      { const: "" }]` — an empty-string parameter is "not provided" for every
 *      tool and is stripped by `normalizeToolArguments` AFTER the SDK AJV
 *      validation, so AJV must not reject it first (FIX-EMPTY-PARAMS). The
 *      non-empty constraints remain enforced; the handler Zod schema stays the
 *      authoritative gate for non-empty values.
 *   9. Annotate every session-injectable property (`owner`/`repo`, any nesting
 *      level) with a `description` documenting that the field is auto-injected
 *      from the session / MCP workspace roots when omitted or empty
 *      (FIX-029). Because rule 2 drops these fields from `required`, agents
 *      may omit them; the annotation tells the agent WHY that is safe and how
 *      to override. An existing `.describe()` is preserved and the note
 *      appended.
 *
 * `description` fields (from `.describe()`) are kept — they are part of the
 * Zod contract and richer than the old handwritten copies.
 */

/** Fields that `normalizeToolArguments` injects/heals from the session when absent or empty. */
const SESSION_INJECTABLE = new Set(["owner", "repo"]);

/**
 * Appended to every session-injectable property's description (rule 9,
 * FIX-029) so agents know the field is auto-filled and how to override it.
 */
const SESSION_INJECTION_NOTE =
	"Auto-injected from the session / MCP workspace roots when omitted or empty; pass an explicit value to override.";

/** Raw JSON Schema nodes produced by `toJSONSchema`. */
type JsonNode = unknown;

/**
 * Detect whether a JSON Schema node is string-typed and would reject the empty
 * string under AJV (`minLength`, `enum`, `pattern`, or `format` constraint).
 *
 * @param node  normalized JSON Schema node
 * @returns true when `""` must be explicitly allowed for this node
 */
function rejectsEmptyString(node: Record<string, unknown>): boolean {
	const isStringType =
		node.type === "string" ||
		(Array.isArray(node.type) && node.type.includes("string")) ||
		(Array.isArray(node.enum) && node.enum.length > 0 && node.enum.every((value) => typeof value === "string"));
	if (!isStringType) return false;

	if (typeof node.minLength === "number" && node.minLength > 0) return true;
	if (Array.isArray(node.enum) && !node.enum.includes("")) return true;
	if (typeof node.pattern === "string") return true;
	if (typeof node.format === "string") return true;
	return false;
}

/**
 * Annotates `owner`/`repo` properties of a normalized object node with the
 * session-injection note (rule 9, FIX-029). Mutates `out.properties` in place
 * and preserves any existing `description` by appending the note.
 *
 * @param out  normalized JSON Schema object node
 */
function annotateSessionInjectables(out: Record<string, unknown>): void {
	const properties = out.properties;
	if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return;

	for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
		if (!SESSION_INJECTABLE.has(key)) continue;
		if (value === null || typeof value !== "object" || Array.isArray(value)) continue;

		const node = value as Record<string, unknown>;
		const existing = typeof node.description === "string" ? node.description.trim() : "";
		node.description = existing ? `${existing} ${SESSION_INJECTION_NOTE}` : SESSION_INJECTION_NOTE;
	}
}

/**
 * Recursively apply the normalization rules above.
 *
 * @param node  current JSON Schema node
 */
function normalizeNode(node: JsonNode): JsonNode {
	if (Array.isArray(node)) {
		return node.map((item) => normalizeNode(item));
	}
	if (node === null || typeof node !== "object") {
		return node;
	}

	const obj = node as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (key === "$schema") continue; // rule 1
		out[key] = normalizeNode(value);
	}

	const hasProperties = "properties" in out;
	const isRecord = !hasProperties && "propertyNames" in out;

	// Rule 2: session-injectable-only required arrays — any level
	const required = out.required;
	if (Array.isArray(required) && required.length > 0 && required.every((f) => SESSION_INJECTABLE.has(f as string))) {
		delete out.required;
	}

	// Rule 4: open records → { type: "object" }
	if (isRecord) {
		const recordValue = out.additionalProperties;
		const isOpen =
			recordValue === undefined ||
			recordValue === true ||
			(typeof recordValue === "object" && recordValue !== null && Object.keys(recordValue).length === 0);
		if (isOpen) {
			const rec: Record<string, unknown> = {};
			if (typeof out.type === "string") rec.type = out.type;
			return rec;
		}
		// Typed record (value schema known) — keep the value schema, drop the key schema
		delete out.propertyNames;
		return out;
	}

	// Rule 3: plain objects stay open to additional properties
	if (hasProperties && out.additionalProperties === false) {
		delete out.additionalProperties;
	}

	// Rule 9: document session-injection on owner/repo properties (FIX-029).
	// Children are already normalized, so a string-typed owner/repo may now be
	// an anyOf wrapper — the note is placed on whichever node carries it.
	if (hasProperties) {
		annotateSessionInjectables(out);
	}

	// Rule 5: integer → number (repo convention)
	if (out.type === "integer") out.type = "number";

	// Rule 6: safe-integer bounds are artifacts of z.number().int()
	if (out.minimum === -Number.MAX_SAFE_INTEGER) delete out.minimum;
	if (out.maximum === Number.MAX_SAFE_INTEGER) delete out.maximum;

	// Rule 7: uuid regex pattern artifact
	if (typeof out.format === "string" && "pattern" in out) {
		delete out.pattern;
	}

	// Rule 8: allow "" for any string-typed property (FIX-EMPTY-PARAMS). The SDK
	// validates args against this schema via AJV BEFORE normalizeToolArguments
	// strips empty strings, so a constrained string/enum must accept "" here.
	// Non-empty constraints stay enforced; the handler Zod schema is the
	// authoritative gate for non-empty values.
	if (rejectsEmptyString(out)) {
		const inner = { ...out };
		const wrapper: Record<string, unknown> = { anyOf: [inner, { const: "" }] };
		// Keep the doc metadata on the outer node so clients still surface it.
		if (typeof inner.description === "string") {
			wrapper.description = inner.description;
			delete inner.description;
		}
		if (typeof inner.title === "string") {
			wrapper.title = inner.title;
			delete inner.title;
		}
		return wrapper;
	}

	return out;
}

export interface InputSchemaOptions {
	/**
	 * Explicit root `required` array for the tool contract. When omitted, the
	 * derived `required` array is kept only if it contains a non
	 * session-injectable field (e.g. `objective`, `signals`), and dropped when
	 * it only lists `owner`/`repo` (any nesting level).
	 *
	 * Pass this for tools whose contract intentionally requires a
	 * session-injectable field anyway (e.g. `codebase-index`/`codebase-read`
	 * require `repo`).
	 */
	required?: readonly string[];
}

/**
 * Derive the MCP tool `inputSchema` (JSON Schema) from a Zod schema.
 *
 * The Zod schema in `schemas/*` is the single source of truth; the returned
 * JSON Schema is the derived, normalized contract. See the module header for
 * the exact generation + normalization rules.
 */
export function inputSchemaFromSchema(schema: z.ZodType, options?: InputSchemaOptions): Record<string, unknown> {
	const raw = toJSONSchema(schema, { io: "input", target: "draft-07", unrepresentable: "any" });
	const normalized = normalizeNode(raw) as Record<string, unknown>;

	// Root `required` may have been dropped by rule 2 — restore explicit contract
	if (options?.required) {
		normalized.required = [...options.required];
	}

	return normalized;
}
