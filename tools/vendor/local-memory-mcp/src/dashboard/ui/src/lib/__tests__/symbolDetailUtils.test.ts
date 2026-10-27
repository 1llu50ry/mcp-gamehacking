// ─── symbolDetailUtils — Phase 1.1 reference-kind helpers (TASK-314) ───────
// Pure functions only (grouping/labeling); no DOM, no network.
import { describe, it, expect } from "vitest";
import {
	KIND_ICONS,
	KIND_LABELS,
	REFERENCE_KIND_ORDER,
	isKnownRefKind,
	refKindKey,
	refKindLabel,
	otherRefKindLabels,
	groupRefsByKind,
	getKindIcon,
	groupRefsByFile,
	buildLocationText
} from "../symbolDetailUtils";

describe("Phase 1.1 reference edge kinds (TASK-314)", () => {
	it("maps all five reference edge kinds in KIND_ICONS/KIND_LABELS", () => {
		expect(REFERENCE_KIND_ORDER).toEqual(["call", "instantiation", "import", "extends", "implements"]);
		for (const kind of REFERENCE_KIND_ORDER) {
			expect(KIND_ICONS[kind]).toBeTruthy();
			expect(KIND_LABELS[kind]).toBeTruthy();
		}
	});

	it("isKnownRefKind accepts the five edge kinds and rejects unknown/absent", () => {
		for (const kind of REFERENCE_KIND_ORDER) expect(isKnownRefKind(kind)).toBe(true);
		expect(isKnownRefKind("mixin")).toBe(false);
		expect(isKnownRefKind(undefined)).toBe(false);
		expect(isKnownRefKind(null)).toBe(false);
		expect(isKnownRefKind("")).toBe(false);
	});

	it("refKindKey buckets unknown kinds into 'other' without losing raw kind", () => {
		expect(refKindKey("instantiation")).toBe("instantiation");
		expect(refKindKey("mixin")).toBe("other");
		expect(refKindKey(undefined)).toBe("other");
		expect(refKindKey(null)).toBe("other");
	});

	it("refKindLabel renders known labels and graceful other+raw fallback", () => {
		expect(refKindLabel("extends")).toBe("Extends");
		expect(refKindLabel("implements")).toBe("Implements");
		expect(refKindLabel("mixin")).toBe("Other · mixin");
		expect(refKindLabel(undefined)).toBe("Other");
		// Synthetic "other" bucket key renders plain "Other" — never `Other · other` (F2).
		expect(refKindLabel("other")).toBe("Other");
	});

	it("otherRefKindLabels surfaces distinct unknown raw kinds in first-seen order", () => {
		const refs = [{ kind: "call" }, { kind: "mixin" }, { kind: undefined }, { kind: "mixin" }, { kind: "adapter" }];
		expect(otherRefKindLabels(refs)).toEqual(["mixin", "adapter"]);
	});

	it("groupRefsByKind preserves REFERENCE_KIND_ORDER then 'other', dropping empty groups", () => {
		const refs = [
			{ kind: "extends", id: 1 },
			{ kind: "import", id: 2 },
			{ kind: undefined, id: 3 },
			{ kind: "mixin", id: 4 },
			{ kind: "call", id: 5 }
		];
		const groups = groupRefsByKind(refs);
		expect([...groups.keys()]).toEqual(["call", "import", "extends", "other"]);
		expect(groups.get("call")).toEqual([{ kind: "call", id: 5 }]);
		expect(groups.get("other")!.map((r) => r.id)).toEqual([3, 4]);
	});

	it("getKindIcon falls back to 'code' for unmapped kinds (graceful unknown rendering)", () => {
		expect(getKindIcon("extends")).toBe("arrow-right");
		expect(getKindIcon("method")).toBe("code");
	});
});

describe("groupRefsByFile / buildLocationText (existing behavior preserved)", () => {
	it("groups TraceReference-shaped objects by filePath", () => {
		const refs = [
			{ filePath: "a.ts", startLine: 1 },
			{ filePath: "b.ts", startLine: 2 },
			{ filePath: "a.ts", startLine: 3 }
		];
		const byFile = groupRefsByFile(refs);
		expect(byFile.size).toBe(2);
		expect(byFile.get("a.ts")!.map((r) => r.startLine)).toEqual([1, 3]);
	});

	it("buildLocationText keeps file:line:column semantics", () => {
		expect(buildLocationText("src/a.ts", 4, 2)).toBe("src/a.ts:4:2");
		expect(buildLocationText("src/a.ts", 4)).toBe("src/a.ts:4");
		expect(buildLocationText(undefined, 4)).toBeNull();
	});
});
