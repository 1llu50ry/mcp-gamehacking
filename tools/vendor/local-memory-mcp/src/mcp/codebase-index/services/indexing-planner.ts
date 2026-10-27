/**
 * indexing-planner — FilePlan generation and batch planning.
 *
 * Extracted from indexing-repository.ts COMPARE section.
 * Transforms discovered files into actionable plans (parse vs skip),
 * detects renames, and computes stale paths.
 *
 * Incremental behavior: discovered files whose mtime is well before their
 * last_indexed_at are content-unchanged, so they are planned as "skip"
 * WITHOUT ever being read or parsed. The comparison applies a conservative
 * margin (MTIME_AMBIGUITY_MARGIN_MS) so files whose mtime is ambiguous —
 * inside the filesystem timestamp granularity window of the last index —
 * fall through to readFile + checksum confirmation instead of being
 * skipped. Files touched without a content change (e.g. git checkout) pass
 * the mtime filter and are later confirmed unchanged by checksum.
 */

import type { CodebaseFile } from "../../types";
import type { DiscoveredFile } from "../types";
import { FilePlan } from "./indexing-cache";

// Filesystem mtime granularity is coarser than the ms-precision
// last_indexed_at on many platforms (ext3 = 1s, FAT = 2s, tmpfs ≈ ms,
// NFS ≈ ms). A file modified shortly after the last index can therefore
// report an mtime ≤ last_indexed_at even though its content changed;
// comparing raw values would false-skip it and leave stale symbols.
// Only skip when the mtime is MORE than this margin behind last_indexed_at.
// 2000ms covers the coarsest common granularity (FAT = 2s) plus small clock
// skew between the stat clock and the DB write clock. Ambiguous mtimes
// (inside the window) fall through to readFile + checksum confirmation, so
// correctness never depends on filesystem timestamp precision. Steady state
// is unaffected: unchanged files have mtimes well before last_indexed_at and
// are still skipped without a read.
const MTIME_AMBIGUITY_MARGIN_MS = 2000;

// ── Index plan result ────────────────────────────────────────────────────

export interface IndexPlan {
	plans: FilePlan[];
	fileMap: Map<string, DiscoveredFile>;
	existingMap: Map<string, { checksum: string | null; lastIndexedAtMs: number | null }>;
	checksumToOldPaths: Map<string, string[]>;
	renameMap: Map<string, string>; // new path → old path
	stalePaths: Set<string>;
	totalFiles: number;
	staleCount: number;
}

// ── Plan builder ─────────────────────────────────────────────────────────

/**
 * Build an index plan from discovered and existing files.
 *
 * Categorizes each discovered file as "parse" (new, mtime-changed, or
 * checksum-unverifiable), "skip" (mtime proves content unchanged — no read
 * needed), detects renames via checksum matching, and identifies stale files
 * that no longer exist on disk.
 */
export function createIndexPlan(
	discoveredFiles: DiscoveredFile[],
	existingFiles: CodebaseFile[],
	options: { force?: boolean }
): IndexPlan {
	const fileMap = new Map<string, DiscoveredFile>();
	const existingMap = new Map<string, { checksum: string | null; lastIndexedAtMs: number | null }>();
	for (const f of existingFiles) {
		existingMap.set(f.file_path, {
			checksum: f.checksum,
			lastIndexedAtMs: f.last_indexed_at ? new Date(f.last_indexed_at).getTime() : null
		});
	}

	// Build a map for rename detection: checksum → list of old file paths
	const checksumToOldPaths = new Map<string, string[]>();
	for (const f of existingFiles) {
		if (f.checksum) {
			const bucket = checksumToOldPaths.get(f.checksum) ?? [];
			bucket.push(f.file_path);
			checksumToOldPaths.set(f.checksum, bucket);
		}
	}

	const plans: FilePlan[] = [];
	const discoveredPaths = new Set<string>();
	const renameMap = new Map<string, string>(); // new path → old path

	for (const df of discoveredFiles) {
		discoveredPaths.add(df.path);
		fileMap.set(df.path, df);

		if (options.force) {
			plans.push({
				action: "parse",
				...df,
				filePath: df.path
			});
			continue;
		}

		const existing = existingMap.get(df.path);
		if (!existing) {
			// New file — could be genuinely new or a rename; needs checksum
			plans.push({
				action: "parse",
				...df,
				filePath: df.path
			});
			continue;
		}

		// Mtime pre-filter (free — fast-glob already returned stats):
		// a file whose mtime is MORE than the granularity margin behind its
		// last_indexed_at was not modified since it was last indexed ⇒
		// content unchanged ⇒ same checksum, so skip readFile + checksum
		// entirely. Ambiguous mtimes (within MTIME_AMBIGUITY_MARGIN_MS of
		// last_indexed_at) are NOT skipped here — they fall through to
		// readFile + checksum confirmation, which re-parses genuinely
		// modified files and checksum-skips touch-only files.
		if (
			existing.checksum !== null &&
			existing.lastIndexedAtMs !== null &&
			df.mtimeMs + MTIME_AMBIGUITY_MARGIN_MS <= existing.lastIndexedAtMs
		) {
			plans.push({ action: "skip", filePath: df.path });
			continue;
		}

		// Exists in DB, but mtime is newer than last index (or checksum/
		// timestamp unavailable) — needs read + checksum comparison below
		plans.push({
			action: "parse",
			...df,
			filePath: df.path
		});
	}

	const totalFiles = discoveredFiles.length;

	// Compute set of stale file paths (deleted from disk)
	const stalePaths = new Set<string>();
	for (const existing of existingFiles) {
		if (!discoveredPaths.has(existing.file_path)) {
			stalePaths.add(existing.file_path);
		}
	}
	const staleCount = stalePaths.size;

	return {
		plans,
		fileMap,
		existingMap,
		checksumToOldPaths,
		renameMap,
		stalePaths,
		totalFiles,
		staleCount
	};
}
