import { describe, it, expect } from "vitest";
import { parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

describe("TypeScriptVisitor", () => {
	// ── Interfaces ────────────────────────────────────────────────

	it("extracts interface properties and methods parented to the interface", async () => {
		const result = await parseOrSkip(
			"types.ts",
			`
interface User {
  id: string;
  name?: string;
  readonly email: string;
  greet(): void;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const user = result.symbols.find((s) => s.name === "User");
		expect(user).toBeDefined();
		expect(user!.kind).toBe("interface");

		const propertyNames = result.symbols
			.filter((s) => s.parentName === "User" && s.kind === "property")
			.map((s) => s.name);
		expect(propertyNames).toEqual(["id", "name", "email"]);

		const id = result.symbols.find((s) => s.name === "id" && s.parentName === "User");
		expect(id).toBeDefined();
		expect(id!.kind).toBe("property");
		expect(id!.signature).toBe("id: string");

		const email = result.symbols.find((s) => s.name === "email" && s.parentName === "User");
		expect(email).toBeDefined();
		// readonly is preserved verbatim in the signature.
		expect(email!.signature).toBe("readonly email: string");

		const greet = result.symbols.find((s) => s.name === "greet" && s.parentName === "User");
		expect(greet).toBeDefined();
		expect(greet!.kind).toBe("method");
		expect(greet!.parentName).toBe("User");
		expect(greet!.signature).toBe("greet(): void");
	});

	it("does not mark a non-exported interface (or its members) as exported", async () => {
		const result = await parseOrSkip(
			"types.ts",
			`
interface PrivateShape {
  width: number;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const iface = result.symbols.find((s) => s.name === "PrivateShape");
		expect(iface).toBeDefined();
		expect(iface!.exported).toBe(false);
		const width = result.symbols.find((s) => s.name === "width" && s.parentName === "PrivateShape");
		expect(width).toBeDefined();
		expect(width!.exported).toBe(false);
	});

	it("emits interface getter/setter accessors as Method (consistent with class accessors)", async () => {
		// In tree-sitter-typescript ^0.23 interface getters/setters parse as
		// `method_signature` (not get_signature/set_signature), so they are
		// emitted as Method — the same kind class accessors get via
		// `method_definition`. They are never emitted as Property.
		const result = await parseOrSkip(
			"types.ts",
			`
interface AccessorApi {
  get value(): string;
  set value(v: string);
  get count(): number;
  method(): void;
}
`
		);
		assertNoError(result);
		guardEmpty(result);

		const value = result.symbols.find((s) => s.name === "value" && s.parentName === "AccessorApi");
		expect(value).toBeDefined();
		expect(value!.kind).toBe("method");
		// The signature keeps the `get`/`set` keyword so the accessor is still
		// distinguishable from a plain method in the index.
		expect(value!.signature).toContain("get value");

		// `find` on the getter above would still pass if the setter were dropped,
		// so assert the `set value` accessor explicitly to guard the pair.
		const set = result.symbols.find(
			(s) => s.name === "value" && s.parentName === "AccessorApi" && s.signature.includes("set value")
		);
		expect(set).toBeDefined();
		expect(set!.kind).toBe("method");

		const count = result.symbols.find((s) => s.name === "count" && s.parentName === "AccessorApi");
		expect(count).toBeDefined();
		expect(count!.kind).toBe("method");

		const method = result.symbols.find((s) => s.name === "method" && s.parentName === "AccessorApi");
		expect(method).toBeDefined();
		expect(method!.kind).toBe("method");

		// No accessor may leak out as a Property symbol.
		const properties = result.symbols.filter((s) => s.parentName === "AccessorApi" && s.kind === "property");
		expect(properties).toEqual([]);
	});

	// ── Type aliases ──────────────────────────────────────────────

	it("extracts a type alias with its RHS preview in the signature", async () => {
		const result = await parseOrSkip(
			"types.ts",
			`
type Status = "active" | "inactive";
type Callback<T> = (value: T) => void;
`
		);
		assertNoError(result);
		guardEmpty(result);
		const status = result.symbols.find((s) => s.name === "Status");
		expect(status).toBeDefined();
		expect(status!.kind).toBe("type");
		// The RHS of the type alias appears in the signature as a preview.
		expect(status!.signature).toContain('type Status = "active" | "inactive"');

		const callback = result.symbols.find((s) => s.name === "Callback");
		expect(callback).toBeDefined();
		expect(callback!.kind).toBe("type");
		// Generic parameters are retained in type-alias signatures.
		expect(callback!.signature).toContain("<T>");
	});

	it("does not mark an unexported type alias as exported", async () => {
		const result = await parseOrSkip(
			"types.ts",
			`
type InternalKey = string;
`
		);
		assertNoError(result);
		guardEmpty(result);
		const key = result.symbols.find((s) => s.name === "InternalKey");
		expect(key).toBeDefined();
		expect(key!.kind).toBe("type");
		expect(key!.exported).toBe(false);
	});

	// ── Enums ─────────────────────────────────────────────────────

	it("extracts enum members as constants parented to the enum", async () => {
		const result = await parseOrSkip(
			"types.ts",
			`
enum UserRole {
  Admin = "admin",
  Editor,
  Viewer = "viewer",
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const role = result.symbols.find((s) => s.name === "UserRole");
		expect(role).toBeDefined();
		expect(role!.kind).toBe("enum");

		const admin = result.symbols.find((s) => s.name === "Admin" && s.parentName === "UserRole");
		expect(admin).toBeDefined();
		expect(admin!.kind).toBe("constant");
		expect(admin!.signature).toBe(`Admin = "admin"`);

		// Bare members (no explicit value) still get a Constant symbol.
		const editor = result.symbols.find((s) => s.name === "Editor" && s.parentName === "UserRole");
		expect(editor).toBeDefined();
		expect(editor!.kind).toBe("constant");
		expect(editor!.signature).toBe("Editor");

		const viewer = result.symbols.find((s) => s.name === "Viewer" && s.parentName === "UserRole");
		expect(viewer).toBeDefined();
		expect(viewer!.kind).toBe("constant");
	});

	it("does not mark enum members as exported", async () => {
		const source = `
export enum Status {
  Active = 1,
}
`;
		const result = await parseOrSkip("types.ts", source);
		assertNoError(result);
		guardEmpty(result);
		const active = result.symbols.find((s) => s.name === "Active" && s.parentName === "Status");
		expect(active).toBeDefined();
		expect(active!.kind).toBe("constant");
		expect(active!.exported).toBe(false);
	});

	// ── Generic type parameters ───────────────────────────────────

	it("retains generic type parameters in function, class, and interface signatures", async () => {
		const result = await parseOrSkip(
			"types.ts",
			`
function identity<T>(x: T): T { return x; }

class Box<T, U> {
  value: T;
  other: U;
}

interface Pair<A, B> {
  first: A;
  second: B;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "identity");
		expect(fn).toBeDefined();
		expect(fn!.signature).toContain("<T>");

		const box = result.symbols.find((s) => s.name === "Box");
		expect(box).toBeDefined();
		expect(box!.kind).toBe("class");
		expect(box!.signature).toContain("<T, U>");

		const pair = result.symbols.find((s) => s.name === "Pair");
		expect(pair).toBeDefined();
		expect(pair!.kind).toBe("interface");
		expect(pair!.signature).toContain("<A, B>");
	});

	// ── Class properties with visibility ─────────────────────────

	it("extracts class properties with accessibility and type in the signature", async () => {
		const result = await parseOrSkip(
			"service.ts",
			`
class UserService {
  public name: string;
  private readonly apiKey: string;
  protected age: number;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const apiKey = result.symbols.find((s) => s.name === "apiKey" && s.parentName === "UserService");
		expect(apiKey).toBeDefined();
		expect(apiKey!.kind).toBe("property");
		// Name must be the real identifier, NOT the accessibility modifier ("private").
		expect(apiKey!.name).toBe("apiKey");
		expect(apiKey!.signature).toBe("private readonly apiKey: string");

		const name = result.symbols.find((s) => s.name === "name" && s.parentName === "UserService");
		expect(name).toBeDefined();
		expect(name!.signature).toBe("public name: string");

		const age = result.symbols.find((s) => s.name === "age" && s.parentName === "UserService");
		expect(age).toBeDefined();
		expect(age!.signature).toBe("protected age: number");
	});

	it("marks public class members as names rather than their modifier", async () => {
		const result = await parseOrSkip(
			"service.ts",
			`
class UserService {
	public secret: string;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		// The named symbol must be "secret", never "public".
		const secret = result.symbols.find((s) => s.kind === "property" && s.parentName === "UserService");
		expect(secret).toBeDefined();
		expect(secret!.name).toBe("secret");
	});

	// ── Abstract classes & members ─────────────────────────────

});
