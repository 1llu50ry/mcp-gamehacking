export interface PageParams {
	page?: string;
	limit?: string;
}

export interface SortParams {
	sortBy?: string;
	sortOrder?: string;
}

export interface SearchParams {
	search?: string;
}

export type Params<T extends string = string> = {
	[K in T]: string;
};

export type ListQuery<T extends string = string> = {
	repo?: string;
	status?: string;
} & Partial<PageParams> &
	Partial<SortParams> &
	Partial<SearchParams> & {
		[K in T]?: string;
	};

export interface IdParams {
	id: string;
}

export interface NameParams {
	name: string;
}

export type TaskListQuery = ListQuery;
export interface MemoryListQuery extends ListQuery<"type" | "minImportance" | "maxImportance"> {
	type?: string;
	minImportance?: string;
	maxImportance?: string;
}
