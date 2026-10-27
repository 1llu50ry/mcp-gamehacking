import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { buildUpdateClause } from "../../utils/sql-builder";

describe("buildUpdateClause", () => {
	it("builds fields and values for plain keys", () => {
		const { fields, values } = buildUpdateClause({ title: "hello", status: "active" });
		expect(fields).toEqual(["title = ?", "status = ?"]);
		expect(values).toEqual(["hello", "active"]);
	});

	it("skips undefined values (no-op updates)", () => {
		const { fields, values } = buildUpdateClause({ title: "x", tags: undefined, code: "C-1" });
		expect(fields).toEqual(["title = ?", "code = ?"]);
		expect(values).toEqual(["x", "C-1"]);
	});

	it("JSON-serializes array/object values for jsonKeys", () => {
		const { values } = buildUpdateClause(
			{ tags: ["a", "b"], metadata: { k: 1 } },
			{ jsonKeys: new Set(["tags", "metadata"]) }
		);
		expect(values[0]).toBe('["a","b"]');
		expect(values[1]).toBe('{"k":1}');
	});

	it("coerces intKeys booleans to 0/1", () => {
		const { values } = buildUpdateClause(
			{ is_global: true, is_archived: false, title: "x" },
			{ intKeys: new Set(["is_global", "is_archived"]) }
		);
		expect(values).toEqual([1, 0, "x"]);
	});

	it("excludes immutable keys", () => {
		const { fields, values } = buildUpdateClause(
			{ id: "abc", created_at: "2024", title: "x" },
			{ excludeKeys: new Set(["id", "created_at"]) }
		);
		expect(fields).toEqual(["title = ?"]);
		expect(values).toEqual(["x"]);
	});

	it("honors the validColumns whitelist when provided", () => {
		const { fields, values } = buildUpdateClause(
			{ title: "x", owner: "evil", status: "done" },
			{ validColumns: new Set(["title", "status"]) }
		);
		expect(fields).toEqual(["title = ?", "status = ?"]);
		expect(values).toEqual(["x", "done"]);
	});

	it("returns empty arrays for an empty updates map", () => {
		const { fields, values } = buildUpdateClause({});
		expect(fields).toEqual([]);
		expect(values).toEqual([]);
	});

	it("drops an undefined value even when the key is in jsonKeys/intKeys", () => {
		const { fields, values } = buildUpdateClause(
			{ tags: undefined, is_global: undefined },
			{ jsonKeys: new Set(["tags"]), intKeys: new Set(["is_global"]) }
		);
		expect(fields).toEqual([]);
		expect(values).toEqual([]);
	});

	it("keeps key order stable across mixed option sets", () => {
		const { fields, values } = buildUpdateClause(
			{ code: "C-1", tags: ["t"], is_global: true, skip: "no" },
			{
				jsonKeys: new Set(["tags"]),
				intKeys: new Set(["is_global"]),
				excludeKeys: new Set(["skip"]),
				validColumns: new Set(["code", "tags", "is_global"])
			}
		);
		expect(fields).toEqual(["code = ?", "tags = ?", "is_global = ?"]);
		expect(values).toEqual(["C-1", '["t"]', 1]);
	});

	it("field/value arrays are always parallel and keyed to non-undefined entries (property)", () => {
		fc.assert(
			fc.property(fc.dictionary(fc.string(), fc.anything()), (updates) => {
				const { fields, values } = buildUpdateClause(updates);
				expect(fields.length).toBe(values.length);
				expect(fields.every((f) => f.endsWith(" = ?"))).toBe(true);
				const expectedKeys = Object.keys(updates).filter((k) => updates[k] !== undefined);
				expect(fields.map((f) => f.slice(0, -4))).toEqual(expectedKeys);
			})
		);
	});
});
