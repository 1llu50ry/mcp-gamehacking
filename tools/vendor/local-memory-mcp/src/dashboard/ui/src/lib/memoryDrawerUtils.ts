import type { Memory } from "./stores";

/** Meta fields shown in view mode */
export interface MetaField {
	label: string;
	val: string | number;
}

/** Build meta grid data from a memory */
export function buildMetaFields(memory: Memory): MetaField[] {
	return [
		{ label: "Importance", val: memory.importance },
		{ label: "Hit Count", val: memory.hit_count ?? 0 },
		{ label: "Created", val: memory.created_at },
		{ label: "Updated", val: memory.updated_at }
	];
}

/** Check if memory has metadata to display */
export function hasMetadata(memory: Memory): boolean {
	return !!(memory.metadata && Object.keys(memory.metadata).length > 0);
}

/** Format metadata as pretty JSON string */
export function formatMetadata(memory: Memory): string {
	return JSON.stringify(memory.metadata, null, 2);
}
