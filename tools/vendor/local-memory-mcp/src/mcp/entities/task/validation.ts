// Type guard for SQLite error objects that have a `code` property
export function isSqliteError(err: unknown): err is { code: string; message: string } {
	return err instanceof Error && typeof (err as unknown as Record<string, unknown>).code === "string";
}

export function handleDuplicateTaskCode(err: unknown, taskCode: string, repo: string): never {
	if (isSqliteError(err) && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
		throw new Error(
			`Duplicate task_code: '${taskCode}' already exists in repository '${repo}'. The task_code must be unique within the repository. Omit task_code to auto-generate a new unique code.`
		);
	}
	// For any other SQLITE_CONSTRAINT (FK, PK) or non-SQLite errors, re-throw
	throw err;
}
