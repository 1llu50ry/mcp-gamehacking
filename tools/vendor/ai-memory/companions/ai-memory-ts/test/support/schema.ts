/**
 * Normalization of the server's `tools/list` into the committed snapshot
 * `schema/tools.json`: tool names, property names, types, `required` and
 * enums. Descriptions, defaults and numeric bounds are dropped because they
 * change often and carry no wire contract.
 */

export interface NormalizedSchema {
  type?: string | string[];
  enum?: string[];
  items?: NormalizedSchema;
  properties?: Record<string, NormalizedSchema>;
  required?: string[];
  additionalProperties?: NormalizedSchema | boolean;
}

export interface NormalizedTool {
  properties: Record<string, NormalizedSchema>;
  required: string[];
}

export type NormalizedTools = Record<string, NormalizedTool>;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveRef(schema: Json, defs: Json): Json {
  const ref = schema["$ref"];
  if (typeof ref !== "string") return schema;
  const name = ref.replace(/^#\/\$defs\//, "");
  const target = defs[name];
  if (!isRecord(target)) throw new Error(`unresolved $ref ${ref}`);
  const { $ref: _ref, ...rest } = schema;
  return { ...resolveRef(target, defs), ...rest };
}

function normalizeSchema(input: unknown, defs: Json, depth = 0): NormalizedSchema {
  if (!isRecord(input) || depth > 8) return {};
  const schema = resolveRef(input, defs);
  const out: NormalizedSchema = {};
  const types = new Set<string>();
  const type = schema["type"];
  if (typeof type === "string") types.add(type);
  else if (Array.isArray(type)) for (const t of type) if (typeof t === "string") types.add(t);

  const enums = new Set<string>();
  if (Array.isArray(schema["enum"])) {
    for (const value of schema["enum"]) if (typeof value === "string") enums.add(value);
  }
  if (typeof schema["const"] === "string") enums.add(schema["const"]);
  // `oneOf`/`anyOf` unions (an enum of consts, or `T | null`) fold into one
  // set of types and one enum.
  for (const key of ["oneOf", "anyOf"]) {
    const variants = schema[key];
    if (!Array.isArray(variants)) continue;
    for (const variant of variants) {
      const n = normalizeSchema(variant, defs, depth + 1);
      if (typeof n.type === "string") types.add(n.type);
      else if (Array.isArray(n.type)) for (const t of n.type) types.add(t);
      for (const value of n.enum ?? []) enums.add(value);
    }
  }
  if (types.size === 1) out.type = [...types][0] as string;
  else if (types.size > 1) out.type = [...types].sort();
  if (enums.size > 0) out.enum = [...enums].sort();

  if (schema["items"] !== undefined) out.items = normalizeSchema(schema["items"], defs, depth + 1);
  if (isRecord(schema["properties"])) {
    out.properties = {};
    for (const key of Object.keys(schema["properties"]).sort()) {
      out.properties[key] = normalizeSchema(schema["properties"][key], defs, depth + 1);
    }
  }
  if (Array.isArray(schema["required"])) {
    out.required = schema["required"].filter((r): r is string => typeof r === "string").sort();
  }
  const extra = schema["additionalProperties"];
  if (typeof extra === "boolean") out.additionalProperties = extra;
  else if (isRecord(extra)) out.additionalProperties = normalizeSchema(extra, defs, depth + 1);
  return out;
}

/** Normalize a `tools/list` result (`{ tools: [...] }`). */
export function normalizeTools(listResult: unknown): NormalizedTools {
  if (!isRecord(listResult) || !Array.isArray(listResult["tools"])) {
    throw new Error("tools/list result has no tools array");
  }
  const out: NormalizedTools = {};
  const tools = [...listResult["tools"]].filter(isRecord);
  tools.sort((a, b) => String(a["name"]).localeCompare(String(b["name"])));
  for (const tool of tools) {
    const name = tool["name"];
    const input = tool["inputSchema"];
    if (typeof name !== "string" || !isRecord(input)) continue;
    const defs = isRecord(input["$defs"]) ? input["$defs"] : {};
    const normalized = normalizeSchema(input, defs);
    out[name] = {
      properties: normalized.properties ?? {},
      required: normalized.required ?? [],
    };
  }
  return out;
}

/** JSON with object keys sorted, two-space indent, trailing newline. */
export function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (isRecord(v)) {
      const out: Json = {};
      for (const key of Object.keys(v).sort()) out[key] = sort(v[key]);
      return out;
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/**
 * Differences between the committed snapshot and the server, one line per
 * finding, naming the tool and the properties that differ.
 */
export function diffTools(expected: NormalizedTools, actual: NormalizedTools): string[] {
  const findings: string[] = [];
  for (const name of Object.keys(actual).sort()) {
    if (!(name in expected)) findings.push(`new tool on the server: ${name}`);
  }
  for (const name of Object.keys(expected).sort()) {
    const want = expected[name];
    const got = actual[name];
    if (want === undefined) continue;
    if (got === undefined) {
      findings.push(`tool removed from the server: ${name}`);
      continue;
    }
    const props = new Set([...Object.keys(want.properties), ...Object.keys(got.properties)]);
    const changed = [...props].sort().filter(
      (prop) =>
        stableStringify(want.properties[prop] ?? null) !==
        stableStringify(got.properties[prop] ?? null),
    );
    if (changed.length > 0) findings.push(`${name}: properties differ: ${changed.join(", ")}`);
    if (stableStringify(want.required) !== stableStringify(got.required)) {
      findings.push(
        `${name}: required differs: snapshot [${want.required.join(", ")}], server [${got.required.join(", ")}]`,
      );
    }
  }
  return findings;
}
