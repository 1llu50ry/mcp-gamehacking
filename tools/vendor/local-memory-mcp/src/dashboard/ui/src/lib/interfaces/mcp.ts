export interface RepoMeta {
	repo: string;
	memoryCount: number;
	taskCount?: number;
	pendingCount?: number;
	inProgressCount?: number;
	blockedCount?: number;
	backlogCount?: number;
	lastActivity?: string;
}

export interface ReferenceItem {
	type: "tool" | "prompt" | "resource";
	data: {
		name: string;
		description?: string;
		inputSchema?: {
			type: string;
			properties?: Record<string, { type: string; description?: string }>;
			required?: string[];
		};
		arguments?: Array<{
			name: string;
			description?: string;
			required?: boolean;
		}>;
		messages?: Array<{
			role: string;
			content: string | { text: string };
		}>;
		uri?: string;
		mimeType?: string;
	};
}

export interface ReferenceDataState {
	tools: ReferenceItem[];
	prompts: ReferenceItem[];
	resources: ReferenceItem[];
}

export interface HealthData {
	connected: boolean;
	uptime: number;
	version: string;
	memoryCount: number;
	dbPath: string;
	repoCount: number;
	/** Running build identity (PERF-009): version+git SHA+source. */
	build?: string;
}
