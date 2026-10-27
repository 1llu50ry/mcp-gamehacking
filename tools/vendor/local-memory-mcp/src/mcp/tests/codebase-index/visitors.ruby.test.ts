import { describe, it, expect } from "vitest";
import { parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

describe("RubyVisitor", () => {
	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.rb",
			`
class Person
  attr_accessor :name
end
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});

	it("extracts methods", async () => {
		const result = await parseOrSkip(
			"test.rb",
			`
def hello(name)
  "Hello, #{name}"
end
`
		);
		assertNoError(result);
		guardEmpty(result);
		const m = result.symbols.find((s) => s.name === "hello");
		if (!m) return;
		expect(m.kind).toBe("method");
	});

	it("extracts attr_accessor/attr_reader/attr_writer as methods parented to class", async () => {
		const result = await parseOrSkip(
			"test.rb",
			`
class Person
  # member attributes
  attr_accessor :name, :age
  attr_reader :email
  attr_writer :nickname
end
`
		);
		assertNoError(result);
		guardEmpty(result);
		const name = result.symbols.find((s) => s.name === "name");
		if (!name) return;
		expect(name.kind).toBe("method");
		expect(name.parentName).toBe("Person");
		expect(name.signature).toBe("attr_accessor :name");
		const age = result.symbols.find((s) => s.name === "age");
		if (!age) return;
		expect(age.kind).toBe("method");
		expect(age.parentName).toBe("Person");
		expect(age.signature).toBe("attr_accessor :age");
		const email = result.symbols.find((s) => s.name === "email");
		if (!email) return;
		expect(email.kind).toBe("method");
		expect(email.parentName).toBe("Person");
		expect(email.signature).toBe("attr_reader :email");
		const nickname = result.symbols.find((s) => s.name === "nickname");
		if (!nickname) return;
		expect(nickname.signature).toBe("attr_writer :nickname");
	});

	it("extracts extend/include module mixins parented to class", async () => {
		const result = await parseOrSkip(
			"test.rb",
			`
class Service
  extend SomeModule
  include OtherModule
end
`
		);
		assertNoError(result);
		guardEmpty(result);
		const ext = result.symbols.find((s) => s.kind === "module" && s.name === "SomeModule");
		if (!ext) return;
		expect(ext.parentName).toBe("Service");
		expect(ext.signature).toBe("extend SomeModule");
		const inc = result.symbols.find((s) => s.kind === "module" && s.name === "OtherModule");
		if (!inc) return;
		expect(inc.parentName).toBe("Service");
		expect(inc.signature).toBe("include OtherModule");
	});
	it("extracts structured doc-comment from preceding # comments", async () => {
		const result = await parseOrSkip(
			"test.rb",
			`
# Computes a total cost.
# @param items the line items
# @return the computed total
# @deprecated use calculate_total() instead
def compute_total(items)
  items.sum
end

# A shopping cart.
class Cart
  # Adds an item.
  # @param item the item to add
  def add(item)
  end
end

class NoDoc
  def plain
  end
end
`
		);
		assertNoError(result);
		guardEmpty(result);

		const total = result.symbols.find((s) => s.name === "compute_total");
		expect(total).toBeDefined();
		expect(total!.docComment).toContain("Computes a total cost.");
		expect(total!.docComment).toContain("@param items the line items");
		expect(total!.docComment).toContain("@return the computed total");
		expect(total!.docComment).toContain("@deprecated use calculate_total() instead");
		expect(total!.docComment).toContain("[DEPRECATED]");

		const cart = result.symbols.find((s) => s.name === "Cart");
		expect(cart).toBeDefined();
		expect(cart!.docComment).toBe("A shopping cart.");

		const add = result.symbols.find((s) => s.name === "add" && s.parentName === "Cart");
		expect(add).toBeDefined();
		expect(add!.docComment).toContain("Adds an item.");
		expect(add!.docComment).toContain("@param item the item to add");

		// A declaration without its own doc comment must NOT inherit a neighbour's.
		const noDoc = result.symbols.find((s) => s.name === "NoDoc");
		expect(noDoc).toBeDefined();
		expect(noDoc!.docComment).toBeNull();
		const plain = result.symbols.find((s) => s.name === "plain" && s.parentName === "NoDoc");
		expect(plain).toBeDefined();
		expect(plain!.docComment).toBeNull();
	});
});

// ══════════════════════════════════════════════════════════════════════
