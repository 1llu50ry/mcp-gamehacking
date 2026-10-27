/**
 * Stable content hash for embedding/KG dedup (OPT-FLOW-03).
 *
 * The worker embeds `payload.text` with ONNX and KG-extracts from
 * `payload.content`/`payload.title` plus the relation fields (`parentId`,
 * `decisionRefs`, `context`, `stack`). EVERY write to an entity LWW-resets its
 * `queue_jobs` row to `pending`, so a touch update that changes only metadata
 * (tags, hit_count, status) previously forced the worker to re-run ONNX
 * inference and compromise KG extraction on byte-identical content.
 *
 * This module computes a stable sha256 over exactly the fields the worker
 * consumes, so `enqueue.ts` can skip the LWW reset when the embed-relevant
 * content is unchanged:
 *
 *   - `text`   → vector input (for a memory this IS the content).
 *   - `content` → KG extraction text (falls back to `text`).
 *   - `title`  → KG observation text.
 *   - `parentId` / `decisionRefs` / `context` / `stack` → KG relations.
 *   - `codebaseRefDigest` → codebase reference-edge digest (TASK-293): the
 *     extraction content carries only a file's SYMBOLS, so a pure call-graph
 *     change must still invalidate dedup — otherwise the worker would never
 *     re-run the codebase relation writer.
 *
 * `owner`/`repo`/`updatedAt` are deliberately EXCLUDED: they are scope +
 * observability metadata, not embed/KG-relevant content, so a touch update
 * that bumps `updated_at` without touching content still dedups.
 *
 * Known trade-off of excluding `repo`: `repo` is a KG-scoping input, and
 * standard-write permits a repo mutation with an otherwise-unchanged content
 * field set. In that narrow window (repo change + no content/relation-field
 * change), dedup skips re-KG-extraction under the new repo. This is accepted
 * and NOT a regression: the pre-hash path never enqueued a repo-only change
 * either, so the entity was never re-scoped on repo-only mutation. Only a
 * content-related field change triggers re-scoping, which is the intended
 * behavior.
 *
 * Stability: optional fields are normalized to `null` (JSON.stringify omits
 * `undefined` keys, which would otherwise make `undefined` vs `null` hash
 * differently across enqueue sites); arrays are hashed as-is (not sorted) so
 * a reordering that genuinely changes the embedding/KG output is never
 * collapsed into a false-positive dedup.
 */
import { createHash } from "crypto";

/**
 * The embed/KG-relevant subset of {@link EmbeddingJobPayload}. Any payload is
 * structurally assignable to this shape (the extra `v`/`owner`/`repo`/
 * `updatedAt` fields are ignored by the hash).
 */
export interface EmbedPayloadHashFields {
	/** Text fed to the ONNX embedding model. */
	text: string;
	/** Content fed to KG extraction (falls back to `text`). */
	content?: string;
	/** Title used in KG observation text. */
	title?: string;
	/** Parent id used in KG relation extraction. */
	parentId?: string | null;
	/** Task decision refs → `inspired_by` KG relations. */
	decisionRefs?: string[];
	/** Standard context slug (KG relations). */
	context?: string;
	/** Standard stack (embed text + KG relations). */
	stack?: string[];
	/** Codebase reference-edge digest (TASK-293) — makes dedup sensitive to call-graph changes. */
	codebaseRefDigest?: string;
}

/**
 * Stable sha256-hex of the embed/KG-relevant payload fields.
 *
 * Two payloads with the same returned hash produce identical ONNX embeddings
 * AND identical KG entities/relations/observations; differing hashes mean the
 * worker must re-run at least one of them.
 */
export function embedPayloadContentHash(fields: EmbedPayloadHashFields): string {
	const canonical = {
		text: fields.text,
		content: fields.content ?? null,
		title: fields.title ?? null,
		parentId: fields.parentId ?? null,
		decisionRefs: fields.decisionRefs ?? null,
		context: fields.context ?? null,
		stack: fields.stack ?? null,
		codebaseRefDigest: fields.codebaseRefDigest ?? null
	};
	return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
