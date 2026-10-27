/**
 * Re-exports from the knowledge-graph/ module for backward compatibility.
 *
 * `KgEntityRow` / `KgRelationRow` / `KgObservationRow` are TYPE-ONLY exports —
 * the `type` modifiers keep them compile-time only. (Without them, esbuild/tsx
 * emits runtime re-exports of symbols that do not exist as values, breaking
 * tsx-based tooling with "does not provide an export named 'KgEntityRow'";
 * vite-node's lenient runner masked it.) KnowledgeGraphEntity is a value.
 */
export {
	KnowledgeGraphEntity,
	type KgEntityRow,
	type KgRelationRow,
	type KgObservationRow
} from "./knowledge-graph/index";
