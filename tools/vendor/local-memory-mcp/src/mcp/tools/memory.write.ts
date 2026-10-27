/**
 * Backward-compatible re-exporter.
 *
 * The memory-write logic has been split into:
 *   src/mcp/tools/memory-write/
 *     ├── index.ts    — main handler + re-exports
 *     ├── create.ts   — single create
 *     ├── update.ts   — single update + acknowledge
 *     ├── bulk.ts     — bulk operations
 *     └── helpers.ts  — shared utilities
 *
 * This file re-exports the public API for backward compatibility.
 * All new imports should target "memory-write" directly.
 */
export {
	handleMemoryWrite,
	handleCreate,
	handleUpdate,
	handleAcknowledge,
	handleBulk,
	inferWriteMode,
	applyDecisionFields,
	applySessionFields,
	buildMemoryEntry,
	checkCreateConflict
} from "./memory-write";
