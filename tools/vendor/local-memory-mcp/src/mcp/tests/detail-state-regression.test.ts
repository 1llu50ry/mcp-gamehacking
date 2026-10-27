import { describe, it, expect } from "vitest";
import { createDetailHandler } from "../../dashboard/ui/src/lib/composables/useDetail";
import { get } from "svelte/store";

describe("Detail drawer mode isolation", () => {
	it("setStandard should produce mode=standard, not handoff", () => {
		const handler = createDetailHandler();
		const state = get({ subscribe: handler.subscribe });

		expect(state.standard).toBeNull();
		expect(state.handoff).toBeNull();

		handler.setStandard({
			id: "std-1",
			title: "Test Standard",
			content: "Some content",
			context: "testing",
			version: "1.0.0",
			language: null,
			stack: [],
			tags: ["test"],
			is_global: false,
			repo: null,
			parent_id: null,
			metadata: {},
			created_at: "",
			updated_at: "",
			hit_count: 0,
			last_used_at: null,
			agent: "",
			model: ""
		});

		const mode = get(handler.mode);
		const after = get({ subscribe: handler.subscribe });

		expect(mode).toBe("standard");
		expect(after.standard).not.toBeNull();
		expect(after.handoff).toBeNull();
	});

	it("setHandoff(null) must NOT create a phantom __new__ handoff", () => {
		const handler = createDetailHandler();

		handler.setHandoff(null);

		const state = get({ subscribe: handler.subscribe });
		expect(state.handoff).toBeNull();
	});

	it("initNewHandoff should create a __new__ handoff with the given repo", () => {
		const handler = createDetailHandler();

		handler.initNewHandoff("test-repo");

		const mode = get(handler.mode);
		const state = get({ subscribe: handler.subscribe });

		expect(mode).toBe("handoff");
		expect(state.handoff).not.toBeNull();
		expect(state.handoff!.id).toBe("__new__");
		expect(state.handoff!.repo).toBe("test-repo");
		expect(state.standard).toBeNull();
		expect(state.task).toBeNull();
		expect(state.memory).toBeNull();
	});

	it("reset should clear all entities including handoff", () => {
		const handler = createDetailHandler();

		handler.initNewHandoff("my-repo");
		handler.reset();

		const state = get({ subscribe: handler.subscribe });
		expect(state.handoff).toBeNull();
		expect(state.standard).toBeNull();
		expect(state.task).toBeNull();
		expect(state.memory).toBeNull();
	});

	it("setStandard with existing standard should not affect handoff state", () => {
		const handler = createDetailHandler();

		handler.initNewHandoff("other-repo");
		const before = get({ subscribe: handler.subscribe });
		expect(before.handoff).not.toBeNull();

		handler.setStandard({
			id: "std-2",
			title: "Another",
			content: "Stuff",
			context: "code",
			version: "2.0.0",
			language: null,
			stack: [],
			tags: [],
			is_global: true,
			repo: null,
			parent_id: null,
			metadata: {},
			created_at: "",
			updated_at: "",
			hit_count: 0,
			last_used_at: null,
			agent: "",
			model: ""
		});

		const after = get({ subscribe: handler.subscribe });
		expect(after.standard).not.toBeNull();
		expect(after.handoff).toBeNull();
	});

	it("setting memory then standard does not mix state", () => {
		const handler = createDetailHandler();

		handler.setMemory({
			id: "mem-1",
			type: "decision",
			title: "Test Memory",
			content: "Content",
			importance: 3,
			scope: { repo: "test" },
			tags: [],
			metadata: {},
			created_at: "",
			updated_at: "",
			hit_count: 0
		});

		let mode = get(handler.mode);
		expect(mode).toBe("memory");

		handler.setStandard({
			id: "std-3",
			title: "Final",
			content: "Rules",
			context: "general",
			version: "1.0.0",
			language: null,
			stack: [],
			tags: [],
			is_global: false,
			repo: null,
			parent_id: null,
			metadata: {},
			created_at: "",
			updated_at: "",
			hit_count: 0,
			last_used_at: null,
			agent: "",
			model: ""
		});

		mode = get(handler.mode);
		expect(mode).toBe("standard");
		expect(get({ subscribe: handler.subscribe }).memory).toBeNull();
	});

	it("mode derived store returns null when no entity is set", () => {
		const handler = createDetailHandler();
		const mode = get(handler.mode);
		expect(mode).toBeNull();
	});
});
