/**
 * semantic/registry — language-based adapter selection + per-adapter isolation
 * (issue #90, TASK-016).
 *
 * A `SemanticAdapterRegistry` holds the set of independently-loadable adapters and
 * selects one by language. `runAdapterWithIsolation` wraps a single adapter's
 * `enrich` call in a wall-clock timeout + try/catch so a slow or throwing adapter
 * resolves to a `degraded` result instead of failing repo indexing.
 *
 * The pipeline composes these: select by language → isolate → attach enrichment.
 */

import path from "node:path";
import { logger } from "../../utils/logger";
import type { ParsedSymbol } from "../parser/language-visitor";
import type {
	SemanticAdapter,
	SemanticEnrichmentInput,
	SemanticEnrichmentResult,
	SemanticSymbolEnrichment
} from "./adapter";
import { typescriptSemanticAdapter } from "./typescript-enricher";
import { phpstanSemanticAdapter } from "./phpstan-adapter";

/**
 * Registry of built-in semantic adapters, selectable by language. Adapters are
 * registered in priority order; `select` returns the LAST adapter that supports
 * the language, so later registrations act as overrides (a more specific
 * adapter registered later wins over an earlier general one).
 */
export class SemanticAdapterRegistry {
	private readonly adapters: SemanticAdapter[] = [];

	/** Register an adapter. Returns `this` for chaining. */
	register(adapter: SemanticAdapter): this {
		this.adapters.push(adapter);
		return this;
	}

	/** All registered adapters (read-only snapshot). */
	list(): readonly SemanticAdapter[] {
		return this.adapters;
	}

	/**
	 * Select the last adapter (registration order) that supports the language —
	 * later registrations override earlier ones. A throwing `supports()` is
	 * treated as "not supported" so a broken adapter can never break selection.
	 */
	select(language: string, repoPath: string): SemanticAdapter | null {
		let selected: SemanticAdapter | null = null;
		for (const adapter of this.adapters) {
			try {
				if (adapter.supports(language, repoPath)) selected = adapter;
			} catch (err) {
				logger.debug("[SemanticRegistry] adapter.supports threw — skipping", {
					provider: adapter.name,
					error: err instanceof Error ? err.message : String(err)
				});
			}
		}
		return selected;
	}
}

let defaultRegistry: SemanticAdapterRegistry | null = null;

/**
 * The registry of built-in adapters, lazily constructed once per process. Add new
 * language adapters here (or via `register`) — they are independently loadable and
 * each is isolated at call time.
 */
export function getDefaultSemanticRegistry(): SemanticAdapterRegistry {
	if (!defaultRegistry) {
		defaultRegistry = new SemanticAdapterRegistry()
			.register(typescriptSemanticAdapter)
			.register(phpstanSemanticAdapter);
	}
	return defaultRegistry;
}

/** Reset the cached default registry (test helper). */
export function resetDefaultSemanticRegistry(): void {
	defaultRegistry = null;
}

/**
 * Run one adapter's `enrich` behind a wall-clock timeout + try/catch. Mirrors the
 * #89 timeout pattern: a `setTimeout` race resolves to a `degraded` result on
 * timeout, and any throw resolves to `degraded` — the caller skips persistence
 * without failing structural indexing. The underlying work is abandoned (GC'd).
 */
export function runAdapterWithIsolation(
	adapter: SemanticAdapter,
	input: SemanticEnrichmentInput,
	timeoutMs: number
): Promise<SemanticEnrichmentResult> {
	return new Promise<SemanticEnrichmentResult>((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				logger.debug("[SemanticRegistry] adapter timed out — degraded", {
					provider: adapter.name,
					timeoutMs
				});
				resolve({
					bySymbolKey: new Map(),
					source: adapter.name,
					provider: adapter.name,
					degraded: true,
					reason: `timeout after ${timeoutMs}ms`
				});
			}
		}, timeoutMs);

		Promise.resolve()
			.then(() => adapter.enrich(input))
			.then((result) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					resolve(result);
				}
			})
			.catch((err) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					logger.debug("[SemanticRegistry] adapter threw — degraded", {
						provider: adapter.name,
						error: err instanceof Error ? err.message : String(err)
					});
					resolve({
						bySymbolKey: new Map(),
						source: adapter.name,
						provider: adapter.name,
						degraded: true,
						reason: err instanceof Error ? err.message : String(err)
					});
				}
			});
	});
}

/**
 * High-level helper used by the parse pipeline: select by language, run isolated,
 * and return the enrichment map (or `null` when no adapter applies / the pass
 * degraded). NEVER throws.
 *
 * @param symbols Structural symbols (NEVER mutated).
 * @param repoPath Absolute repo root (used for monorepo resolution by adapters).
 */
export async function enrichSymbolsSemantic(
	registry: SemanticAdapterRegistry,
	language: string,
	filePath: string,
	repoPath: string,
	content: string,
	symbols: ParsedSymbol[],
	timeoutMs: number
): Promise<Map<string, SemanticSymbolEnrichment> | null> {
	try {
		const adapter = registry.select(language, repoPath);
		if (!adapter) return null; // no-adapter fallback — structural indexing unchanged
		const result = await runAdapterWithIsolation(
			adapter,
			{ filePath, repoPath, language, content, symbols },
			timeoutMs
		);
		if (result.degraded) return null;
		return result.bySymbolKey;
	} catch (err) {
		logger.debug("[SemanticRegistry] enrichment degraded (structural indexing unaffected)", {
			filePath,
			error: err instanceof Error ? err.message : String(err)
		});
		return null;
	}
}

/** Convenience: derive the repo root from an absolute file path + repo-relative path. */
export function repoPathFromAbsolute(absolutePath: string, repoRelativePath: string): string {
	const normalized = absolutePath.replace(/\\/g, "/");
	const rel = repoRelativePath.replace(/\\/g, "/");
	if (rel && normalized.endsWith(`/${rel}`)) {
		return path.resolve(absolutePath.slice(0, absolutePath.length - repoRelativePath.length));
	}
	return path.dirname(absolutePath);
}
