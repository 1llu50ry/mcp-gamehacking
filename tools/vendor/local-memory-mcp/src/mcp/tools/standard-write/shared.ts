/**
 * standard-write/shared — shared types and helpers.
 */

import { SQLiteStore } from "../../storage/sqlite";
import { resolveEntityRef } from "../../utils/entity-ref";
import { toContextSlug, buildStandardVectorText } from "../standard.shared";
import { generateNextCode } from "../../utils/code-generator";
import { saveExtractions, saveStandardRelations } from "../kg-archivist";

// ── Shared types ─────────────────────────────────────────────────────────

export type StandardWriteParams = {
	// Common
	owner?: string;
	repo?: string;
	json: boolean;

	// Create fields
	name?: string;
	content?: string;
	parent_id?: string;
	context?: string;
	version?: string;
	language?: string;
	stack?: string[];
	is_global?: boolean;
	tags?: string[];
	metadata?: Record<string, unknown>;
	agent?: string;
	model?: string;

	// Update fields
	id?: string;
	code?: string;

	// Bulk
	standards?: Record<string, unknown>[];
};

export type BulkResult = {
	index: number;
	operation: "create" | "update";
	success: boolean;
	id?: string;
	code?: string;
	title?: string;
	error?: string;
};

// ── Shared helpers ───────────────────────────────────────────────────────

export function resolveStandardParentId(
	value: string | null | undefined,
	db: SQLiteStore,
	owner?: string,
	repo?: string
): string | null {
	return resolveEntityRef(db, "standard", value, owner, repo);
}

export { toContextSlug, buildStandardVectorText, generateNextCode, saveExtractions, saveStandardRelations };
