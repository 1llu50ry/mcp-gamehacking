import { describe, it, expect } from "vitest";
import { condenseRecentActions, RecentAction } from "../lib/helpers";

describe("condenseRecentActions", () => {
	const baseAction: RecentAction = {
		id: 1,
		action: "test_action",
		created_at: new Date("2024-05-20T10:00:00.000Z").toISOString()
	};

	it("returns an empty array when given an empty array", () => {
		expect(condenseRecentActions([], 10)).toEqual([]);
	});

	it("returns the same array with burstCount 1 when no actions should be condensed", () => {
		const actions: RecentAction[] = [
			{ ...baseAction, id: 1, action: "action_1" },
			{ ...baseAction, id: 2, action: "action_2" }
		];
		const result = condenseRecentActions(actions, 10);
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({ ...actions[0], burstCount: 1 });
		expect(result[1]).toEqual({ ...actions[1], burstCount: 1 });
	});

	it("condenses identical actions within 10 minutes and increments burstCount", () => {
		const actions: RecentAction[] = [
			{ ...baseAction, id: 1 },
			{ ...baseAction, id: 2, created_at: new Date("2024-05-20T10:05:00.000Z").toISOString() },
			{ ...baseAction, id: 3, created_at: new Date("2024-05-20T10:09:00.000Z").toISOString() }
		];
		const result = condenseRecentActions(actions, 10);
		expect(result).toHaveLength(1);
		expect(result[0].burstCount).toBe(3);
		expect(result[0].created_at).toBe(actions[2].created_at);
		expect(result[0].id).toBe(1); // keeps the id of the first action in the burst
	});

	it("does not condense identical actions if they are more than 10 minutes apart", () => {
		const actions: RecentAction[] = [
			{ ...baseAction, id: 1 },
			{ ...baseAction, id: 2, created_at: new Date("2024-05-20T10:11:00.000Z").toISOString() }
		];
		const result = condenseRecentActions(actions, 10);
		expect(result).toHaveLength(2);
		expect(result[0].burstCount).toBe(1);
		expect(result[1].burstCount).toBe(1);
	});

	it("does not condense actions with different action, query, or memory_id even if within 10 minutes", () => {
		const actions: RecentAction[] = [
			{ ...baseAction, id: 1, action: "action_1", query: "q1", memory_id: "m1" },
			{
				...baseAction,
				id: 2,
				action: "action_2",
				query: "q1",
				memory_id: "m1",
				created_at: new Date("2024-05-20T10:05:00.000Z").toISOString()
			}, // diff action
			{
				...baseAction,
				id: 3,
				action: "action_2",
				query: "q2",
				memory_id: "m1",
				created_at: new Date("2024-05-20T10:06:00.000Z").toISOString()
			}, // diff query
			{
				...baseAction,
				id: 4,
				action: "action_2",
				query: "q2",
				memory_id: "m2",
				created_at: new Date("2024-05-20T10:07:00.000Z").toISOString()
			} // diff memory_id
		];
		const result = condenseRecentActions(actions, 10);
		expect(result).toHaveLength(4);
		result.forEach((res) => expect(res.burstCount).toBe(1));
	});

	it("slices the result to the specified limit", () => {
		const actions: RecentAction[] = Array.from({ length: 5 }, (_, i) => ({
			...baseAction,
			id: i,
			action: `action_${i}` // ensure they don't condense
		}));
		const result = condenseRecentActions(actions, 3);
		expect(result).toHaveLength(3);
		expect(result.map((r) => r.id)).toEqual([0, 1, 2]);
	});

	it("condenses correctly with undefined query/memory_id", () => {
		const actions: RecentAction[] = [
			{ ...baseAction, id: 1, query: undefined, memory_id: undefined },
			{
				...baseAction,
				id: 2,
				query: undefined,
				memory_id: undefined,
				created_at: new Date("2024-05-20T10:05:00.000Z").toISOString()
			}
		];
		const result = condenseRecentActions(actions, 10);
		expect(result).toHaveLength(1);
		expect(result[0].burstCount).toBe(2);
	});
});
