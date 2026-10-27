/**
 * Language routing + ParserPool registry-map tests (FIX-030).
 *
 * Focus: the basename map is keyed by CANONICAL lowercase basename so two
 * extensionless files sharing a basename across different directories resolve
 * to the same config (no per-directory collision), and the registry does not
 * emit spurious `Duplicate basename mapping` warnings for the same language
 * registered under display-cased and lowercase tokens.
 */

import { describe, it, expect, vi } from "vitest";
import {
	buildRegistryMaps,
	buildGenericCatchAll,
	createRegistry,
	extensionlessLookupKey,
	type LanguageConfig
} from "../../codebase-index/parser/language-routing.js";
import { logger } from "../../utils/logger.js";

/** Minimal visitor stand-in — the maps only need config identity. */
function makeConfig(languageId: string, extensions: string[]): LanguageConfig {
	return {
		languageId,
		extensions,
		grammarWasms: [],
		createVisitor: () => ({ extractSymbols: () => [] })
	};
}

describe("extensionlessLookupKey", () => {
	it("normalizes a path to its lowercase basename (positive)", () => {
		expect(extensionlessLookupKey("/repo/sub/Dockerfile")).toBe("dockerfile");
		expect(extensionlessLookupKey("a/b/MakeFile")).toBe("makefile");
		expect(extensionlessLookupKey("Containerfile")).toBe("containerfile");
	});

	it("returns the basename unchanged when already lowercase (negative)", () => {
		expect(extensionlessLookupKey("justfile")).toBe("justfile");
	});
});

describe("buildRegistryMaps — basename namespacing (FIX-030)", () => {
	it("maps display-cased and lowercase tokens to the same canonical key", () => {
		const config = makeConfig("generic", ["Dockerfile", "dockerfile", "Makefile", "makefile"]);
		const { basenameToConfig } = buildRegistryMaps([config]);

		// Both casings collapse onto the ONE lowercase key.
		expect(basenameToConfig.size).toBe(2);
		expect(basenameToConfig.get("dockerfile")).toBe(config);
		expect(basenameToConfig.get("makefile")).toBe(config);
	});

	it("does NOT warn when the same config is registered under both casings", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		try {
			const config = makeConfig("generic", ["Dockerfile", "dockerfile", "Makefile", "makefile"]);
			buildRegistryMaps([config]);
			const dupWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("Duplicate basename"));
			expect(dupWarns).toHaveLength(0);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("DOES warn on a genuine conflict (two different configs, one basename)", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		try {
			const a = makeConfig("lang-a", ["Dockerfile"]);
			const b = makeConfig("lang-b", ["dockerfile"]);
			buildRegistryMaps([a, b]);
			const dupWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("Duplicate basename"));
			expect(dupWarns).toHaveLength(1);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("real registry: no spurious duplicate-basename warnings on construction", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		try {
			const registry = createRegistry();
			registry.push(buildGenericCatchAll(registry));
			buildRegistryMaps(registry);
			const dupWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("Duplicate basename"));
			expect(dupWarns).toHaveLength(0);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("real registry: basename keys are canonical (lowercase) and non-empty", () => {
		const registry = createRegistry();
		registry.push(buildGenericCatchAll(registry));
		const { basenameToConfig } = buildRegistryMaps(registry);

		expect(basenameToConfig.size).toBeGreaterThan(0);
		for (const key of basenameToConfig.keys()) {
			expect(key).toBe(key.toLowerCase());
		}
		// Every extensionless named file resolves to a config.
		expect(basenameToConfig.get("dockerfile")).toBeDefined();
		expect(basenameToConfig.get("makefile")).toBeDefined();
		expect(basenameToConfig.get("justfile")).toBeDefined();
	});
});
