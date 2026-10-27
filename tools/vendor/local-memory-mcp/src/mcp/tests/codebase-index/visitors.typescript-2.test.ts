import { describe, it, expect } from "vitest";
import { parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

describe("TypeScriptVisitor", () => {
	it("extracts abstract classes and their abstract methods parented to the class", async () => {
		const result = await parseOrSkip(
			"abstract.ts",
			`
abstract class Repository {
  abstract find(id: string): unknown;
  abstract save(item: unknown): Promise<void>;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const repo = result.symbols.find((s) => s.name === "Repository");
		expect(repo).toBeDefined();
		expect(repo!.kind).toBe("class");

		const find = result.symbols.find((s) => s.name === "find" && s.parentName === "Repository");
		expect(find).toBeDefined();
		expect(find!.kind).toBe("method");
		expect(find!.parentName).toBe("Repository");

		const save = result.symbols.find((s) => s.name === "save" && s.parentName === "Repository");
		expect(save).toBeDefined();
		expect(save!.kind).toBe("method");
		expect(save!.parentName).toBe("Repository");
	});

	it("does not drop an exported abstract class or leak into the class declaration body", async () => {
		const result = await parseOrSkip(
			"abstract.ts",
			`
export abstract class Cache {
	abstract get(key: string): string | undefined;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cache = result.symbols.find((s) => s.name === "Cache");
		expect(cache).toBeDefined();
		expect(cache!.kind).toBe("class");
		expect(cache!.exported).toBe(true);

		const get = result.symbols.find((s) => s.name === "get" && s.parentName === "Cache");
		expect(get).toBeDefined();
		expect(get!.kind).toBe("method");
		expect(get!.parentName).toBe("Cache");
	});

	it("leaves concrete classes (and their non-abstract members) unaffected", async () => {
		const result = await parseOrSkip(
			"concrete.ts",
			`
class AccountService {
  private readonly repository: Repository;

  find(id: string): unknown {
    return this.repository.find(id);
  }

  save(item: unknown): Promise<void> {
    return this.repository.save(item);
  }
}
`
		);
		assertNoError(result);
		guardEmpty(result);

		// Concrete class still emits a Class symbol.
		const svc = result.symbols.find((s) => s.name === "AccountService");
		expect(svc).toBeDefined();
		expect(svc!.kind).toBe("class");

		// Concrete member methods are Method, parented to the class, with their
		// bodies intact — the abstract-class branch must not change their kind.
		const find = result.symbols.find((s) => s.name === "find" && s.parentName === "AccountService");
		expect(find).toBeDefined();
		expect(find!.kind).toBe("method");
		expect(find!.parentName).toBe("AccountService");
		expect(find!.signature).toBe("find(id: string): unknown {");

		const save = result.symbols.find((s) => s.name === "save" && s.parentName === "AccountService");
		expect(save).toBeDefined();
		expect(save!.kind).toBe("method");

		// A non-abstract field is still a Property, never a Method.
		const repository = result.symbols.find((s) => s.name === "repository" && s.parentName === "AccountService");
		expect(repository).toBeDefined();
		expect(repository!.kind).toBe("property");
	});

	// ── Decorators ───────────────────────────────────────────────

	it("captures decorators on classes and members in the signature", async () => {
		const result = await parseOrSkip(
			"decorated.ts",
			`
@Injectable()
export class UserService {
  private readonly client: Client;

  @RuntimeLogger()
  fetch(): string {
    return "";
  }
}

@Component({ selector: "app" })
class AppRoot {}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const svc = result.symbols.find((s) => s.name === "UserService");
		expect(svc).toBeDefined();
		expect(svc!.signature).toContain("@Injectable()");

		const fetch = result.symbols.find((s) => s.name === "fetch" && s.parentName === "UserService");
		expect(fetch).toBeDefined();
		expect(fetch!.signature).toContain("@RuntimeLogger()");

		// A decorator on a bare (non-exported) class still indexes it with its
		// real name and decorator prefix.
		const app = result.symbols.find((s) => s.name === "AppRoot");
		expect(app).toBeDefined();
		expect(app!.kind).toBe("class");
		expect(app!.signature).toContain('@Component({ selector: "app" })');
	});

	it("leaves undecorated members' signatures untouched", async () => {
		const result = await parseOrSkip(
			"decorator.ts",
			`
@Injectable()
class Service {
	someField: string;
	run(): void {}
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const field = result.symbols.find((s) => s.name === "someField" && s.parentName === "Service");
		expect(field).toBeDefined();
		// Undecorated member does not inherit the class decorator.
		expect(field!.signature).not.toContain("@Injectable()");
		expect(field!.signature).toBe("someField: string");

		const run = result.symbols.find((s) => s.name === "run" && s.parentName === "Service");
		expect(run).toBeDefined();
		expect(run!.signature).not.toContain("@Injectable()");
		expect(run!.signature).toBe("run(): void {}");
	});

	// ── .js path regression ──────────────────────────────────────

	it("parses plain JS files without regressing symbol extraction", async () => {
		const result = await parseOrSkip(
			"plain.js",
			`
function add(a, b) { return a + b; }

class Car {
  constructor() { this.name = "x"; }
  drive() { return "vroom"; }
}

module.exports = { add, Car };
`
		);
		assertNoError(result);
		guardEmpty(result);
		const add = result.symbols.find((s) => s.name === "add");
		expect(add).toBeDefined();
		expect(add!.kind).toBe("function");
		const car = result.symbols.find((s) => s.name === "Car");
		expect(car).toBeDefined();
		expect(car!.kind).toBe("class");
		// Class methods still resolve to their identifier, not a modifier keyword.
		const drive = result.symbols.find((s) => s.name === "drive" && s.parentName === "Car");
		expect(drive).toBeDefined();
		expect(drive!.kind).toBe("method");
	});

	it("extracts structured doc-comment (summary + tags + deprecated) from preceding JSDoc", async () => {
		const result = await parseOrSkip(
			"docs.ts",
			`
/**
 * Computes a total cost.
 * @param items - the line items
 * @returns the computed total
 * @throws if items is empty
 * @deprecated use \`calculateTotal()\` instead
 */
export function computeTotal(items: Item[]): number { return 0; }

/** Fetches a local value.
 * @param key - the key
 */
function fetchLocal(key: string) {}

class Cart {
  /** The current item count. */
  private count = 0;

  /**
   * Adds an item to the cart.
   * @param item - the item
   */
  @Tracked()
  add(item: Item): number {
    return 1;
  }
}
`
		);
		assertNoError(result);
		guardEmpty(result);

		// Exported function: doc comment precedes the export_statement wrapper.
		const total = result.symbols.find((s) => s.name === "computeTotal");
		expect(total).toBeDefined();
		expect(total!.docComment).toContain("Computes a total cost.");
		expect(total!.docComment).toContain("@param items - the line items");
		expect(total!.docComment).toContain("@returns the computed total");
		expect(total!.docComment).toContain("@throws if items is empty");
		expect(total!.docComment).toContain("@deprecated");
		expect(total!.docComment).toContain("[DEPRECATED]");

		// Non-exported function still captures its own JSDoc.
		const local = result.symbols.find((s) => s.name === "fetchLocal");
		expect(local).toBeDefined();
		expect(local!.docComment).toContain("Fetches a local value.");
		expect(local!.docComment).toContain("@param key - the key");

		// Class property: single-line JSDoc becomes the summary.
		const count = result.symbols.find((s) => s.name === "count" && s.parentName === "Cart");
		expect(count).toBeDefined();
		expect(count!.docComment).toBe("The current item count.");

		// Decorated method: the JSDoc is found past the decorator sibling.
		const add = result.symbols.find((s) => s.name === "add" && s.parentName === "Cart");
		expect(add).toBeDefined();
		expect(add!.docComment).toContain("Adds an item to the cart.");
		expect(add!.docComment).toContain("@param item - the item");

		// A declaration without its own JSDoc must NOT inherit a neighbour's.
		const cart = result.symbols.find((s) => s.name === "Cart");
		expect(cart).toBeDefined();
		expect(cart!.docComment).toBeNull();
	});
});
