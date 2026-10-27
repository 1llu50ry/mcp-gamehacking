/**
 * TypeScript reference-emission barrel (TASK-552 split).
 *
 * ts-reference-emission.ts was split into cohesive modules by emission family
 * under `ts-reference-emission/`: name helpers (name-helpers.ts), import /
 * reexport edges (imports.ts), heritage edges (heritage.ts), and type-ref
 * edges (type-refs.ts). This barrel re-exports the full public surface so
 * existing `from "./ts-reference-emission"` imports keep resolving unchanged.
 */

export { calledExpressionName, constructorName, memberPropertyName } from "./name-helpers";
export { emitImports, emitReexports } from "./imports";
export { emitHeritage, heritageTargetName } from "./heritage";
export { emitTypeReferences, emitTypeRefs, typeRefName } from "./type-refs";
