import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";
import type { LoadedPrompt } from "../interfaces";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findPromptDir(): string {
	const candidates = [
		// Production if chunked into dist/
		"./prompts",
		// Production if inlined into dist/mcp/
		"../prompts",
		// Dev: /src/mcp/prompts/definitions (next to loader.ts)
		"./definitions"
	].map((relPath) => path.resolve(__dirname, relPath));

	for (const dir of candidates) {
		if (fs.existsSync(dir)) {
			const files = fs.readdirSync(dir);
			if (files.some((f) => f.endsWith(".md"))) {
				return dir;
			}
		}
	}

	// Final fallback
	return path.resolve(__dirname, "./definitions");
}

const PROMPT_DIR = findPromptDir();

// ── Cache ──────────────────────────────────────────────────────────────
// Per-prompt cache: maps prompt name → parsed LoadedPrompt.
// Populated on first call to loadPromptFromMarkdown().
const promptCache = new Map<string, LoadedPrompt>();

// File-list cache: populated on first call to listPromptFiles().
let fileListCache: string[] | null = null;

/**
 * Lists all available prompt names (without .md extension).
 * Results are cached in-memory after the first call.
 */
export function listPromptFiles(): string[] {
	if (fileListCache !== null) return fileListCache;

	if (!fs.existsSync(PROMPT_DIR)) {
		fileListCache = [];
		return [];
	}

	fileListCache = fs
		.readdirSync(PROMPT_DIR)
		.filter((file) => file.endsWith(".md"))
		.map((file) => file.replace(/\.md$/, ""))
		.sort();

	return fileListCache;
}

/**
 * Clears both prompt content and file-list caches.
 * Useful in tests or when prompt files change at runtime.
 */
export function refreshPromptCache(): void {
	promptCache.clear();
	fileListCache = null;
	serverInstructionsCache = null;
}

export function loadPromptFromMarkdown(name: string): LoadedPrompt {
	const cached = promptCache.get(name);
	if (cached) return cached;

	const filePath = path.join(PROMPT_DIR, `${name}.md`);
	if (!fs.existsSync(filePath)) {
		throw new Error(`Prompt file not found: ${filePath}`);
	}
	const fileContent = fs.readFileSync(filePath, "utf-8");
	const { data, content } = matter(fileContent);

	const result = {
		name: data.name || name,
		description: data.description || "",
		arguments: data.arguments || [],
		agent: data.agent,
		content: content.trim()
	};

	promptCache.set(name, result);
	return result;
}

function findServerInstructionsDir(): string {
	const candidates = [
		// Production if chunked into dist/
		"./prompts/server",
		// Production if inlined into dist/mcp/
		"../prompts/server",
		// Dev: /src/mcp/prompts/server (next to loader.ts)
		"./server"
	].map((relPath) => path.resolve(__dirname, relPath));

	for (const dir of candidates) {
		if (fs.existsSync(dir)) {
			const filePath = path.join(dir, "instructions.md");
			if (fs.existsSync(filePath)) {
				return dir;
			}
		}
	}

	// Final fallback
	return path.resolve(__dirname, "./server");
}

const SERVER_DIR = findServerInstructionsDir();

let serverInstructionsCache: string | null = null;

export function loadServerInstructions(): string {
	if (serverInstructionsCache !== null) return serverInstructionsCache;

	const filePath = path.join(SERVER_DIR, "instructions.md");
	if (!fs.existsSync(filePath)) {
		throw new Error(`Server instructions file not found: ${filePath}`);
	}
	const fileContent = fs.readFileSync(filePath, "utf-8");
	const { content } = matter(fileContent);
	serverInstructionsCache = content.trim();
	return serverInstructionsCache;
}
