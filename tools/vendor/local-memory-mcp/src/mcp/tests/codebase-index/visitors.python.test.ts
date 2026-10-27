import { describe, it, expect } from "vitest";
import { parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

describe("PythonVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
def hello(name):
    return f"Hello, {name}"
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "hello");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe("function");
	});

	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
class Person:
    def __init__(self, name):
        self.name = name
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe("class");
	});

	it("extracts class methods", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
class Calculator:
    def add(self, a, b):
        return a + b
`
		);
		assertNoError(result);
		guardEmpty(result);
		const m = result.symbols.find((s) => s.name === "add");
		expect(m).toBeDefined();
		expect(m!.kind).toBe("method");
		expect(m!.parentName).toBe("Calculator");
	});

	it("extracts async functions with async in the signature", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
async def fetch(url):
    """Fetch a URL."""
    return url
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "fetch");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe("function");
		expect(fn!.signature).toBe("async def fetch(url):");
		expect(fn!.exported).toBe(true);
	});

	it("extracts decorated definitions with decorators prefixed to the signature", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
@app.route("/items", methods=["GET"])
def list_items():
    return []

@app.get("/x")
async def async_route():
    pass
`
		);
		assertNoError(result);
		guardEmpty(result);
		// Decorated defs must still be indexed (not lost) with their real name/kind
		const listItems = result.symbols.find((s) => s.name === "list_items");
		expect(listItems).toBeDefined();
		expect(listItems!.kind).toBe("function");
		expect(listItems!.exported).toBe(true);
		expect(listItems!.signature).toBe('@app.route("/items", methods=["GET"]) def list_items():');
		// Async + decorator combination keeps both markers
		const asyncRoute = result.symbols.find((s) => s.name === "async_route");
		expect(asyncRoute).toBeDefined();
		expect(asyncRoute!.kind).toBe("function");
		expect(asyncRoute!.signature).toBe('@app.get("/x") async def async_route():');
	});

	it("extracts decorated classes without leaking decorators into methods", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
@dataclass
class Person:
    def greet(self) -> str:
        return "hi"
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		expect(cls).toBeDefined();
		expect(cls!.kind).toBe("class");
		expect(cls!.exported).toBe(true);
		expect(cls!.signature).toBe("@dataclass class Person:");
		// Class decorators decorate the class, NOT its methods
		const greet = result.symbols.find((s) => s.name === "greet");
		expect(greet).toBeDefined();
		expect(greet!.kind).toBe("method");
		expect(greet!.parentName).toBe("Person");
		expect(greet!.signature).toBe("def greet(self) -> str:");
	});

	it("captures __all__ export assignments as constants", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
def fetch(url):
    return url

class Person:
    pass

__all__ = ["fetch", "Person"]
`
		);
		assertNoError(result);
		guardEmpty(result);
		const all = result.symbols.find((s) => s.name === "__all__");
		expect(all).toBeDefined();
		expect(all!.kind).toBe("constant");
		expect(all!.exported).toBe(true);
		expect(all!.signature).toBe('__all__ = ["fetch", "Person"]');
	});

	it("extracts structured doc-comment from function and class docstrings", async () => {
		const result = await parseOrSkip(
			"test.py",
			`
def compute_total(items):
    '''Computes a total cost.
    @param items - the line items
    @return the computed total
    @deprecated use calculate_total() instead
    '''
    return sum(items)

class Cart:
    '''A shopping cart.'''
    def add(self, item):
        '''Adds an item to the cart.
        @param item - the item to add
        '''
        pass

class NoDoc:
    def plain(self):
        pass
`
		);
		assertNoError(result);
		guardEmpty(result);

		const total = result.symbols.find((s) => s.name === "compute_total");
		expect(total).toBeDefined();
		expect(total!.docComment).toContain("Computes a total cost.");
		expect(total!.docComment).toContain("@param items - the line items");
		expect(total!.docComment).toContain("@return the computed total");
		expect(total!.docComment).toContain("@deprecated use calculate_total() instead");
		expect(total!.docComment).toContain("[DEPRECATED]");

		const cart = result.symbols.find((s) => s.name === "Cart");
		expect(cart).toBeDefined();
		expect(cart!.docComment).toBe("A shopping cart.");

		const add = result.symbols.find((s) => s.name === "add" && s.parentName === "Cart");
		expect(add).toBeDefined();
		expect(add!.docComment).toContain("Adds an item to the cart.");
		expect(add!.docComment).toContain("@param item - the item to add");

		// A declaration without its own docstring must NOT inherit a neighbour's.
		const noDoc = result.symbols.find((s) => s.name === "NoDoc");
		expect(noDoc).toBeDefined();
		expect(noDoc!.docComment).toBeNull();
		const plain = result.symbols.find((s) => s.name === "plain" && s.parentName === "NoDoc");
		expect(plain).toBeDefined();
		expect(plain!.docComment).toBeNull();
	});
});

// ══════════════════════════════════════════════════════════════════════
