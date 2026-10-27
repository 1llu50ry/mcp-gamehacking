/**
 * Unit tests for src/dashboard/lib/jsonApi.ts — the shared JSON:API response
 * envelope, list pagination normalization, and the handleController request
 * lifecycle (db.refresh → handler → response; HttpError/ServiceError → JSON:API
 * error body or custom onError responder).
 *
 * Pure unit: the context module (which jsonApi imports for `db`) is vi.mock'd
 * with a stub `refresh`, so no real store is created. req/res are minimal
 * typed fakes — handleController only touches `status`/`json`/`end`/`headersSent`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import {
	getAttributes,
	handleController,
	HttpError,
	jsonApiError,
	jsonApiRes,
	parsePageParams,
	ServiceError
} from "../../lib/jsonApi";

const mocks = vi.hoisted(() => ({
	db: { refresh: vi.fn().mockResolvedValue(undefined) }
}));

vi.mock("../../lib/context", () => ({
	db: mocks.db
}));

type MockedFn = ReturnType<typeof vi.fn>;

interface MockRes {
	status: MockedFn;
	json: MockedFn;
	end: MockedFn;
	headersSent: boolean;
}

function makeRes(overrides: Partial<MockRes> = {}): MockRes {
	return {
		status: vi.fn().mockReturnThis(),
		json: vi.fn(),
		end: vi.fn(),
		headersSent: false,
		...overrides
	};
}

function makeReq(body?: unknown, query: Record<string, unknown> = {}): express.Request {
	return { body, query } as unknown as express.Request;
}

function asRes(res: MockRes): express.Response {
	return res as unknown as express.Response;
}

describe("HttpError", () => {
	it("carries status, code and extra payload", () => {
		const err = new HttpError(418, "teapot", "TEAPOT", { key: "value" });
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(HttpError);
		expect(err.name).toBe("HttpError");
		expect(err.status).toBe(418);
		expect(err.code).toBe("TEAPOT");
		expect(err.extra).toEqual({ key: "value" });
	});

	it("defaults code and extra when omitted", () => {
		const err = new HttpError(404, "missing");
		expect(err.status).toBe(404);
		expect(err.code).toBeUndefined();
		expect(err.extra).toBeUndefined();
	});
});

describe("ServiceError", () => {
	it("carries status and code", () => {
		const err = new ServiceError(422, "all failed", "ALL_FAILED");
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(ServiceError);
		expect(err.name).toBe("ServiceError");
		expect(err.status).toBe(422);
		expect(err.code).toBe("ALL_FAILED");
	});

	it("defaults code when omitted", () => {
		const err = new ServiceError(400, "bad request");
		expect(err.code).toBeUndefined();
	});
});

describe("parsePageParams", () => {
	it("applies defaults for an empty query", () => {
		expect(parsePageParams({})).toEqual({ page: 1, pageSize: 20, offset: 0 });
	});

	it("parses page and pageSize and computes the offset", () => {
		expect(parsePageParams({ page: "3", pageSize: "10" })).toEqual({ page: 3, pageSize: 10, offset: 20 });
	});

	it("accepts numeric (non-string) query values", () => {
		expect(parsePageParams({ page: 2, pageSize: 5 })).toEqual({ page: 2, pageSize: 5, offset: 5 });
	});

	it("clamps pageSize to maxPageSize (default 100)", () => {
		expect(parsePageParams({ pageSize: "500" })).toEqual({ page: 1, pageSize: 100, offset: 0 });
	});

	it("clamps pageSize to a minimum of 1", () => {
		expect(parsePageParams({ pageSize: "0" })).toEqual({ page: 1, pageSize: 1, offset: 0 });
		expect(parsePageParams({ pageSize: "-5" })).toEqual({ page: 1, pageSize: 1, offset: 0 });
	});

	it("falls back to defaultPageSize for garbage pageSize", () => {
		expect(parsePageParams({ pageSize: "abc" }).pageSize).toBe(20);
		expect(parsePageParams({ pageSize: "" }).pageSize).toBe(20);
	});

	it("falls back to page 1 for missing/garbage/zero/negative page", () => {
		expect(parsePageParams({ page: "" }).page).toBe(1);
		expect(parsePageParams({ page: "abc" }).page).toBe(1);
		expect(parsePageParams({ page: "0" }).page).toBe(1);
		expect(parsePageParams({ page: "-2" }).page).toBe(1);
	});

	it("honors custom defaultPageSize and maxPageSize options", () => {
		const opts = { defaultPageSize: 50, maxPageSize: 5 };
		// maxPageSize clamps even the fallback default (both bounds apply).
		expect(parsePageParams({}, opts).pageSize).toBe(5);
		expect(parsePageParams({ pageSize: "10" }, opts).pageSize).toBe(5);
		expect(parsePageParams({}, { defaultPageSize: 50 }).pageSize).toBe(50);
	});
});

describe("jsonApiRes", () => {
	it("wraps a single object with type and extracted id", () => {
		const result = jsonApiRes({ id: "m-1", title: "hello", importance: 3 }, "memory");
		expect(result).toEqual({
			jsonapi: { version: "1.1" },
			data: { type: "memory", id: "m-1", attributes: { title: "hello", importance: 3 } }
		});
	});

	it("falls back to the system id when neither id nor attributes.id is present", () => {
		const result = jsonApiRes({ title: "no id" }, "memory");
		expect(result.data).toEqual({ type: "memory", id: "system", attributes: { title: "no id" } });
	});

	it("maps every item of an array to a typed resource", () => {
		const result = jsonApiRes(
			[
				{ id: "a", name: "one" },
				{ id: "b", name: "two" }
			],
			"standard"
		);
		expect(result.data).toEqual([
			{ type: "standard", id: "a", attributes: { name: "one" } },
			{ type: "standard", id: "b", attributes: { name: "two" } }
		]);
	});

	it("stringifies non-string ids", () => {
		const result = jsonApiRes({ id: 42, name: "numeric" }, "memory");
		expect(result.data).toEqual({ type: "memory", id: "42", attributes: { name: "numeric" } });
	});

	it("spreads extra meta/links into the envelope", () => {
		const result = jsonApiRes([], "memory", { meta: { total: 0 }, links: { self: "/api/memories" } });
		expect(result).toEqual({
			jsonapi: { version: "1.1" },
			data: [],
			meta: { total: 0 },
			links: { self: "/api/memories" }
		});
	});

	it("does not mutate the input item and returns a fresh shallow-copied attributes layer", () => {
		const item = { id: "m-1", nested: { deep: true } };
		const result = jsonApiRes(item, "memory");
		const data = result.data as { attributes: Record<string, unknown> };
		// Spread is shallow: the attributes object is new, nested refs are shared.
		expect(data.attributes).not.toBe(item);
		expect(data.attributes.nested).toBe(item.nested);
		expect(item).toEqual({ id: "m-1", nested: { deep: true } });
	});
});

describe("jsonApiError", () => {
	it("defaults to status 500", () => {
		expect(jsonApiError("boom")).toEqual({
			jsonapi: { version: "1.1" },
			errors: [{ status: "500", detail: "boom" }]
		});
	});

	it("stringifies a custom status", () => {
		expect(jsonApiError("bad", 400)).toEqual({
			jsonapi: { version: "1.1" },
			errors: [{ status: "400", detail: "bad" }]
		});
	});
});

describe("getAttributes", () => {
	it("returns data.attributes when present", () => {
		const req = makeReq({ data: { type: "memory", attributes: { title: "t" } } });
		expect(getAttributes(req)).toEqual({ title: "t" });
	});

	it("falls back to the whole body when data.attributes is absent", () => {
		const req = makeReq({ title: "t", importance: 3 });
		expect(getAttributes(req)).toEqual({ title: "t", importance: 3 });
	});

	it("falls back to the whole body when data is absent", () => {
		const req = makeReq({ title: "t" });
		expect(getAttributes(req)).toEqual({ title: "t" });
	});

	it("falls back to the body when attributes is falsy", () => {
		const req = makeReq({ data: { attributes: "" } });
		expect(getAttributes(req)).toEqual({ data: { attributes: "" } });
	});
});

describe("handleController", () => {
	beforeEach(() => {
		mocks.db.refresh.mockClear();
	});

	it("refreshes the db and sends the handler body as JSON 200", async () => {
		const res = makeRes();
		await handleController(makeReq(), asRes(res), () => ({ hello: 1 }));
		expect(mocks.db.refresh).toHaveBeenCalledTimes(1);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ hello: 1 });
	});

	it("uses the configured status for the success body", async () => {
		const res = makeRes();
		await handleController(makeReq(), asRes(res), () => ({ id: 1 }), { status: 201 });
		expect(res.status).toHaveBeenCalledWith(201);
		expect(res.json).toHaveBeenCalledWith({ id: 1 });
	});

	it("skips the db refresh when refresh: false", async () => {
		const res = makeRes();
		await handleController(makeReq(), asRes(res), () => "ok", { refresh: false });
		expect(mocks.db.refresh).not.toHaveBeenCalled();
		expect(res.json).toHaveBeenCalledWith("ok");
	});

	it("respects a streaming handler that already wrote the response", async () => {
		const res = makeRes({ headersSent: true });
		await handleController(makeReq(), asRes(res), () => undefined);
		expect(res.status).not.toHaveBeenCalled();
		expect(res.json).not.toHaveBeenCalled();
	});

	it("maps a thrown HttpError to a JSON:API error body with its status", async () => {
		const res = makeRes();
		await handleController(makeReq(), asRes(res), () => {
			throw new HttpError(404, "not found", "NOT_FOUND");
		});
		expect(res.status).toHaveBeenCalledWith(404);
		expect(res.json).toHaveBeenCalledWith({
			jsonapi: { version: "1.1" },
			errors: [{ status: "404", detail: "not found" }]
		});
	});

	it("preserves the original status when a ServiceError is thrown", async () => {
		const res = makeRes();
		await handleController(makeReq(), asRes(res), () => {
			throw new ServiceError(422, "all failed", "ALL_FAILED");
		});
		expect(res.status).toHaveBeenCalledWith(422);
		expect(res.json).toHaveBeenCalledWith({
			jsonapi: { version: "1.1" },
			errors: [{ status: "422", detail: "all failed" }]
		});
	});

	it("maps a generic Error to a 500 with its message", async () => {
		const res = makeRes();
		await handleController(makeReq(), asRes(res), () => {
			throw new Error("kaboom");
		});
		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			jsonapi: { version: "1.1" },
			errors: [{ status: "500", detail: "kaboom" }]
		});
	});

	it("maps a non-Error throw to a 500 with the generic message", async () => {
		const res = makeRes();
		await handleController(makeReq(), asRes(res), () => {
			throw "string-boom";
		});
		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			jsonapi: { version: "1.1" },
			errors: [{ status: "500", detail: "Internal server error" }]
		});
	});

	it("routes errors through onError and skips the default body", async () => {
		const res = makeRes();
		const onError = vi.fn();
		await handleController(
			makeReq(),
			asRes(res),
			() => {
				throw new HttpError(403, "forbidden", "FORBIDDEN", { reason: "no access" });
			},
			{ onError }
		);
		expect(onError).toHaveBeenCalledTimes(1);
		const passed = onError.mock.calls[0][1] as HttpError;
		expect(passed).toBeInstanceOf(HttpError);
		expect(passed.status).toBe(403);
		expect(passed.code).toBe("FORBIDDEN");
		expect(passed.extra).toEqual({ reason: "no access" });
		expect(res.status).not.toHaveBeenCalled();
		expect(res.json).not.toHaveBeenCalled();
	});

	it("wraps a ServiceError into an HttpError for onError, carrying code", async () => {
		const res = makeRes();
		const onError = vi.fn();
		await handleController(
			makeReq(),
			asRes(res),
			() => {
				throw new ServiceError(409, "duplicate", "DUP");
			},
			{ onError }
		);
		const passed = onError.mock.calls[0][1] as HttpError;
		expect(passed).toBeInstanceOf(HttpError);
		expect(passed.status).toBe(409);
		expect(passed.code).toBe("DUP");
		expect(passed.message).toBe("duplicate");
	});

	it("ends the response when an error occurs after headers were sent", async () => {
		const res = makeRes({ headersSent: true });
		await handleController(makeReq(), asRes(res), () => {
			throw new HttpError(400, "bad");
		});
		expect(res.end).toHaveBeenCalledTimes(1);
		expect(res.json).not.toHaveBeenCalled();
	});
});
