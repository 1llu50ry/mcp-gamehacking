import { performance } from "node:perf_hooks";

export const RUNTIME_PROFILES = ["minimal", "balanced", "full"] as const;
export type RuntimeProfile = (typeof RUNTIME_PROFILES)[number];

export const RUNTIME_CAPABILITIES = ["semantic", "indexing", "watcher", "maintenance", "dashboard"] as const;
export type RuntimeCapability = (typeof RUNTIME_CAPABILITIES)[number];
export type CapabilityState = "unavailable" | "idle" | "loading" | "ready" | "degraded" | "failed";

export interface CapabilitySnapshot {
	state: CapabilityState;
	loaded_at: string | null;
	duration_ms: number | null;
	error: string | null;
}

export interface RuntimeCapabilitySnapshot {
	profile: RuntimeProfile;
	capabilities: Record<RuntimeCapability, CapabilitySnapshot>;
	footprint: { rss_bytes: number; heap_used_bytes: number };
}

type CapabilityLoader = () => void | Promise<void>;
const PROFILE_CAPABILITIES: Record<RuntimeProfile, ReadonlySet<RuntimeCapability>> = {
	minimal: new Set(["dashboard"]),
	balanced: new Set(["semantic", "indexing", "dashboard"]),
	full: new Set(RUNTIME_CAPABILITIES)
};

export function resolveRuntimeProfile(value = process.env.MCP_RUNTIME_PROFILE): RuntimeProfile {
	return RUNTIME_PROFILES.includes(value as RuntimeProfile) ? (value as RuntimeProfile) : "full";
}

export class RuntimeCapabilityRegistry {
	readonly profile: RuntimeProfile;
	private readonly loaders = new Map<RuntimeCapability, CapabilityLoader>();
	private readonly inFlight = new Map<RuntimeCapability, Promise<boolean>>();
	private readonly status = new Map<RuntimeCapability, CapabilitySnapshot>();

	constructor(profile: RuntimeProfile = resolveRuntimeProfile()) {
		this.profile = profile;
		for (const capability of RUNTIME_CAPABILITIES) {
			this.status.set(capability, {
				state: PROFILE_CAPABILITIES[profile].has(capability) ? "idle" : "unavailable",
				loaded_at: null,
				duration_ms: null,
				error: null
			});
		}
	}

	register(capability: RuntimeCapability, loader: CapabilityLoader): void {
		if (!this.loaders.has(capability)) this.loaders.set(capability, loader);
	}

	unregister(capability: RuntimeCapability): void {
		this.loaders.delete(capability);
	}

	disable(capability: RuntimeCapability, reason: string): void {
		this.loaders.delete(capability);
		this.status.set(capability, {
			state: "unavailable",
			loaded_at: null,
			duration_ms: null,
			error: reason
		});
	}

	hasLoader(capability: RuntimeCapability): boolean {
		return this.loaders.has(capability);
	}

	isAvailable(capability: RuntimeCapability): boolean {
		return this.status.get(capability)?.state !== "unavailable";
	}

	async ensure(capability: RuntimeCapability): Promise<boolean> {
		const current = this.status.get(capability)!;
		if (current.state === "unavailable") return false;
		if (current.state === "ready") return true;
		if (current.state === "degraded") return false;
		const active = this.inFlight.get(capability);
		if (active) return active;
		const loader = this.loaders.get(capability);
		if (!loader) {
			this.status.set(capability, { ...current, state: "degraded", error: "No capability loader registered" });
			return false;
		}
		const started = performance.now();
		this.status.set(capability, { ...current, state: "loading", error: null });
		const loading = Promise.resolve()
			.then(loader)
			.then(() => {
				this.status.set(capability, {
					state: "ready",
					loaded_at: new Date().toISOString(),
					duration_ms: Math.round((performance.now() - started) * 100) / 100,
					error: null
				});
				return true;
			})
			.catch((error: unknown) => {
				this.status.set(capability, {
					state: "failed",
					loaded_at: null,
					duration_ms: Math.round((performance.now() - started) * 100) / 100,
					error: error instanceof Error ? error.message : String(error)
				});
				return false;
			})
			.finally(() => this.inFlight.delete(capability));
		this.inFlight.set(capability, loading);
		return loading;
	}

	async warmup(capabilities: readonly RuntimeCapability[]): Promise<RuntimeCapabilitySnapshot> {
		await Promise.all(capabilities.map((capability) => this.ensure(capability)));
		return this.snapshot();
	}

	reset(capability: RuntimeCapability): void {
		if (!this.isAvailable(capability)) return;
		this.status.set(capability, { state: "idle", loaded_at: null, duration_ms: null, error: null });
	}

	markReady(capability: RuntimeCapability): void {
		if (!this.isAvailable(capability)) return;
		this.status.set(capability, {
			state: "ready",
			loaded_at: new Date().toISOString(),
			duration_ms: 0,
			error: null
		});
	}

	markDegraded(capability: RuntimeCapability, reason: string): void {
		if (!this.isAvailable(capability)) return;
		const current = this.status.get(capability)!;
		this.status.set(capability, { ...current, state: "degraded", error: reason });
	}

	snapshot(): RuntimeCapabilitySnapshot {
		const memory = process.memoryUsage();
		return {
			profile: this.profile,
			capabilities: Object.fromEntries(
				RUNTIME_CAPABILITIES.map((capability) => [capability, { ...this.status.get(capability)! }])
			) as Record<RuntimeCapability, CapabilitySnapshot>,
			footprint: { rss_bytes: memory.rss, heap_used_bytes: memory.heapUsed }
		};
	}
}

let activeRegistry: RuntimeCapabilityRegistry | null = null;

export function getRuntimeCapabilities(): RuntimeCapabilityRegistry {
	activeRegistry ??= new RuntimeCapabilityRegistry();
	return activeRegistry;
}

export function setRuntimeCapabilities(registry: RuntimeCapabilityRegistry): void {
	activeRegistry = registry;
}

export function isSemanticToolDemand(toolName: string, args: Record<string, unknown>): boolean {
	if (["memory-write", "standard-write", "task-write"].includes(toolName)) return true;
	if (!["memory-read", "standard-read", "task-read", "agent-context"].includes(toolName)) return false;
	return typeof args.query === "string" || typeof args.objective === "string";
}
