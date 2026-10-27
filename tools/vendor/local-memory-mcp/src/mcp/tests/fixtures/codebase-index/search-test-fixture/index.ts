/**
 * Main entry point — exports a class, function, and interface.
 */

export interface AppConfig {
	name: string;
	version: string;
	debug: boolean;
}

export function initializeApp(config: AppConfig): string {
	return `[${config.name} v${config.version}] initialized`;
}

export class Application {
	private config: AppConfig;

	constructor(config: AppConfig) {
		this.config = config;
	}

	public start(): string {
		return initializeApp(this.config);
	}

	public getVersion(): string {
		return this.config.version;
	}

	public isDebug(): boolean {
		return this.config.debug;
	}
}

export const DEFAULT_CONFIG: AppConfig = {
	name: "search-test-app",
	version: "1.0.0",
	debug: false
};

export function createAppRunner(config: AppConfig): () => string {
	return () => initializeApp(config);
}
