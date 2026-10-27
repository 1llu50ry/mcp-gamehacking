/**
 * TypeScriptVisitor barrel (TASK-556 split).
 *
 * typescript-visitor.ts was split into cohesive modules under
 * `typescript-visitor/`: symbol construction (ts-symbol-builder.ts), the
 * symbol-extraction AST walker (ts-symbol-walker.ts), and the
 * reference-extraction AST walker (ts-reference-walker.ts). This barrel
 * re-exports the public surface (the TypeScriptVisitor class) so existing
 * `from "./typescript-visitor"` imports keep resolving unchanged.
 */

export { TypeScriptVisitor } from "./ts-visitor";
