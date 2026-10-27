export interface CountResult {
	count: number;
}

export interface TypeCountResult {
	type: string;
	count: number;
}

export interface StatusCountResult {
	status: string;
	count: number;
}

export interface DateCountResult {
	date: string;
	count: number;
}

export interface ActionCountResult {
	action: string;
	count: number;
}

export interface RepoResult {
	repo: string;
}

export interface MemoryIdVector {
	memory_id: string;
	/** float32 BLOB (dense embedding) or legacy JSON TEXT (sparse TF map). */
	vector: string | Uint8Array;
}

export interface LastUsedResult {
	last: string | null;
}

export interface SQLResult {
	sql?: string;
}

export interface MaxIdResult {
	id: number;
}
