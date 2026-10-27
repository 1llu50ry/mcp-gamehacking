/**
 * template.ts — 读取 wiki/schema.md 与 wiki/purpose.md 作为抽取模板（FR-4b）。
 *
 * 这两个文件让用户/调用方自定义"这个 wiki 想抽什么、怎么组织"：
 *   - purpose.md：声明 wiki 的目标领域与用途。
 *   - schema.md：声明抽取偏好（想要哪些页面类型、关注字段、命名/语言约定）。
 *
 * ingest 时把它们「原样拼进 system prompt」（不强制机器解析骨架，容错）。
 * 为空/不存在时用领域中立的默认骨架兜底，保证开箱即用。
 *
 * 注意：init 已存在的默认文件（manager.initWikiProject）可能只是空壳
 * （如仅 `# Wiki Schema\n\nDefine ... here.`），这类视为"无有效内容"，用默认。
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

export interface WikiTemplate {
  /** purpose.md 的有效正文（去 frontmatter），无则为默认。 */
  purpose: string;
  /** schema.md 的有效正文（去 frontmatter），无则为默认。 */
  schema: string;
  /** 是否使用了用户自定义内容（用于日志/调试）。 */
  customized: boolean;
}

/** Default purpose — software engineering knowledge base. */
export const DEFAULT_PURPOSE = `This knowledge base accumulates and organizes engineering knowledge of software systems,
including system architecture, module design, data flow, deployment models, permission models, etc.
By ingesting requirement documents, architecture designs, meeting notes, RFCs, technical decisions and other
source documents, it builds a structured, cross-referenced knowledge graph to help team members quickly
understand the system landscape and the rationale behind design decisions.`;

/** Default schema skeleton — software engineering knowledge base. */
export const DEFAULT_SCHEMA = `# Page types
- entity — a concrete component or role in the system; must declare a kind field
- concept — an abstract design idea (system architecture, module boundaries, data flow, deployment model, permission model, evaluation framework, etc.)
- source — one summary page per ingested source document; must declare a source_type field
Other types (comparison, synthesis, etc.) may be created as needed.

# Fields / sections per type
- entity:
    - kind: module | service | platform | external_system | user_role | other (required)
    - definition: responsibility / purpose
    - key attributes: key properties
    - relationships: relationships to other entities
- concept:
    - definition: concept definition
    - significance: importance / role
    - related entities: associated entities
    - common topics: system architecture, module boundaries, data flow, deployment model, permission model, evaluation framework
- source:
    - source_type: requirement | architecture | meeting | rfc | decision | other (required)
    - source document summary
- Use OKF sections where applicable: # Schema / # Examples / # Citations

# Naming & language
- slug: lowercase, spaces→hyphens
- Output language: follow the source document — do not switch`;

/** 判断一段正文是否"有实质内容"（排除 init 写入的空壳占位）。 */
function hasMeaningfulContent(body: string): boolean {
  const stripped = body
    .replace(/^#.*$/gm, "")              // 去掉标题行
    .replace(/Define\b[^.。]*[.。]?/gi, "") // 去掉 "Define ..." 占位句（init 默认壳）
    .replace(/\s+/g, "");
  return stripped.length >= 8;
}

function readTemplateFile(projectPath: string, name: string): string | null {
  const full = join(projectPath, "wiki", name);
  if (!existsSync(full)) return null;
  try {
    const content = readFileSync(full, "utf-8");
    const { body } = parseFrontmatter(content);
    const trimmed = body.trim();
    if (!trimmed || !hasMeaningfulContent(trimmed)) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * 加载抽取模板。存在且有实质内容则用用户的；否则用领域中立默认。
 */
export function loadTemplate(projectPath: string): WikiTemplate {
  const purpose = readTemplateFile(projectPath, "purpose.md");
  const schema = readTemplateFile(projectPath, "schema.md");
  return {
    purpose: purpose ?? DEFAULT_PURPOSE,
    schema: schema ?? DEFAULT_SCHEMA,
    customized: purpose != null || schema != null,
  };
}
