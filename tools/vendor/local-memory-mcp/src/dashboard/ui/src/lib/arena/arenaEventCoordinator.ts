import type { DomainEvent } from "./arenaEvents";
import { arenaStateManager } from "./arenaStateManager";
import { writable, type Writable } from "svelte/store";
import { createVisibilityPoller } from "./createVisibilityPoller";

export type EventStreamStatus = "connected" | "disconnected" | "connecting" | "error";

interface EventCoordinatorOptions {
	fallbackPollInterval?: number; // ms, default 2500
	maxBufferSize?: number; // max events in buffer, default 100
	batchInterval?: number; // ms, default 100 (coalesce rapid events)
}

export class EventCoordinator {
	private status: Writable<EventStreamStatus>;
	private eventSource: EventSource | null = null;
	private eventBuffer: DomainEvent[] = [];
	private batchTimer: ReturnType<typeof setTimeout> | null = null;
	private options: Required<EventCoordinatorOptions>;
	private fallbackFetch: (() => Promise<void>) | null = null;
	private poller: { start(): void; stop(): void } | null = null;

	constructor(options: EventCoordinatorOptions = {}) {
		this.options = {
			fallbackPollInterval: options.fallbackPollInterval ?? 2500,
			maxBufferSize: options.maxBufferSize ?? 100,
			batchInterval: options.batchInterval ?? 100
		};
		this.status = writable("disconnected");
	}

	getStatus(): Writable<EventStreamStatus> {
		return this.status;
	}

	// Connect to SSE event stream
	async connect(eventStreamUrl: string): Promise<void> {
		this.status.set("connecting");

		try {
			this.eventSource = new EventSource(eventStreamUrl);

			this.eventSource.onopen = () => {
				this.status.set("connected");
				this.stopFallbackPolling();
			};

			this.eventSource.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					this.receiveEvent(this.normalizeEvent(data));
				} catch (e) {
					console.warn("[EventCoordinator] Failed to parse event:", e);
				}
			};

			this.eventSource.onerror = () => {
				this.status.set("error");
				this.disconnect();
				this.startFallbackPolling();
			};
		} catch (e) {
			console.warn("[EventCoordinator] SSE not available, falling back to polling:", e);
			this.status.set("disconnected");
			this.startFallbackPolling();
		}
	}

	// Disconnect SSE
	disconnect(): void {
		if (this.eventSource) {
			this.eventSource.close();
			this.eventSource = null;
		}
		this.status.set("disconnected");
	}

	// Register a fallback fetch function (used when SSE is unavailable)
	setFallbackFetch(fetchFn: () => Promise<void>): void {
		this.fallbackFetch = fetchFn;
	}

	// Process incoming events from SSE
	private receiveEvent(event: DomainEvent): void {
		this.eventBuffer.push(event);

		// Trim buffer if too large
		if (this.eventBuffer.length > this.options.maxBufferSize) {
			this.eventBuffer.splice(0, this.eventBuffer.length - this.options.maxBufferSize);
		}

		// Batch process - coalesce rapid events
		if (!this.batchTimer) {
			this.batchTimer = setTimeout(() => this.flushBuffer(), this.options.batchInterval);
		}
	}

	// Flush buffered events to the state manager
	private flushBuffer(): void {
		this.batchTimer = null;

		if (this.eventBuffer.length === 0) return;

		const events = [...this.eventBuffer];
		this.eventBuffer = [];

		for (const event of events) {
			try {
				arenaStateManager.applyEvent(event);
			} catch (e) {
				console.warn(`[EventCoordinator] Error processing event ${event.type}:`, e);
			}
		}
	}

	// Normalize raw API event to typed DomainEvent
	private normalizeEvent(data: Record<string, unknown>): DomainEvent {
		// Map raw event types to our DomainEvent format
		const typeMap: Record<string, string> = {
			"task:created": "task-created",
			"task:assigned": "task-assigned",
			"task:started": "task-started",
			"task:progressed": "task-progressed",
			"task:blocked": "task-blocked",
			"task:unblocked": "task-unblocked",
			"task:retry": "task-retry-scheduled",
			"task:completed": "task-completed",
			"task:failed": "task-failed",
			"agent:connected": "agent-connected",
			"agent:disconnected": "agent-disconnected",
			"agent:health": "agent-health-changed",
			"agent:action": "agent-action-changed",
			"memory:created": "memory-created",
			"memory:updated": "memory-updated",
			"repo:locked": "repository-locked",
			"repo:unlocked": "repository-unlocked",
			"repo:health": "repository-health-changed",
			"metrics:updated": "metrics-updated"
		};

		const mappedType = typeMap[data.type as string] || (data.type as string);

		return {
			type: mappedType,
			timestamp: (data.timestamp as number) || Date.now(),
			...data
		} as DomainEvent;
	}

	private startFallbackPolling(): void {
		if (this.poller || !this.fallbackFetch) return;

		// Wrap fetch with error handling + status update
		const wrappedFetch = async () => {
			try {
				await this.fallbackFetch!();
				this.status.set("connected");
			} catch (e) {
				console.warn("[EventCoordinator] Fallback poll failed:", e);
				this.status.set("error");
			}
		};

		this.poller = createVisibilityPoller(wrappedFetch, this.options.fallbackPollInterval);
		this.poller.start();
	}

	private stopFallbackPolling(): void {
		if (this.poller) {
			this.poller.stop();
			this.poller = null;
		}
	}

	// Force immediate poll (for manual refresh)
	async forceRefresh(): Promise<void> {
		if (this.fallbackFetch) {
			await this.fallbackFetch();
		}
		this.flushBuffer();
	}

	// Destroy - cleanup all resources
	destroy(): void {
		this.disconnect();
		this.stopFallbackPolling();
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}
		this.eventBuffer = [];
	}
}

// Singleton
export const eventCoordinator = new EventCoordinator();
