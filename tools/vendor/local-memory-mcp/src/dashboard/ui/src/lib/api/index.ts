import { systemApi } from "./resources/system";
import { memoriesApi } from "./resources/memories";
import { tasksApi } from "./resources/tasks";
import { coordinationApi } from "./resources/coordination";
import { standardsApi } from "./resources/standards";
import { kgApi } from "./resources/kg";
import { codebaseApi } from "./resources/codebase";
import { queueApi } from "./resources/queue";

export * from "./types";

/**
 * Aggregated dashboard API client — per-resource partial objects (resources/*)
 * merged into the single historical `api` namespace. Method names, signatures
 * and wire behavior are identical to the former single-file api.ts; consumers
 * keep calling `api.<method>(...)` as before.
 */
export const api = {
	...systemApi,
	...memoriesApi,
	...tasksApi,
	...coordinationApi,
	...standardsApi,
	...kgApi,
	...codebaseApi,
	...queueApi
};
