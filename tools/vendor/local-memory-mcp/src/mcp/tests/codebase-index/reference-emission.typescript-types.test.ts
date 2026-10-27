import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

/**
 * TypeScriptVisitor type-reference edge emission (TASK-008 / issue #82,
 * migration v26) — semantic-graph epic P0.
 *
 * Acceptance criteria covered here:
 *   - `create(dto: CreateOrderDto): Promise<OrderResponseDto>` produces type
 *     edges to BOTH DTO types (parameter + return roles).
 *   - Class/interface property types → 'property' role.
 *   - Type aliases → 'alias' role; generic type arguments → 'generic';
 *     generic constraints → 'constraint'.
 *   - Unions → 'union' members; intersections → 'intersection' members.
 *   - Nested generics / composite types recurse to named leaves.
 *   - Unresolved targets (predefined/structural/anonymous types) emit no edge.
 *   - No type annotations → no type edges (existing behavior unchanged).
 *   - callerName attribution: function params/returns carry the fn name.
 */
describe("TypeScriptVisitor type reference emission (TASK-008)", () => {
	it("emits type edges to BOTH DTO types for params + returns (createOrder example)", async () => {
		const result = await parseOrSkip(
			"create-order.ts",
			`async function createOrder(
  dto: CreateOrderDto,
): Promise<OrderResponseDto> {}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];

		// Parameter edge → CreateOrderDto with role 'parameter', attributed to createOrder.
		const param = refs.find((r) => r.symbolName === "CreateOrderDto" && r.kind === "type");
		expect(param).toBeDefined();
		expect(param!.role).toBe("parameter");
		expect(param!.callerName).toBe("createOrder");
		expect(param!.callerLine).toBe(2);

		// Return edge → OrderResponseDto (inside Promise<...> the generic arg is
		// a 'generic' role edge pointing at OrderResponseDto).
		const ret = refs.find((r) => r.symbolName === "OrderResponseDto" && r.kind === "type");
		expect(ret).toBeDefined();
		expect(ret!.role).toBe("generic");
		expect(ret!.callerName).toBe("createOrder");
		expect(ret!.callerLine).toBe(3);

		// The outer wrapper Promise<...> is itself a named type (generic) →
		// a 'return' edge to Promise too.
		const promise = refs.find((r) => r.symbolName === "Promise" && r.kind === "type");
		expect(promise).toBeDefined();
		expect(promise!.role).toBe("return");
		expect(promise!.callerName).toBe("createOrder");
	});

	it("emits property-role edges for class fields and interface properties", async () => {
		const result = await parseOrSkip(
			"props.ts",
			`class Order {
  id: string;
  items: LineItem[];
  meta: Map<string, Meta>;
}

interface Payload {
  user: UserProfile;
  get(a: string): Result;
}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const typeRefs = refs.filter((r) => r.kind === "type");

		// id: string → 'string' is a predefined_type → NO edge (unresolved).
		expect(typeRefs.find((r) => r.symbolName === "string")).toBeUndefined();

		// items: LineItem[] → array unwrap → LineItem as 'property'.
		const lineItem = typeRefs.find((r) => r.symbolName === "LineItem");
		expect(lineItem).toBeDefined();
		expect(lineItem!.role).toBe("property");
		expect(lineItem!.callerName).toBeNull();

		// meta: Map<string, Meta> → Map as 'property', Meta as 'generic' arg.
		const map = typeRefs.find((r) => r.symbolName === "Map");
		expect(map?.role).toBe("property");
		const meta = typeRefs.find((r) => r.symbolName === "Meta");
		expect(meta).toBeDefined();
		expect(meta!.role).toBe("generic");

		// interface Payload { user: UserProfile } → 'property'.
		const user = typeRefs.find((r) => r.symbolName === "UserProfile");
		expect(user).toBeDefined();
		expect(user!.role).toBe("property");
		expect(user!.callerName).toBeNull();

		// interface method get(a: string): Result → param 'string' unresolved;
		// return Result as 'return' attributed to the method name.
		const resultRef = typeRefs.find((r) => r.symbolName === "Result");
		expect(resultRef).toBeDefined();
		expect(resultRef!.role).toBe("return");
		expect(resultRef!.callerName).toBe("get");
	});

	it("emits alias-role edges for type aliases (incl. union/intersection values)", async () => {
		const result = await parseOrSkip(
			"aliases.ts",
			`type Id = string;
type Status = "active" | "inactive";
type Shape = Circle | Square;
type Named = { name: string; } & WithId;
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const typeRefs = refs.filter((r) => r.kind === "type");

		// type Id = string → predefined → NO edge.
		expect(typeRefs.find((r) => r.symbolName === "string")).toBeUndefined();

		// type Status = "active" | "inactive" → literal types → NO edges.
		// type Shape = Circle | Square → union members as 'union'.
		const circle = typeRefs.find((r) => r.symbolName === "Circle");
		expect(circle).toBeDefined();
		expect(circle!.role).toBe("union");
		const square = typeRefs.find((r) => r.symbolName === "Square");
		expect(square).toBeDefined();
		expect(square!.role).toBe("union");

		// type Named = { name: string; } & WithId → structural object member
		// emits nothing (name is string), intersection member WithId as 'intersection'.
		const withId = typeRefs.find((r) => r.symbolName === "WithId");
		expect(withId).toBeDefined();
		expect(withId!.role).toBe("intersection");
	});

	it("emits constraint-role edges for generic constraints and default bindings", async () => {
		const result = await parseOrSkip(
			"generics.ts",
			`function pair<T extends Comparable, U = Fallback>(a: T, b: U): T {}
class Box<T extends Storable> {}
interface Repo<T extends Entity = DefaultEntity> {}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const typeRefs = refs.filter((r) => r.kind === "type");

		// Function-level constraint → 'constraint' attributed to the fn name.
		const comparable = typeRefs.find((r) => r.symbolName === "Comparable");
		expect(comparable).toBeDefined();
		expect(comparable!.role).toBe("constraint");
		expect(comparable!.callerName).toBe("pair");

		// Default binding U = Fallback → 'generic' (a default is a type-level dep).
		const fallback = typeRefs.find((r) => r.symbolName === "Fallback");
		expect(fallback).toBeDefined();
		expect(fallback!.role).toBe("generic");
		expect(fallback!.callerName).toBe("pair");

		// Class-level constraint → 'constraint', callerName null (declaration).
		const storable = typeRefs.find((r) => r.symbolName === "Storable");
		expect(storable).toBeDefined();
		expect(storable!.role).toBe("constraint");
		expect(storable!.callerName).toBeNull();

		// Interface-level constraint + default → 'constraint' + 'generic'.
		const entity = typeRefs.find((r) => r.symbolName === "Entity");
		expect(entity).toBeDefined();
		expect(entity!.role).toBe("constraint");
		expect(entity!.callerName).toBeNull();
		const defaultEntity = typeRefs.find((r) => r.symbolName === "DefaultEntity");
		expect(defaultEntity).toBeDefined();
		expect(defaultEntity!.role).toBe("generic");
	});

	it("recurses nested generics and composite types to named leaves", async () => {
		const result = await parseOrSkip(
			"nested.ts",
			`function f(x: Map<string, List<OrderItem>>): Promise<Result<Payload>> { return null!; }
const g = (cb: (a: Input) => Output): void => {};
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const typeRefs = refs.filter((r) => r.kind === "type");

		// x: Map<string, List<OrderItem>> → Map(parameter) → string(no edge,
		// predefined) → List(generic) → OrderItem(generic).
		expect(typeRefs.find((r) => r.symbolName === "Map")?.role).toBe("parameter");
		const list = typeRefs.find((r) => r.symbolName === "List");
		expect(list).toBeDefined();
		expect(list!.role).toBe("generic");
		const orderItem = typeRefs.find((r) => r.symbolName === "OrderItem");
		expect(orderItem).toBeDefined();
		expect(orderItem!.role).toBe("generic");

		// Return Promise<Result<Payload>> → Promise(return) → Result(generic) →
		// Payload(generic).
		const promise = typeRefs.find((r) => r.symbolName === "Promise");
		expect(promise?.role).toBe("return");
		const resultRef = typeRefs.find((r) => r.symbolName === "Result");
		expect(resultRef?.role).toBe("generic");
		const payload = typeRefs.find((r) => r.symbolName === "Payload");
		expect(payload?.role).toBe("generic");

		// Arrow function `cb: (a: Input) => Output` → function_type param/return
		// named types still found (callerName null — anonymous arrow).
		const input = typeRefs.find((r) => r.symbolName === "Input");
		expect(input).toBeDefined();
		expect(input!.role).toBe("parameter");
		const output = typeRefs.find((r) => r.symbolName === "Output");
		expect(output).toBeDefined();
		expect(output!.role).toBe("return");
	});

	it("emits no type edges for unresolved / structural / predefined targets", async () => {
		const result = await parseOrSkip(
			"unresolved.ts",
			`function f(a: string, b: number, c: boolean, d: object): void {
  const x: { nested: () => void } = { nested: () => {} };
}
type Fn = (p: unknown) => void;
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const typeRefs = refs.filter((r) => r.kind === "type");

		// No named types anywhere in this source → zero type edges.
		expect(typeRefs).toHaveLength(0);

		// … and NOTHING else changed: no call/instantiation/import/heritage edges.
		const other = refs.filter((r) => r.kind !== "type");
		expect(other).toHaveLength(0);
	});

	it("emits no type edges when no type annotations exist (existing behavior unchanged)", async () => {
		const result = await parseOrSkip(
			"plain.ts",
			`function run() {
  helper();
}
const value = compute();
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const typeRefs = refs.filter((r) => r.kind === "type");
		expect(typeRefs).toHaveLength(0);

		// Runtime call edges still emit as before.
		const call = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(call).toBeDefined();
		expect(call!.callerName).toBe("run");
		expect(refs.some((r) => r.symbolName === "compute" && r.kind === "call")).toBe(true);
	});

	it("resolves nested_type_identifier and member_expression names to last segment (ADR-002)", async () => {
		const result = await parseOrSkip(
			"namespaced.ts",
			`function f(dto: DTO.CreateOrderDto, out: ns.NSResponse): void {}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const typeRefs = refs.filter((r) => r.kind === "type");

		// DTO.CreateOrderDto (nested_type_identifier) → CreateOrderDto.
		const dto = typeRefs.find((r) => r.symbolName === "CreateOrderDto");
		expect(dto).toBeDefined();
		expect(dto!.role).toBe("parameter");
		expect(dto!.callerName).toBe("f");

		// ns.NSResponse (member_expression) → NSResponse.
		const resp = typeRefs.find((r) => r.symbolName === "NSResponse");
		expect(resp).toBeDefined();
		expect(resp!.role).toBe("parameter");
	});
});
