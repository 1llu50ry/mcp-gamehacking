import type { VectorEntityKind, VectorResult, VectorStore } from "../types";
import type { RuntimeCapabilityRegistry } from "../runtime-capabilities";

export class CapabilityAwareVectorStore implements VectorStore {
	constructor(
		private readonly inner: VectorStore,
		private readonly capabilities: RuntimeCapabilityRegistry
	) {}

	async initialize(): Promise<void> {
		await this.capabilities.ensure("semantic");
	}

	getInnerStore(): VectorStore {
		return this.inner;
	}

	async embed(texts: string[]): Promise<number[][]> {
		if (!(await this.capabilities.ensure("semantic"))) return [];
		const semantic = this.inner as VectorStore & { embed?: (values: string[]) => Promise<number[][]> };
		return semantic.embed ? semantic.embed(texts) : [];
	}

	async upsert(id: string, text: string, kind?: VectorEntityKind): Promise<void> {
		if (await this.capabilities.ensure("semantic")) await this.inner.upsert(id, text, kind);
	}

	async remove(id: string, kind?: VectorEntityKind): Promise<void> {
		await this.inner.remove(id, kind);
	}

	/**
	 * Release the underlying store's process-owned resources (C1, FEAT-DAEMON-002
	 * review). Delegates to the inner store's optional `close()` so a shutdown
	 * that only knows about the capability-aware wrapper still tears down the
	 * embedding worker pool. Idempotent.
	 */
	async close(): Promise<void> {
		const closable = this.inner as VectorStore & { close?: () => Promise<void> };
		if (typeof closable.close === "function") await closable.close();
	}

	async search(query: string, limit: number, repo?: string, kind?: VectorEntityKind): Promise<VectorResult[]> {
		if (!(await this.capabilities.ensure("semantic"))) return [];
		return this.inner.search(query, limit, repo, kind);
	}
}
