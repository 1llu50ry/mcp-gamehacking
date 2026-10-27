export function encodeCursor(offset: number) {
	return Buffer.from(String(offset), "utf8").toString("base64");
}

export function decodeCursor(cursor: unknown) {
	if (cursor === undefined || cursor === null || cursor === "") {
		return 0;
	}

	if (typeof cursor !== "string" || cursor.trim() === "") {
		throw invalidPaginationParams("Invalid cursor");
	}

	let decoded: string;
	try {
		decoded = Buffer.from(cursor, "base64").toString("utf8");
	} catch {
		throw invalidPaginationParams("Invalid cursor");
	}

	if (!/^\d+$/.test(decoded)) {
		throw invalidPaginationParams("Invalid cursor");
	}

	const offset = Number.parseInt(decoded, 10);
	if (!Number.isFinite(offset) || offset < 0) {
		throw invalidPaginationParams("Invalid cursor");
	}

	return offset;
}

export function invalidPaginationParams(message: string) {
	const error = new Error(message) as Error & { code: number };
	error.code = -32602;
	return error;
}
