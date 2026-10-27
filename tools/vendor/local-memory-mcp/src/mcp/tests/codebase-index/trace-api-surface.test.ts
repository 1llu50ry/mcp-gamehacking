import { describe, it, expect, beforeEach } from "vitest";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { createTestStore } from "../../storage/sqlite.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { VectorStore } from "../../types.js";
import { getPrimaryTextContent } from "../../utils/mcp-response.js";
import {
	buildApiSurface,
	formatApiSurface,
	isPrivateOrProtected,
	MAX_API_MEMBERS,
	type ApiMember
} from "../../tools/codebase-read/api-surface.js";

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

function seedSymbols(
	store: SQLiteStore,
	symbols: Array<{
		id?: string;
		repo: string;
		file_path: string;
		name: string;
		kind: string;
		exported?: boolean;
		default_export?: boolean;
		start_line?: number;
		start_col?: number;
		end_line?: number;
		end_col?: number;
		doc_comment?: string;
		signature?: string;
		parent_symbol_id?: string;
	}>
): void {
	store.codebaseSymbols.bulkUpsertSymbols(symbols);
}

function seedRefs(
	store: SQLiteStore,
	repo: string,
	refs: Array<{
		symbol_name: string;
		caller_file: string;
		caller_line?: number | null;
		caller_name?: string | null;
		kind: string;
		target_symbol_id?: string | null;
		target_file?: string | null;
	}>
): void {
	store.codebaseReferences.bulkUpsertReferences(
		repo,
		refs.map((r) => ({
			repo,
			symbol_name: r.symbol_name,
			caller_file: r.caller_file,
			caller_line: r.caller_line ?? 1,
			caller_name: r.caller_name ?? null,
			kind: r.kind,
			target_symbol_id: r.target_symbol_id ?? null,
			target_file: r.target_file ?? null
		}))
	);
}

