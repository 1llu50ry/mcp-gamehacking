export type SamplingContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string }
	| { type: "audio"; data: string; mimeType: string }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export type SamplingMessage = {
	role: "user" | "assistant";
	content:
		| SamplingContent
		| SamplingContent[]
		| {
				type: "tool_result";
				toolUseId: string;
				content: Array<{ type: "text"; text: string }>;
				isError?: boolean;
		  }
		| Array<{
				type: "tool_result";
				toolUseId: string;
				content: Array<{ type: "text"; text: string }>;
				isError?: boolean;
		  }>;
};

export type SamplingToolDefinition = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
};

export type SamplingCreateMessageParams = {
	messages: SamplingMessage[];
	systemPrompt?: string;
	maxTokens?: number;
	modelPreferences?: Record<string, unknown>;
	tools?: SamplingToolDefinition[];
	toolChoice?: { mode: "auto" | "required" | "none"; name?: string };
};

export type SamplingCreateMessageResult = {
	role: "assistant";
	content: SamplingContent | SamplingContent[];
	model?: string;
	stopReason?: string;
};

export type SamplingRequestHandler = (params: SamplingCreateMessageParams) => Promise<SamplingCreateMessageResult>;

export function asArray<T>(value: T | T[]): T[] {
	return Array.isArray(value) ? value : [value];
}

export function extractTextFromContent(content: SamplingContent | SamplingContent[]): string {
	return asArray(content)
		.filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
		.map((entry) => entry.text)
		.join("\n");
}

export function extractToolUses(content: SamplingContent | SamplingContent[]) {
	return asArray(content).filter(
		(entry): entry is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
			entry.type === "tool_use"
	);
}
