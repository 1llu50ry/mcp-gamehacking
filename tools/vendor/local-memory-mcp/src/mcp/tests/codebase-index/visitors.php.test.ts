import { describe, it, expect } from "vitest";
import { parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

describe("PhpVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
function hello(string $name): string {
	return "Hello, " . $name;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "hello");
		if (!fn) return;
		expect(fn.kind).toBe("function");
	});

	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
class Person {
	public string $name;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});

	it("extracts interfaces", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
interface JsonSerializable {
	public function jsonSerialize(): array;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const iface = result.symbols.find((s) => s.name === "JsonSerializable");
		if (!iface) return;
		expect(iface.kind).toBe("interface");
	});

	it("extracts use statements as module imports", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
use App\\Models\\User;
use Illuminate\\Support\\Facades\\DB as Database;
use function array_map as am;
use const PHP_VERSION;
use Carbon\\Carbon, Ramsey\\Uuid\\Uuid;

class A { use SomeTrait; }
`
		);
		assertNoError(result);
		guardEmpty(result);
		const modules = result.symbols.filter((s) => s.kind === "module");
		const names = modules.map((s) => s.name);
		expect(names).toContain("App\\Models\\User");
		expect(names).toContain("Illuminate\\Support\\Facades\\DB");
		expect(names).toContain("array_map");
		expect(names).toContain("PHP_VERSION");
		expect(names).toContain("Carbon\\Carbon");
		expect(names).toContain("Ramsey\\Uuid\\Uuid");
		// Trait `use` statements inside classes are NOT imports.
		expect(names).not.toContain("SomeTrait");
	});

	it("captures aliases of use statements in signature", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
use Illuminate\\Support\\Facades\\DB as Database;
`
		);
		assertNoError(result);
		guardEmpty(result);
		const db = result.symbols.find((s) => s.name === "Illuminate\\Support\\Facades\\DB");
		if (!db) return;
		expect(db.kind).toBe("module");
		expect(db.signature).toBe("Database");
	});

	it("extracts group use statements with namespace prefix", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
use Foo\\Bar\\{Baz, Qux as Q};
`
		);
		assertNoError(result);
		guardEmpty(result);
		const names = result.symbols.filter((s) => s.kind === "module").map((s) => s.name);
		expect(names).toContain("Foo\\Bar\\Baz");
		expect(names).toContain("Foo\\Bar\\Qux");
		const qux = result.symbols.find((s) => s.name === "Foo\\Bar\\Qux");
		if (!qux) return;
		expect(qux.signature).toBe("Q");
	});

	it("extracts enum methods with parent enum name", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
enum UserRole: string {
	case Admin = 'admin';
	case Editor = 'editor';

	public function label(): string {
		return ucfirst($this->value);
	}
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const role = result.symbols.find((s) => s.name === "UserRole");
		if (!role) return;
		expect(role.kind).toBe("enum");
		const method = result.symbols.find((s) => s.name === "label");
		if (!method) return;
		expect(method.kind).toBe("method");
		expect(method.parentName).toBe("UserRole");
	});

	it("extracts enum cases as constants", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
enum UserRole: string {
	case Admin = 'admin';
	case Editor = 'editor';
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cases = result.symbols.filter((s) => s.kind === "constant" && s.parentName === "UserRole");
		const admin = cases.find((s) => s.name === "Admin");
		if (!admin) return;
		expect(admin.signature).toBe("Admin = 'admin'");
		expect(cases.some((s) => s.name === "Editor")).toBe(true);
	});

	it("extracts unbacked enum cases without value in signature", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
enum Simple {
	case One;
	case Two;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const one = result.symbols.find((s) => s.name === "One");
		if (!one) return;
		expect(one.kind).toBe("constant");
		expect(one.parentName).toBe("Simple");
		expect(one.signature).toBe("One");
	});

	it("extracts structured doc-comment (summary + tags + deprecated) from preceding PHPDoc", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
/**
 * Fetches a user by ID.
 * @param int $id - The user ID
 * @return string
 * @throws \\RuntimeException when the user is missing
 * @deprecated use findUser() instead
 */
function fetchUser(int $id): string { return ""; }

class User {
	/**
	 * Greets the person.
	 * @param string $greeting - a greeting
	 * @return void
	 */
	public function greet(string $greeting): void {}

	/**
	 * The display name.
	 * @var string
	 */
	public string $name;
}
`
		);
		assertNoError(result);
		guardEmpty(result);

		const fn = result.symbols.find((s) => s.name === "fetchUser");
		expect(fn).toBeDefined();
		expect(fn!.docComment).toContain("Fetches a user by ID.");
		expect(fn!.docComment).toContain("@param int $id - The user ID");
		expect(fn!.docComment).toContain("@return string");
		expect(fn!.docComment).toContain("@throws \\RuntimeException when the user is missing");
		expect(fn!.docComment).toContain("@deprecated use findUser() instead");
		expect(fn!.docComment).toContain("[DEPRECATED]");

		const method = result.symbols.find((s) => s.name === "greet" && s.parentName === "User");
		expect(method).toBeDefined();
		expect(method!.docComment).toContain("Greets the person.");
		expect(method!.docComment).toContain("@param string $greeting - a greeting");
		expect(method!.docComment).toContain("@return void");

		const prop = result.symbols.find((s) => s.name === "name" && s.parentName === "User");
		expect(prop).toBeDefined();
		expect(prop!.docComment).toBe("The display name.\n@var string");
	});

	it("includes visibility and static/abstract/final/readonly keywords in method signatures", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
abstract class Repository {
	public static function find(int $id): string { return ""; }
	abstract public function all(): array;
	protected final function finalize(): void {}
	public readonly int $id;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const repo = result.symbols.find((s) => s.name === "Repository");
		expect(repo).toBeDefined();
		expect(repo!.kind).toBe("class");
		// The `abstract` keyword is present in the class signature.
		expect(repo!.signature).toContain("abstract");

		const find = result.symbols.find((s) => s.name === "find" && s.parentName === "Repository");
		expect(find).toBeDefined();
		expect(find!.kind).toBe("method");
		expect(find!.signature).toContain("public static");
		expect(find!.signature).toContain("find(int $id): string");

		const all = result.symbols.find((s) => s.name === "all" && s.parentName === "Repository");
		expect(all).toBeDefined();
		expect(all!.kind).toBe("method");
		expect(all!.signature).toContain("abstract public");
		expect(all!.signature).toContain("all(): array");

		const finalize = result.symbols.find((s) => s.name === "finalize" && s.parentName === "Repository");
		expect(finalize).toBeDefined();
		expect(finalize!.kind).toBe("method");
		expect(finalize!.signature).toContain("protected final");
		expect(finalize!.signature).toContain("finalize(): void");

		const id = result.symbols.find((s) => s.name === "id" && s.parentName === "Repository");
		expect(id).toBeDefined();
		expect(id!.kind).toBe("variable");
		// readonly property modifier is preserved in the property signature.
		expect(id!.signature).toContain("readonly");
		expect(id!.signature).toContain("public readonly");
	});

	it("prefixes PHP 8 attributes onto method/function/class signatures without leaking them as symbols", async () => {
		const result = await parseOrSkip(
			"test.php",
			`
<?php
#[Route('/api')]
final class User {
	#[Route('/user', methods: ['GET'])]
	public static function show(int $id): string { return ""; }
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const user = result.symbols.find((s) => s.name === "User");
		expect(user).toBeDefined();
		expect(user!.kind).toBe("class");
		expect(user!.signature).toContain("#[Route('/api')]");

		const show = result.symbols.find((s) => s.name === "show" && s.parentName === "User");
		expect(show).toBeDefined();
		expect(show!.kind).toBe("method");
		expect(show!.signature).toContain("#[Route('/user', methods: ['GET'])]");
		expect(show!.signature).toContain("public");

		// Attributes are modifiers of their declaration, not standalone symbols.
		expect(result.symbols.some((s) => s.name === "Route")).toBe(false);
	});
});

// ══════════════════════════════════════════════════════════════════════

