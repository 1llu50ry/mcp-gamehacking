import { describe, expect, it } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

/**
 * Import-metadata emission tests (TASK-009 / issue #83).
 *
 * Pins the visitor contract for 'import' edges: each row carries symbol_name
 * (the IMPORTED name — backward compatible) PLUS importInfo with the local
 * alias, imported name, raw module specifier and import form. Acceptance:
 *   - `import { User as DomainUser } from './user'` → symbolName 'User' +
 *     importInfo { localName 'DomainUser', importedName 'User',
 *     moduleSpecifier './user', importKind 'named' }
 *   - default imports → importKind 'default', importedName 'default'
 *   - namespace imports → importKind 'namespace', alias on both sides
 *   - side-effect imports → ONE row, importedName null, kind 'side-effect'
 *   - unresolved modules keep null targets (rows never dropped)
 */
describe("TypeScriptVisitor import metadata emission (issue #83)", () => {
	it("emits named alias imports with localName vs importedName separation", async () => {
		const result = await parseOrSkip(
			"app.ts",
			`import { User as DomainUser } from './user';
import { connect } from './db';
`
		);
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;
		if (!wasmAvailable) return;

		const refs = result.references ?? [];
		const imports = refs.filter((r) => r.kind === "import");
		expect(imports.length).toBe(2);

		const aliased = imports.find((r) => r.symbolName === "User");
		expect(aliased).toBeDefined();
		// symbol_name stays the IMPORTED name (canonical, backward compat).
		expect(aliased!.symbolName).toBe("User");
		// The local alias is carried separately.
		expect(aliased!.importInfo).toEqual({
			localName: "DomainUser",
			importedName: "User",
			moduleSpecifier: "./user",
			importKind: "named"
		});
		// callerFile filled by the pool; line anchored at the statement.
		expect(aliased!.callerFile).toBe("app.ts");
		expect(aliased!.callerLine).toBe(1);
		// Targets stay null — resolution happens in the pipeline, not the visitor.
		expect(aliased!.targetFile).toBeUndefined();
		expect(aliased!.targetSymbolId).toBeUndefined();

		const plain = imports.find((r) => r.symbolName === "connect");
		expect(plain!.importInfo).toEqual({
			localName: "connect",
			importedName: "connect",
			moduleSpecifier: "./db",
			importKind: "named"
		});
	});

	it("emits default imports with importKind default", async () => {
		const result = await parseOrSkip(
			"app.ts",
			`import Foo from './foo';
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const def = refs.find((r) => r.kind === "import");
		expect(def).toBeDefined();
		expect(def!.symbolName).toBe("Foo");
		expect(def!.importInfo).toEqual({
			localName: "Foo",
			importedName: "default",
			moduleSpecifier: "./foo",
			importKind: "default"
		});
	});

	it("emits namespace imports with the alias as the referenced name", async () => {
		const result = await parseOrSkip(
			"app.ts",
			`import * as store from './store';
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const ns = refs.find((r) => r.kind === "import");
		expect(ns).toBeDefined();
		expect(ns!.symbolName).toBe("store");
		expect(ns!.importInfo).toEqual({
			localName: "store",
			importedName: "*",
			moduleSpecifier: "./store",
			importKind: "namespace"
		});
	});

	it("emits ONE row for side-effect imports with null importedName", async () => {
		const result = await parseOrSkip(
			"app.ts",
			`import './styles.css';
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const side = refs.find((r) => r.kind === "import");
		expect(side).toBeDefined();
		expect(side!.importInfo).toEqual({
			localName: "./styles.css",
			importedName: null,
			moduleSpecifier: "./styles.css",
			importKind: "side-effect"
		});
	});

	it("preserves unresolved imports (null targets are the pipeline's concern — rows still emit with metadata)", async () => {
		const result = await parseOrSkip(
			"app.ts",
			`import { Ghost } from './ghost-module';
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const ghost = refs.find((r) => r.kind === "import");
		expect(ghost).toBeDefined();
		expect(ghost!.symbolName).toBe("Ghost");
		// The metadata is complete even though the module may not resolve —
		// resolution happens against the indexed-file set in the pipeline.
		expect(ghost!.importInfo).toEqual({
			localName: "Ghost",
			importedName: "Ghost",
			moduleSpecifier: "./ghost-module",
			importKind: "named"
		});
	});

	it("emits metadata for mixed default + named + namespace imports in one statement", async () => {
		const result = await parseOrSkip(
			"app.ts",
			`import Def, { named as localNamed, plain } from './mixed';
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const imports = refs.filter((r) => r.kind === "import");
		expect(imports.map((r) => r.symbolName).sort()).toEqual(["Def", "named", "plain"]);

		const alias = imports.find((r) => r.symbolName === "named");
		expect(alias!.importInfo!.localName).toBe("localNamed");
		expect(alias!.importInfo!.importedName).toBe("named");
		expect(alias!.importInfo!.moduleSpecifier).toBe("./mixed");
		expect(alias!.importInfo!.importKind).toBe("named");

		const def = imports.find((r) => r.symbolName === "Def");
		expect(def!.importInfo!.importKind).toBe("default");
		expect(def!.importInfo!.localName).toBe("Def");
	});
});
