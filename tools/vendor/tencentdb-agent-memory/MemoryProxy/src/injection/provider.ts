/**
 * Content provider + generic injection-hook factory.
 *
 * Hooks are not limited to skill/memory/wiki — they serve *any* injectable
 * context content. Every injection is structurally identical:
 *
 *   "At some *semantic position*, place a piece of content produced by some
 *    *data source*, optionally wrapped by some *shell*."
 *
 * So the variable parts are extracted into a ContextContentProvider (the data
 * source) plus a declarative spec; createInjectionHook composes them into a
 * standard InjectionHook. 99% of injectors no longer need a bespoke class.
 */

import type {
  AgentContext,
  AnchorTarget,
  ContextBlock,
  HookPriority,
  InjectionHook,
  InjectionPoint,
} from "./types.js";

/**
 * Content provider: responsible for "fetching data".
 * Any source that can produce context content for the current request implements
 * this — skill catalog, user memory, knowledge retrieval, compliance notice,
 * A/B experiment copy ... all treated alike.
 */
export interface ContextContentProvider {
  id: string;
  /** Produce content blocks for the current request; empty array = no injection. */
  provide(ctx: AgentContext): Promise<ContextBlock[]> | ContextBlock[];
}

/** Declarative config for a generic injection hook. */
export interface InjectionHookSpec {
  id: string;
  /** Data source (variable). */
  provider: ContextContentProvider;
  /** Landing position: semantic slot + relation (variable, optional). */
  anchor?: AnchorTarget;
  /** Fallback landing position (required). */
  point: InjectionPoint;
  priority: HookPriority;
  description: string;
  /** Optional shell: wrap the content into a block, e.g. t => `<tag>\n${t}\n</tag>`. */
  wrap?: (text: string) => string;
}

/**
 * Generic hook factory: combine "fetch + landing + shell" into a standard
 * InjectionHook.
 */
export function createInjectionHook(spec: InjectionHookSpec): InjectionHook {
  return {
    id: spec.id,
    point: spec.point,
    anchor: spec.anchor,
    priority: spec.priority,
    description: spec.description,
    async execute(ctx: AgentContext): Promise<ContextBlock[]> {
      const blocks = await spec.provider.provide(ctx);
      if (blocks.length === 0) return [];
      if (!spec.wrap) return blocks;
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.content)
        .join("\n");
      return [{ type: "text", content: spec.wrap(text), metadata: { source: spec.id } }];
    },
  };
}