describe("TRACE view:'api' — public API surface (issue #86 / TASK-012)", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;
	const repo = "test-repo";

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
	});

	it("returns public method signatures without bodies for a class", async () => {
		seedSymbols(store, [
			{
				id: "order-1",
				repo,
				file_path: "src/services/order.service.ts",
				name: "OrderService",
				kind: "class",
				exported: true,
				start_line: 1,
				signature: "class OrderService {"
			},
			{
				repo,
				file_path: "src/services/order.service.ts",
				name: "create",
				kind: "method",
				start_line: 10,
				signature: "public create(dto: CreateOrderDto): Promise<OrderResponseDto>",
				parent_symbol_id: "order-1"
			},
			{
				repo,
				file_path: "src/services/order.service.ts",
				name: "approve",
				kind: "method",
				start_line: 15,
				signature: "approve(id: string): Promise<void>",
				parent_symbol_id: "order-1"
			},
			{
				repo,
				file_path: "src/services/order.service.ts",
				name: "cancel",
				kind: "method",
				start_line: 20,
				signature: "cancel(id: string): Promise<void>",
				parent_symbol_id: "order-1"
			}
		]);

		const response = await handleCodebaseRead(
			{ name: "OrderService", repo, owner: "vheins", json: true, view: "api" },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		expect(data.error).toBeUndefined();

		const surface = data.apiSurface as Record<string, unknown>;
		expect(surface).toBeDefined();
		expect(surface.kind).toBe("class");
		expect(surface.container).toBe(true);

		const members = surface.members as ApiMember[];
		expect(members.map((m) => m.name).sort()).toEqual(["approve", "cancel", "create"]);
		// No method bodies — only signatures, trailing `;`.
		expect(getPrimaryTextContent(response)).toMatch(/create\(dto: CreateOrderDto\): Promise<OrderResponseDto>;/);
		expect(getPrimaryTextContent(response)).not.toMatch(/\{[\s\S]*return[\s\S]*\}/); // no body
		// `public` keyword stripped from rendered signature.
		expect(getPrimaryTextContent(response)).not.toMatch(/public create/);
	});

	it("returns declared members for an interface", async () => {
		seedSymbols(store, [
			{
				id: "pay-1",
				repo,
				file_path: "src/services/payment.ts",
				name: "PaymentGateway",
				kind: "interface",
				exported: true,
				start_line: 1,
				signature: "interface PaymentGateway {"
			},
			{
				repo,
				file_path: "src/services/payment.ts",
				name: "charge",
				kind: "method",
				start_line: 5,
				signature: "charge(amount: number): Promise<boolean>",
				parent_symbol_id: "pay-1"
			},
			{
				repo,
				file_path: "src/services/payment.ts",
				name: "refund",
				kind: "method",
				start_line: 8,
				signature: "refund(tx: string): Promise<void>",
				parent_symbol_id: "pay-1"
			}
		]);

		const response = await handleCodebaseRead(
			{ name: "PaymentGateway", repo, owner: "vheins", json: true, view: "api" },
			store,
			vectors
		);
		const surface = (response.structuredContent as Record<string, unknown>).apiSurface as Record<string, unknown>;
		expect(surface.kind).toBe("interface");
		const members = surface.members as ApiMember[];
		expect(members.map((m) => m.name).sort()).toEqual(["charge", "refund"]);
	});

	it("includes inherited public members from extends edges", async () => {
		seedSymbols(store, [
			{
				id: "base-1",
				repo,
				file_path: "src/services/base.service.ts",
				name: "BaseService",
				kind: "class",
				start_line: 1,
				signature: "class BaseService {"
			},
			{
				repo,
				file_path: "src/services/base.service.ts",
				name: "basePublic",
				kind: "method",
				start_line: 3,
				signature: "public basePublic(): void",
				parent_symbol_id: "base-1"
			},
			{
				repo,
				file_path: "src/services/base.service.ts",
				name: "baseSecret",
				kind: "method",
				start_line: 6,
				signature: "private baseSecret(): void",
				parent_symbol_id: "base-1"
			},
			{
				id: "order-1",
				repo,
				file_path: "src/services/order.service.ts",
				name: "OrderService",
				kind: "class",
				exported: true,
				start_line: 1,
				signature: "class OrderService extends BaseService {"
			},
			{
				repo,
				file_path: "src/services/order.service.ts",
				name: "create",
				kind: "method",
				start_line: 10,
				signature: "public create(): void",
				parent_symbol_id: "order-1"
			}
		]);
		seedRefs(store, repo, [
			{
				symbol_name: "BaseService",
				caller_file: "src/services/order.service.ts",
				caller_name: "OrderService",
				kind: "extends",
				target_symbol_id: "base-1",
				target_file: "src/services/base.service.ts"
			}
		]);

		const response = await handleCodebaseRead(
			{ name: "OrderService", repo, owner: "vheins", json: true, view: "api" },
			store,
			vectors
		);
		const members = ((response.structuredContent as Record<string, unknown>).apiSurface as Record<string, unknown>)
			.members as ApiMember[];
		const names = members.map((m) => m.name);
		expect(names).toContain("create"); // own public
		expect(names).toContain("basePublic"); // inherited public
		expect(names).not.toContain("baseSecret"); // inherited private excluded
		// Inherited member flagged + navigable.
		const inherited = members.find((m) => m.name === "basePublic")!;
		expect(inherited.inherited).toBe(true);
		expect(inherited.file).toBe("src/services/base.service.ts");
		expect(inherited.line).toBe(3);
	});

	it("excludes private/protected members when accessibility metadata is available", async () => {
		seedSymbols(store, [
			{
				id: "svc-1",
				repo,
				file_path: "src/services/svc.ts",
				name: "Secretive",
				kind: "class",
				start_line: 1,
				signature: "class Secretive {"
			},
			{
				repo,
				file_path: "src/services/svc.ts",
				name: "publicApi",
				kind: "method",
				start_line: 5,
				signature: "public publicApi(): void",
				parent_symbol_id: "svc-1"
			},
			{
				repo,
				file_path: "src/services/svc.ts",
				name: "secret",
				kind: "method",
				start_line: 8,
				signature: "private secret(): string",
				parent_symbol_id: "svc-1"
			},
			{
				repo,
				file_path: "src/services/svc.ts",
				name: "reset",
				kind: "method",
				start_line: 11,
				signature: "protected reset(): void",
				parent_symbol_id: "svc-1"
			},
			{
				repo,
				file_path: "src/services/svc.ts",
				name: "hash",
				kind: "method",
				start_line: 14,
				signature: "private readonly hash(input: string): string",
				parent_symbol_id: "svc-1"
			},
			{
				repo,
				file_path: "src/services/svc.ts",
				name: "token",
				kind: "property",
				start_line: 17,
				signature: "#token: string",
				parent_symbol_id: "svc-1"
			}
		]);

		const response = await handleCodebaseRead(
			{ name: "Secretive", repo, owner: "vheins", json: true, view: "api" },
			store,
			vectors
		);
		const members = ((response.structuredContent as Record<string, unknown>).apiSurface as Record<string, unknown>)
			.members as ApiMember[];
		const names = members.map((m) => m.name);
		expect(names).toEqual(["publicApi"]);
		expect(names).not.toContain("secret");
		expect(names).not.toContain("reset");
		expect(names).not.toContain("hash");
		expect(names).not.toContain("token");
	});

	it("is deterministic and bounded, preserving navigable metadata", async () => {
		// Build a class with more members than the cap.
		const many = Array.from({ length: MAX_API_MEMBERS + 25 }, (_, i) => ({
			repo,
			file_path: "src/services/wide.ts",
			name: `m${i}`,
			kind: "method",
			start_line: 10 + i,
			signature: `public m${i}(x: number): void`,
			parent_symbol_id: "wide-1"
		}));
		seedSymbols(store, [
			{
				id: "wide-1",
				repo,
				file_path: "src/services/wide.ts",
				name: "WideService",
				kind: "class",
				start_line: 1,
				signature: "class WideService {"
			},
			...many
		]);

		const run = async () => {
			const r = await handleCodebaseRead(
				{ name: "WideService", repo, owner: "vheins", json: true, view: "api" },
				store,
				vectors
			);
			return (r.structuredContent as Record<string, unknown>).apiSurface as Record<string, unknown>;
		};
		const a = await run();
		const b = await run();
		// Deterministic: identical member set across runs.
		expect(a.members).toEqual(b.members);
		// Bounded: capped at MAX_API_MEMBERS, truncated flag set.
		expect((a.members as ApiMember[]).length).toBe(MAX_API_MEMBERS);
		expect(a.truncated).toBe(true);
		// Navigable metadata preserved on every exposed member.
		for (const m of a.members as ApiMember[]) {
			expect(m.file).toBe("src/services/wide.ts");
			expect(typeof m.line).toBe("number");
			expect(m.signature).toMatch(/^m\d+\(x: number\): void;$/);
		}
	});

	it("leaves legacy TRACE output unchanged when view is omitted", async () => {
		seedSymbols(store, [
			{
				id: "order-1",
				repo,
				file_path: "src/services/order.service.ts",
				name: "OrderService",
				kind: "class",
				exported: true,
				start_line: 1,
				signature: "class OrderService {"
			},
			{
				repo,
				file_path: "src/services/order.service.ts",
				name: "create",
				kind: "method",
				start_line: 10,
				signature: "public create(): void",
				parent_symbol_id: "order-1"
			}
		]);

		const omit = await handleCodebaseRead({ name: "OrderService", repo, owner: "vheins", json: true }, store, vectors);
		const def = await handleCodebaseRead(
			{ name: "OrderService", repo, owner: "vheins", json: true, view: "default" },
			store,
			vectors
		);

		// No apiSurface key in either legacy path.
		expect((omit.structuredContent as Record<string, unknown>).apiSurface).toBeUndefined();
		expect((def.structuredContent as Record<string, unknown>).apiSurface).toBeUndefined();
		// Definition + children still present (unchanged behavior).
		const oData = omit.structuredContent as Record<string, unknown>;
		expect(oData.definition).toEqual({
			file: "src/services/order.service.ts",
			line: 1,
			column: 0,
			endLine: 1,
			endColumn: 0
		});
		expect((oData.children as ApiMember[]).map((c) => c.name)).toContain("create");
	});
});

