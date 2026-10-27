/**
 * Agent adaptation layer — generic interface.
 *
 * The protocol adapters (OpenAI / Anthropic) solve *wire-protocol* differences.
 * The AgentProfile solves *structural* differences of the system prompt plus the
 * mapping from agent-agnostic semantic slots to each agent's concrete structure.
 *
 * Every agent (CodeBuddy / Claude Code / Cursor / ...) implements one AgentProfile.
 * Adding a new agent = add a Profile to the registry; hooks and the pipeline stay
 * untouched.
 */

import type { AnchorRelation, Protocol, SemanticSlot } from "../types.js";

/** Underlying structural form of a prompt segment. */
export type SegmentKind =
  | "xml_tag" // <tag>...</tag>            (CodeBuddy)
  | "markdown_section" // ## Heading\n...  (Claude Code)
  | "json_field" // { "field": ... }       (Cursor, ...)
  | "plain"; // unstructured text (preamble / between-text / suffix)

/**
 * One segment of a structured system prompt (agent-agnostic).
 * CodeBuddy's PromptModule is just the `kind === "xml_tag"` specialization.
 */
export interface PromptSegment {
  /** Unique segment identifier. */
  id: string;
  /** Structural form. */
  kind: SegmentKind;
  /** Structural key: tag name / heading text / JSON path; null for plain segments. */
  key: string | null;
  /** Full text including structural markers. */
  rawText: string;
  /** Inner text with structural markers stripped. */
  innerText: string;
  /** Sort position (injected segments use ±0.5 to land next to a neighbor). */
  index: number;
}

/**
 * Resolved anchor: a concrete structural key plus the insertion relation.
 */
export interface ResolvedAnchor {
  key: string;
  relation: AnchorRelation;
}

/**
 * Agent adaptation layer. One implementation per agent.
 */
export interface AgentProfile {
  /** Agent identifier ("codebuddy" | "claude-code" | ...). */
  readonly id: string;
  /** Underlying wire protocol (selects which ProtocolAdapter does parse/serialize). */
  readonly protocol: Protocol;

  /** Fingerprint detection: does this system prompt belong to this agent? */
  detect(systemText: string): boolean;

  /** Split the system prompt into structural segments. */
  parse(systemText: string): PromptSegment[];

  /**
   * Semantic slot → this agent's concrete structural key.
   * Returns the key on hit, or null when this agent has no such slot (triggers fallback).
   */
  resolveSlot(slot: SemanticSlot): string | null;

  /** Land `text` relative to the resolved key/relation; returns a new segment array. */
  applyAnchor(
    segments: PromptSegment[],
    resolved: ResolvedAnchor,
    text: string,
  ): PromptSegment[];

  /** Re-assemble segments back into a system-prompt string. */
  rebuild(segments: PromptSegment[]): string;
}
