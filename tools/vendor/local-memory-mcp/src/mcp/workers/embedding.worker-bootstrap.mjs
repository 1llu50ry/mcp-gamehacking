/**
 * embedding.worker-bootstrap — DEV/TEST worker entry for the embedding worker
 * pool (FEAT-DAEMON-002D).
 *
 * The production worker is the tsup-bundled `dist/mcp/workers/embedding.worker.js`
 * (plain ESM — no TypeScript at runtime). During development and under vitest
 * the pool spawns THIS file instead: it installs the tsx ESM loader hooks
 * (which rewrite `./x.js` → `./x.ts` for nested imports) and then imports the
 * TypeScript worker source.
 *
 * Why a bootstrap instead of `new Worker(tsUrl, { execArgv: ["--import", "tsx"] })`:
 * worker threads do NOT apply tsx's `.js`→`.ts` resolution to nested imports
 * when tsx is only preloaded via `--import` — the entry `.ts` loads but its
 * nested imports fail with ERR_MODULE_NOT_FOUND. Calling `register()` from
 * inside the worker before the first import installs the resolver hooks
 * correctly (verified for both plain `node` and vitest). Mirrors
 * `parser.worker-bootstrap.mjs` (FEAT-DAEMON-002C).
 */

import { register } from "tsx/esm/api";

register();

await import("./embedding.worker.ts");
