import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import prettier from "eslint-config-prettier";
import globals from "globals";

/** @type {import('eslint').Linter.Config[]} */
export default [
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs["flat/recommended"],
	prettier,
	...svelte.configs["flat/prettier"],
	{
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
		}
	},
	{
		files: ["**/*.test.ts", "**/*.spec.ts"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off"
		}
	},
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},
	{
		files: ["**/*.svelte"],
		languageOptions: {
			parserOptions: {
				parser: ts.parser
			}
		}
	},
	{
		// Generated/scratch dirs (gitignored) must not pollute lint runs —
		// otherwise `npm run lint` flags regenerated artifacts (.tmp/, coverage/,
		// .cache/) that do not exist on CI and make the local gate unreproducible.
		ignores: [
			"dist/",
			"node_modules/",
			"bin/",
			"build/",
			"*.db",
			"storage/",
			".svelte-kit/",
			".tmp/",
			"coverage/",
			".cache/"
		]
	}
];
