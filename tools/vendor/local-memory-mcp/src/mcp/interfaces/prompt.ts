export interface LoadedPrompt {
	name: string;
	description: string;
	arguments: Record<string, unknown>[];
	content: string;
	agent?: string;
}
