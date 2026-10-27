// ─── API helpers (internal) ─────────────────────────────────────────────────

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
	const res = await fetch(url, options);
	if (!res.ok) {
		const err: { error?: string; errors?: Array<{ detail?: string }> } = await res
			.json()
			.catch(() => ({ error: res.statusText }));
		throw new Error(err.error || err.errors?.[0]?.detail || `HTTP ${res.status}`);
	}
	const body = await res.json();
	return deserialize(body) as T;
}

interface JsonApiItem {
	id: string;
	type: string;
	attributes?: Record<string, unknown>;
}

interface JsonApiBody {
	data: JsonApiItem | JsonApiItem[];
	meta?: Record<string, unknown>;
}

function deserialize(body: JsonApiBody | unknown): unknown {
	if (!body || typeof body !== "object" || !("data" in body)) return body;
	const { data, meta } = body as JsonApiBody;

	const processItem = (item: JsonApiItem) => {
		const attr = (item.attributes || {}) as Record<string, unknown>;
		// Inject success for status responses
		if (item.type === "status" && attr.success === undefined) {
			attr.success = true;
		}
		// Return flat object (preserving ID except for generic 'system' IDs)
		if (item.id === "system") return attr;
		return { id: item.id, ...attr };
	};

	if (Array.isArray(data)) {
		const items = data.map(processItem);
		const result: Record<string, unknown> = {};
		if (meta) result.pagination = meta;

		const firstType = data[0]?.type;
		// Map JSON:API types to legacy field names
		if (firstType === "repository") return { repos: items };
		if (firstType === "recent-action") return { ...result, actions: items };
		if (firstType === "memory") return { ...result, memories: items };
		if (firstType === "task") return { ...result, tasks: items };
		if (firstType === "queue-job") return { ...result, jobs: items };

		const rootKey = firstType ? `${firstType}s` : "data";
		result[rootKey] = items;
		return result;
	}

	// Handle capability type - wrap each nested item with {data} for UI compatibility
	if ((data as JsonApiItem).type === "capability") {
		const attr = (data as JsonApiItem).attributes as Record<string, unknown>;
		const wrapWithData = (arr: unknown[]) =>
			(arr as Array<JsonApiItem>).map((item) => ({
				data: { id: item.id, ...(item.attributes || {}) }
			}));
		return {
			tools: wrapWithData((attr.tools as unknown[]) || []),
			prompts: wrapWithData((attr.prompts as unknown[]) || []),
			resources: wrapWithData((attr.resources as unknown[]) || [])
		};
	}

	const processed = processItem(data as JsonApiItem);
	return meta ? { ...processed, pagination: meta } : processed;
}
