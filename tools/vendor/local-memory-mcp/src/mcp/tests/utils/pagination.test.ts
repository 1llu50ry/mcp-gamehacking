import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { encodeCursor, decodeCursor, invalidPaginationParams } from "../../utils/pagination";

describe("pagination cursors", () => {
	it("encodeCursor base64-encodes the offset string", () => {
		expect(encodeCursor(0)).toBe(Buffer.from("0", "utf8").toString("base64"));
		expect(encodeCursor(42)).toBe(Buffer.from("42", "utf8").toString("base64"));
	});

	it("round-trips an offset through encode/decode", () => {
		expect(decodeCursor(encodeCursor(7))).toBe(7);
		expect(decodeCursor(encodeCursor(1000))).toBe(1000);
	});

	it("decodeCursor returns 0 for undefined, null and empty string", () => {
		expect(decodeCursor(undefined)).toBe(0);
		expect(decodeCursor(null)).toBe(0);
		expect(decodeCursor("")).toBe(0);
	});

	it("round-trips any non-negative offset (property)", () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 1_000_000 }), (offset) => {
				expect(decodeCursor(encodeCursor(offset))).toBe(offset);
			})
		);
	});

	it("throws a -32602 error for a non-string cursor", () => {
		expect(() => decodeCursor(42)).toThrow("Invalid cursor");
		try {
			decodeCursor(42);
		} catch (err) {
			expect((err as Error & { code: number }).code).toBe(-32602);
		}
	});

	it("throws for a whitespace-only string cursor", () => {
		expect(() => decodeCursor("   ")).toThrow("Invalid cursor");
	});

	it("throws for a non-base64 cursor", () => {
		expect(() => decodeCursor("!!not-base64!!")).toThrow("Invalid cursor");
	});

	it("throws when the decoded text is not numeric", () => {
		const encoded = Buffer.from("hello", "utf8").toString("base64");
		expect(() => decodeCursor(encoded)).toThrow("Invalid cursor");
	});

	it("throws when the decoded number is negative", () => {
		const encoded = Buffer.from("-5", "utf8").toString("base64");
		expect(() => decodeCursor(encoded)).toThrow("Invalid cursor");
	});

	it("throws when the decoded text has a decimal point", () => {
		const encoded = Buffer.from("1.5", "utf8").toString("base64");
		expect(() => decodeCursor(encoded)).toThrow("Invalid cursor");
	});

	it("throws when the decoded text contains whitespace-padded digits", () => {
		const encoded = Buffer.from(" 5", "utf8").toString("base64");
		expect(() => decodeCursor(encoded)).toThrow("Invalid cursor");
	});
});

describe("invalidPaginationParams", () => {
	it("creates an error carrying the JSON-RPC invalid-params code", () => {
		const error = invalidPaginationParams("Invalid cursor");
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toBe("Invalid cursor");
		expect((error as Error & { code: number }).code).toBe(-32602);
	});
});
