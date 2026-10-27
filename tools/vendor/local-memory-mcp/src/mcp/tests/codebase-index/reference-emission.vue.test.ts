import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("VueVisitor reference emission (TASK-312)", () => {
	it("emits import edges per binding inside <script setup> and <script> blocks", async () => {
		const result = await parseOrSkip(
			"vue-component.vue",
			`<template>
  <div>
    <MyComponent :prop="x" />
    <base-button @click="go">Go</base-button>
    <span>{{ msg }}</span>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue'
import MyComponent from './components/MyComponent.vue'
import * as store from './store'
import type { Foo, Bar as Baz } from './types'
import './styles.css'
import Def, { named } from './mixed'
const msg = ref('hello')
const dynamic = import('./lazy')
</script>

<script>
import LegacyThing from './legacy'
export default {
  name: 'Plain'
}
</script>

<style scoped>
.red { color: red; }
</style>
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
		const names = imports.map((r) => `${r.symbolName}@${r.callerLine}`);
		// Named imports (single line) inside <script setup>.
		expect(names).toContain("ref@10");
		expect(names).toContain("computed@10");
		// Default import — the binding name is the reference, not the module path.
		expect(names).toContain("MyComponent@11");
		// Namespace import resolves to the alias (`* as store` → 'store').
		expect(names).toContain("store@12");
		// Type-only import: imported name wins over the `as` alias (TS emitImports
		// semantics — `Bar as Baz` → 'Bar').
		expect(names).toContain("Foo@13");
		expect(names).toContain("Bar@13");
		// Mixed default + named in one statement.
		expect(names).toContain("Def@15");
		expect(names).toContain("named@15");
		// A second plain <script> block is scanned too.
		expect(names).toContain("LegacyThing@21");

		// Side-effect imports (`import './styles.css'`) carry no binding → ONE
		// row with null importedName (issue #83: imports stay VISIBLE, never
		// dropped); dynamic `import('./lazy')` is not an import statement → no
		// edge; the `const msg = ref(...)` line never produces an import edge.
		const sideEffect = imports.find((r) => r.symbolName === "./styles.css");
		expect(sideEffect).toBeDefined();
		expect(sideEffect!.importInfo).toEqual({
			localName: "./styles.css",
			importedName: null,
			moduleSpecifier: "./styles.css",
			importKind: "side-effect"
		});
		expect(names).not.toContain("lazy");
		// Only the side-effect row may live on line 14 (its own statement).
		expect(imports.filter((r) => r.callerLine === 14 && r.symbolName !== "./styles.css")).toHaveLength(0);

		// Import metadata is emitted per binding (issue #83): default vs named
		// vs namespace forms are attributed on the edge.
		const myComp = imports.find((r) => r.symbolName === "MyComponent");
		expect(myComp!.importInfo!.importKind).toBe("default");
		expect(myComp!.importInfo!.moduleSpecifier).toBe("./components/MyComponent.vue");
		const storeNs = imports.find((r) => r.symbolName === "store");
		expect(storeNs!.importInfo!.importKind).toBe("namespace");
		const refBinding = imports.find((r) => r.symbolName === "ref");
		expect(refBinding!.importInfo!.importKind).toBe("named");
		// Aliased named binding: imported name wins, local alias recorded.
		const barBinding = imports.find((r) => r.symbolName === "Bar");
		expect(barBinding!.importInfo!.localName).toBe("Baz");
		expect(barBinding!.importInfo!.importedName).toBe("Bar");

		// Imports are file-scope: callerName null; the pool fills callerFile;
		// targets are explicit null (canonical TASK-347 pattern).
		const first = imports[0];
		expect(first!.callerName).toBeNull();
		expect(first!.callerFile).toBe("vue-component.vue");
		expect(first!.targetFile).toBeNull();
		expect(first!.targetSymbolId).toBeNull();
	});

	it("emits instantiation edges for template component tags, skipping native elements", async () => {
		const result = await parseOrSkip(
			"vue-template.vue",
			`<template>
  <div>
    <MyComponent :prop="x" />
    <base-button @click="go">Go</base-button>
    <span>{{ msg }}</span>
    <div>
      <NestedComp />
    </div>
    <keep-alive>
      <router-view />
    </keep-alive>
  </div>
</template>

<script setup lang="ts">
const msg = ref('hello')
</script>
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const insts = refs.filter((r) => r.kind === "instantiation");
		const names = insts.map((r) => `${r.symbolName}@${r.callerLine}`);
		// PascalCase component tag.
		expect(names).toContain("MyComponent@3");
		// kebab-case component tag.
		expect(names).toContain("base-button@4");
		// Nested component inside a nested native element.
		expect(names).toContain("NestedComp@7");
		// Vue built-in kebab-case components are usages too (harmless dangling
		// name-based edges).
		expect(names).toContain("keep-alive@9");
		expect(names).toContain("router-view@10");

		// Native elements (`div`, `span`) emit nothing.
		expect(names.some((n) => n.startsWith("div") || n.startsWith("span"))).toBe(false);

		// Template usage has no enclosing function: callerName null.
		const comp = insts.find((r) => r.symbolName === "MyComponent");
		expect(comp).toBeDefined();
		expect(comp!.callerName).toBeNull();
		expect(comp!.callerFile).toBe("vue-template.vue");
		expect(comp!.targetFile).toBeNull();
		expect(comp!.targetSymbolId).toBeNull();
	});

	it("emits nothing for native-only templates or script-less SFCs", async () => {
		const result = await parseOrSkip(
			"vue-native.vue",
			`<template>
  <div>
    <span>plain text</span>
    <section>
      <p>hello</p>
    </section>
  </div>
</template>

<style scoped>
.red { color: red; }
</style>
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		// No script block → no import edges; all-lowercase native tags → no
		// instantiation edges; no heritage/call kinds anywhere in a Vue SFC.
		expect(refs).toHaveLength(0);
	});

	it("recurses into <template> wrappers (slot/v-if) emitting nested component instantiations", async () => {
		const result = await parseOrSkip(
			"vue-template-wrappers.vue",
			`<template>
  <div>
    <template #header>
      <MySlotComp />
    </template>
    <template v-if="ok">
      <VIfComp />
    </template>
  </div>
</template>
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		// The grammar's `_node` includes `template_element`, so `<template
		// #header>` / `<template v-if>` wrappers are NOT `element` nodes —
		// walkTemplate must recurse into them or these components stay silent
		// (review FIX-1). Each nested component instantiation edge anchors at
		// its own tag line.
		const refs = result.references ?? [];
		const insts = refs.filter((r) => r.kind === "instantiation");
		const names = insts.map((r) => `${r.symbolName}@${r.callerLine}`);
		expect(names).toContain("MySlotComp@4");
		expect(names).toContain("VIfComp@7");
		// The `template` wrapper itself emits nothing (lowercase built-in tag).
		expect(names.some((n) => n.startsWith("template"))).toBe(false);
	});

	it("pins callerLine for multi-line named imports and type-default imports", async () => {
		const result = await parseOrSkip(
			"vue-script-imports.vue",
			`<script lang="ts" setup>
import {
  namedA,
  namedB
} from './mod'
import type Foo from './types'
</script>
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
		const names = imports.map((r) => `${r.symbolName}@${r.callerLine}`);
		// Multi-line named import: BOTH bindings anchor at the statement's
		// start line (the negative-lookahead + brace-split is the most
		// failure-prone part of SCRIPT_IMPORT_RE — review FIX-4).
		expect(names).toContain("namedA@2");
		expect(names).toContain("namedB@2");
		// `import type Foo from './types'` — type modifier + default binding →
		// one edge for the binding (type stripped by the regex).
		expect(names).toContain("Foo@6");

		// FIX-3: no garbage rows — a `{\n` fragment (comment/truncation shape)
		// is not a valid identifier, so it must never reach symbol_name.
		expect(imports.some((r) => r.symbolName.includes("{") || r.symbolName.includes("\n"))).toBe(false);
		expect(imports.some((r) => r.symbolName === "default")).toBe(false);
	});

	it("emits no import edge for template-literal import lookalikes not at a line start", async () => {
		const result = await parseOrSkip(
			"vue-string-context.vue",
			`<script lang="ts">
const snippet = \`sql example: import fake from './fake.sql'\`
</script>
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		// SCRIPT_IMPORT_RE is line-anchored: mid-line import-looking text
		// inside a template literal does NOT match → zero edges. (A line-START
		// `import` inside a template literal remains an accepted false
		// positive — documented in the SCRIPT_IMPORT_RE JSDoc; a TS-grammar
		// re-parse is out of scope per the TASK-312 constraints. Review FIX-4.)
		const refs = result.references ?? [];
		expect(refs).toHaveLength(0);
	});
});
