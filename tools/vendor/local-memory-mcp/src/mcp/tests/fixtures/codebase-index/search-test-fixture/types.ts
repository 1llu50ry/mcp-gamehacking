/**
 * Domain types and interfaces for the search test fixture.
 */

export interface User {
	id: string;
	name: string;
	email: string;
	role: UserRole;
}

export type UserRole = "admin" | "editor" | "viewer";

export interface SearchResult<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
}

export interface PaginationParams {
	page: number;
	pageSize: number;
	sortBy?: string;
	sortOrder?: "asc" | "desc";
}

export type SearchQuery = {
	text: string;
	filters?: Record<string, string>;
	pagination?: PaginationParams;
};

export enum Status {
	Active = "active",
	Inactive = "inactive",
	Archived = "archived"
}

export interface AuditEntry {
	timestamp: string;
	userId: string;
	action: string;
	status: Status;
}
