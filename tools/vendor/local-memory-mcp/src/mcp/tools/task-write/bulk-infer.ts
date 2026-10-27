import { ItemInfer } from "./types";

// ---------------------------------------------------------------------------
// Item mode inference (create vs update per item)
// ---------------------------------------------------------------------------

/**
 * Infers whether a bulk item is a CREATE or UPDATE.
 * - If the item has an `id` (UUID), it's always an UPDATE.
 * - If `code` is set but none of the required CREATE fields (phase, title, description) are present,
 *   it's an UPDATE (e.g., status-only update).
 * - Otherwise (has phase + title + description, with or without code), it's a CREATE.
 */
export function inferItemMode(item: Record<string, unknown>): ItemInfer {
	if (item.id) return "update";
	// If code is present but we lack the mandatory create fields → update
	if (item.code && !item.phase && !item.title && !item.description) return "update";
	return "create";
}

/**
 * Builds a stable, human-readable label for one `tasks[]` item so a bulk
 * rejection can name WHICH item failed (FIX-027). Preference order:
 *
 *   1. the item's own `code`/`task_code` (`[TASK-431]`), then
 *   2. its `id` (`[id 00000000-…]`), then
 *   3. a positional fallback (`#2`).
 *
 * The label is intentionally short and stable so the same rejection is
 * greppable across logs; it never includes the whole payload.
 */
export function describeBulkItem(item: Record<string, unknown>, index: number): string {
	const code = (item.code as string | undefined) || (item.task_code as string | undefined);
	if (code) return `[${code}]`;
	const id = item.id as string | undefined;
	if (id) return `[id ${id}]`;
	return `#${index}`;
}
