import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [svelte()],
	resolve: {
		conditions: ["browser"],
		alias: {
			$lib: path.resolve(__dirname, "./src/lib")
		}
	},
	test: {
		environment: "jsdom",
		globals: true,
		include: ["src/**/*.test.ts"]
	}
});
