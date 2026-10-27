// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount, unmount } from "svelte";
import ArenaLegend from "../ArenaLegend.svelte";
import { getArenaLayoutManager } from "../../lib/arena/arena-layout/ArenaLayoutManager";

// Legacy zone labels that must no longer appear anywhere in the legend.
const LEGACY_LABELS = ["Lobby", "Inbox", "Workspace", "Issues", "Done"];

/** Normalize a #rrggbb registry color to the rgb(...) form jsdom reports. */
function hexToRgb(hex: string): string {
	const m = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!m) return hex;
	const r = parseInt(m[1].slice(0, 2), 16);
	const g = parseInt(m[1].slice(2, 4), 16);
	const b = parseInt(m[1].slice(4, 6), 16);
	return `rgb(${r}, ${g}, ${b})`;
}

describe("ArenaLegend", () => {
	it("exports a valid Svelte component", () => {
		expect(ArenaLegend).toBeDefined();
		expect(typeof ArenaLegend).toBe("function");
	});

	it("renders exactly the 5 manager sections with registry labels + colors", () => {
		// The layout manager is the single source of truth for the 5 sections
		// (STD-001) — the legend must render exactly what the registry owns.
		const manager = getArenaLayoutManager();
		const sections = manager.getDefinitions();
		expect(sections.length).toBe(5);
		expect(sections.map((s) => s.id).sort()).toEqual(["backlog", "blocked", "in_progress", "pending", "recovery"]);

		const target = document.createElement("div");
		const component = mount(ArenaLegend, { target });

		const rows = target.querySelectorAll(".legend-row");
		expect(rows.length).toBe(2);

		const swatches = rows[0].querySelectorAll(".legend-item");
		expect(swatches.length).toBe(5);

		const rendered = Array.from(swatches).map((item) => ({
			label: (item.textContent ?? "").trim(),
			dotColor: (item.querySelector(".lg-dot") as HTMLElement | null)?.style.backgroundColor ?? ""
		}));

		// Registry order + labels + colors flow straight into the swatches.
		expect(rendered.map((r) => r.label)).toEqual(sections.map((s) => s.label));
		for (let i = 0; i < sections.length; i++) {
			expect(rendered[i].dotColor).toBe(hexToRgb(sections[i].color));
		}
		unmount(component);
	});

	it("does not render legacy zone labels", () => {
		const target = document.createElement("div");
		const component = mount(ArenaLegend, { target });
		const text = target.textContent ?? "";
		for (const legacy of LEGACY_LABELS) {
			expect(text).not.toContain(legacy);
		}
		unmount(component);
	});

	it("still renders the secondary row (Working agent / Handoff beam / Claim link)", () => {
		const target = document.createElement("div");
		const component = mount(ArenaLegend, { target });
		const rows = target.querySelectorAll(".legend-row");
		expect(rows.length).toBe(2);

		const secondary = rows[1].textContent ?? "";
		expect(secondary).toContain("Working agent");
		expect(secondary).toContain("Handoff beam");
		expect(secondary).toContain("Claim link");

		// Each secondary entry carries its visual marker.
		const bubbles = rows[1].querySelectorAll(".lg-bubble");
		const dashes = rows[1].querySelectorAll(".lg-dash");
		expect(bubbles.length).toBe(1);
		expect(dashes.length).toBe(2);
		unmount(component);
	});
});
