import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTestStore, SQLiteStore } from "../../storage/sqlite.js";
import type { VectorStore } from "../../types.js";
import type { CodebaseSymbolInsert } from "../../types/codebase-symbol.js";
import type { CodebaseFileInsert } from "../../types/codebase-file.js";
import type { McpResponse } from "../../utils/mcp-response.js";

/** Repo used by all search/file/architecture/trace mode fixtures (was REPO const in the original suite). */
export const REPO = "search-test";

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

function copyDirSync(src: string, dest: string): void {
	fs.mkdirSync(dest, { recursive: true });
	const entries = fs.readdirSync(src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDirSync(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

export function data(resp: McpResponse): Record<string, unknown> {
	return resp.structuredContent as Record<string, unknown>;
}

export interface IntegrationFixture {
	store: SQLiteStore;
	vectors: VectorStore;
	tempDir: string;
}

/**
 * Seed the shared fixture used by every handleCodebaseRead mode suite:
 * temp dir with copied fixture files, in-memory store with file + symbol
 * records for REPO ("search-test"). Extracted verbatim from the original
 * outer describe beforeAll of mcp-tools.integration.test.ts (d1 setup).
 */
export async function setupIntegrationFixture(): Promise<IntegrationFixture> {
	// ── 1. Create temp directory with fixture files ────────────────────
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-tools-int-"));

	const fixtureSrc = path.resolve(import.meta.dirname, "../fixtures/codebase-index/search-test-fixture");
	const destDir = path.join(tempDir, "search-test-fixture");
	copyDirSync(fixtureSrc, destDir);

	// ── 2. Initialize store ────────────────────────────────────────────
	const store = await createTestStore();
	const vectors = noopVectorStore();

	// ── 3. Insert file records ─────────────────────────────────────────
	const fileInserts: CodebaseFileInsert[] = [
		{ repo: REPO, file_path: "index.ts", language: "typescript", lines: 41, size_bytes: 900 },
		{ repo: REPO, file_path: "utils.ts", language: "typescript", lines: 38, size_bytes: 750 },
		{ repo: REPO, file_path: "types.ts", language: "typescript", lines: 45, size_bytes: 600 },
		{
			repo: REPO,
			file_path: "components/Button.tsx",
			language: "tsx",
			lines: 30,
			size_bytes: 700
		}
	];
	for (const f of fileInserts) {
		store.codebaseFiles.upsertFile(f);
	}

	// ── 4. Insert symbol records ───────────────────────────────────────
	const symbols: CodebaseSymbolInsert[] = [
		// index.ts
		{
			repo: REPO,
			file_path: "index.ts",
			name: "AppConfig",
			kind: "interface",
			exported: true,
			default_export: false,
			start_line: 6,
			start_col: 1,
			end_line: 11,
			end_col: 1,
			signature: "interface AppConfig",
			doc_comment: "Configuration for the application.",
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "index.ts",
			name: "initializeApp",
			kind: "function",
			exported: true,
			default_export: false,
			start_line: 13,
			start_col: 1,
			end_line: 15,
			end_col: 1,
			signature: "function initializeApp(config: AppConfig): string",
			doc_comment: "Initialize the application with the given config.",
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "index.ts",
			name: "Application",
			kind: "class",
			exported: true,
			default_export: false,
			start_line: 17,
			start_col: 1,
			end_line: 33,
			end_col: 1,
			signature: "class Application",
			doc_comment: "Main application class. Wraps start, getVersion, and isDebug utilities.",
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "index.ts",
			name: "DEFAULT_CONFIG",
			kind: "variable",
			exported: true,
			default_export: false,
			start_line: 35,
			start_col: 1,
			end_line: 40,
			end_col: 2,
			signature: "const DEFAULT_CONFIG: AppConfig",
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "index.ts",
			name: "createAppRunner",
			kind: "function",
			exported: true,
			default_export: false,
			start_line: 42,
			start_col: 1,
			end_line: 44,
			end_col: 1,
			signature: "function createAppRunner(config: AppConfig): () => string",
			doc_comment: null,
			parent_symbol_id: null
		},

		// utils.ts
		{
			repo: REPO,
			file_path: "utils.ts",
			name: "formatSize",
			kind: "function",
			exported: true,
			default_export: false,
			start_line: 5,
			start_col: 1,
			end_line: 9,
			end_col: 1,
			signature: "function formatSize(bytes: number): string",
			doc_comment: "Format byte count into a human-readable string.",
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "utils.ts",
			name: "slugify",
			kind: "function",
			exported: true,
			default_export: false,
			start_line: 11,
			start_col: 1,
			end_line: 15,
			end_col: 1,
			signature: "function slugify(text: string): string",
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "utils.ts",
			name: "clamp",
			kind: "function",
			exported: true,
			default_export: false,
			start_line: 17,
			start_col: 1,
			end_line: 19,
			end_col: 1,
			signature: "function clamp(value: number, min: number, max: number): number",
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "utils.ts",
			name: "Result",
			kind: "type",
			exported: true,
			default_export: false,
			start_line: 21,
			start_col: 1,
			end_line: 23,
			end_col: 2,
			signature: "type Result<T> = { ok: true; value: T } | { ok: false; error: string }",
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "utils.ts",
			name: "safeParseJSON",
			kind: "function",
			exported: true,
			default_export: false,
			start_line: 25,
			start_col: 1,
			end_line: 31,
			end_col: 1,
			signature: "function safeParseJSON<T>(json: string): Result<T>",
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "utils.ts",
			name: "delay",
			kind: "function",
			exported: true,
			default_export: false,
			start_line: 33,
			start_col: 1,
			end_line: 35,
			end_col: 1,
			signature: "function delay(ms: number): Promise<void>",
			doc_comment: null,
			parent_symbol_id: null
		},

		// types.ts
		{
			repo: REPO,
			file_path: "types.ts",
			name: "User",
			kind: "interface",
			exported: true,
			default_export: false,
			start_line: 5,
			start_col: 1,
			end_line: 11,
			end_col: 1,
			signature: "interface User",
			doc_comment: "User entity with role-based access.",
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "types.ts",
			name: "UserRole",
			kind: "type",
			exported: true,
			default_export: false,
			start_line: 13,
			start_col: 1,
			end_line: 13,
			end_col: 47,
			signature: "type UserRole",
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "types.ts",
			name: "SearchResult",
			kind: "interface",
			exported: true,
			default_export: false,
			start_line: 15,
			start_col: 1,
			end_line: 21,
			end_col: 1,
			signature: "interface SearchResult<T>",
			doc_comment: "Generic search result wrapper.",
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "types.ts",
			name: "PaginationParams",
			kind: "interface",
			exported: true,
			default_export: false,
			start_line: 23,
			start_col: 1,
			end_line: 28,
			end_col: 1,
			signature: "interface PaginationParams",
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "types.ts",
			name: "SearchQuery",
			kind: "type",
			exported: true,
			default_export: false,
			start_line: 30,
			start_col: 1,
			end_line: 34,
			end_col: 2,
			signature: "type SearchQuery",
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "types.ts",
			name: "Status",
			kind: "enum",
			exported: true,
			default_export: false,
			start_line: 36,
			start_col: 1,
			end_line: 40,
			end_col: 1,
			signature: "enum Status",
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "types.ts",
			name: "AuditEntry",
			kind: "interface",
			exported: true,
			default_export: false,
			start_line: 42,
			start_col: 1,
			end_line: 48,
			end_col: 1,
			signature: "interface AuditEntry",
			doc_comment: null,
			parent_symbol_id: null
		},

		// components/Button.tsx
		{
			repo: REPO,
			file_path: "components/Button.tsx",
			name: "ButtonProps",
			kind: "interface",
			exported: true,
			default_export: false,
			start_line: 3,
			start_col: 1,
			end_line: 8,
			end_col: 1,
			signature: "interface ButtonProps",
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "components/Button.tsx",
			name: "Button",
			kind: "function",
			exported: true,
			default_export: false,
			start_line: 10,
			start_col: 1,
			end_line: 27,
			end_col: 1,
			signature: "function Button({ label, variant, disabled, onClick }: ButtonProps)",
			doc_comment: "A reusable button component with SubmitButton and DangerButton variants.",
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "components/Button.tsx",
			name: "SubmitButton",
			kind: "function",
			exported: true,
			default_export: false,
			start_line: 29,
			start_col: 1,
			end_line: 31,
			end_col: 1,
			signature: "function SubmitButton({ onClick }: { onClick: () => void })",
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			repo: REPO,
			file_path: "components/Button.tsx",
			name: "DangerButton",
			kind: "function",
			exported: true,
			default_export: false,
			start_line: 33,
			start_col: 1,
			end_line: 35,
			end_col: 1,
			signature: "function DangerButton({ label, onClick }: { label: string; onClick: () => void })",
			doc_comment: null,
			parent_symbol_id: null
		}
	];

	store.codebaseSymbols.bulkUpsertSymbols(symbols);
	return { store, vectors, tempDir };
}
