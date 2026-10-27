import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [svelte()],
	root: __dirname,
	base: "/",
	build: {
		outDir: path.resolve(__dirname, "../../../dist/dashboard/public"),
		emptyOutDir: true,
		chunkSizeWarningLimit: 1500
	},
	server: {
		port: 5173,
		proxy: {
			"/api": "http://localhost:3456"
		}
	},
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, "./src/lib")
		}
	}
});