describe("buildApiSurface / formatApiSurface (pure unit)", () => {
	const repo = "u";

	const sym = (
		over: Partial<{
			id: string;
			name: string;
			kind: string;
			file_path: string;
			start_line: number | null;
			signature: string | null;
			parent_symbol_id: string | null;
		}>
	): any => ({
		id: "x",
		repo,
		name: "X",
		kind: "class",
		file_path: "f.ts",
		start_line: 1,
		start_col: 0,
		end_line: 1,
		end_col: 0,
		signature: null,
		doc_comment: null,
		exported: false,
		default_export: false,
		created_at: "",
		updated_at: "",
		...over
	});

	it("isPrivateOrProtected detects private/protected/# but not name collisions", () => {
		expect(isPrivateOrProtected("private secret(): void")).toBe(true);
		expect(isPrivateOrProtected("protected reset(): void")).toBe(true);
		expect(isPrivateOrProtected("#token: string")).toBe(true);
		expect(isPrivateOrProtected("private readonly hash(): void")).toBe(true);
		expect(isPrivateOrProtected("public api(): void")).toBe(false);
		expect(isPrivateOrProtected("readonly apiKey: string")).toBe(false);
		expect(isPrivateOrProtected("privateKey: string")).toBe(false); // name, not modifier
		expect(isPrivateOrProtected("protectedField: string")).toBe(false);
		expect(isPrivateOrProtected(null)).toBe(false); // fail-open: public
	});

	it("renders a block with public signatures and strips accessibility keyword", () => {
		const surface = buildApiSurface(
			sym({ id: "c1", name: "OrderService", kind: "class", signature: "class OrderService {" }),
			[
				sym({
					id: "m1",
					name: "create",
					kind: "method",
					file_path: "s.ts",
					start_line: 10,
					signature: "public create(): void",
					parent_symbol_id: "c1"
				}),
				sym({
					id: "m2",
					name: "approve",
					kind: "method",
					file_path: "s.ts",
					start_line: 15,
					signature: "approve(id: string): void",
					parent_symbol_id: "c1"
				}),
				sym({
					id: "m3",
					name: "secret",
					kind: "method",
					file_path: "s.ts",
					start_line: 20,
					signature: "private secret(): void",
					parent_symbol_id: "c1"
				})
			],
			[],
			[]
		);
		expect(surface.kind).toBe("class");
		expect(surface.members.map((m) => m.name)).toEqual(["create", "approve"]);
		const text = formatApiSurface(surface);
		expect(text).toMatch(/^class OrderService \{\n/);
		expect(text).toContain("  create(): void;");
		expect(text).toContain("  approve(id: string): void;");
		expect(text).toMatch(/\n\}$/);
		expect(text).not.toContain("private");
	});

	it("falls back to a single signature line for non-container kinds", () => {
		const surface = buildApiSurface(
			sym({
				id: "f1",
				name: "authenticate",
				kind: "function",
				signature: "function authenticate(token: string): User"
			}),
			[],
			[],
			[]
		);
		expect(surface.container).toBe(false);
		expect(formatApiSurface(surface)).toBe("function authenticate(token: string): User");
	});
});
