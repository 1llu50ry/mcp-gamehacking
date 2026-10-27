// Re-export all tool definitions as a flat array
import { MEMORY_TOOL_DEFINITIONS } from "./memory";
import { TASK_TOOL_DEFINITIONS } from "./task";
import { HANDOFF_TOOL_DEFINITIONS } from "./handoff";
import { STANDARD_TOOL_DEFINITIONS } from "./standard";
import { AGENT_TOOL_DEFINITIONS } from "./agent";
import { CODEBASE_INDEX_TOOL_DEFINITIONS } from "./codebase-index";
import { EXPLORATION_OBSERVATION_TOOL_DEFINITIONS } from "./exploration-observation";
import { PROMPT_TOOL_DEFINITIONS } from "./prompt";

export { MEMORY_TOOL_DEFINITIONS } from "./memory";
export { TASK_TOOL_DEFINITIONS } from "./task";
export { HANDOFF_TOOL_DEFINITIONS } from "./handoff";
export { STANDARD_TOOL_DEFINITIONS } from "./standard";
export { AGENT_TOOL_DEFINITIONS } from "./agent";
export { CODEBASE_INDEX_TOOL_DEFINITIONS } from "./codebase-index";
export { EXPLORATION_OBSERVATION_TOOL_DEFINITIONS } from "./exploration-observation";
export { PROMPT_TOOL_DEFINITIONS } from "./prompt";

export const TOOL_DEFINITIONS = [
	...MEMORY_TOOL_DEFINITIONS,
	...TASK_TOOL_DEFINITIONS,
	...HANDOFF_TOOL_DEFINITIONS,
	...STANDARD_TOOL_DEFINITIONS,
	...AGENT_TOOL_DEFINITIONS,
	...CODEBASE_INDEX_TOOL_DEFINITIONS,
	...EXPLORATION_OBSERVATION_TOOL_DEFINITIONS,
	...PROMPT_TOOL_DEFINITIONS
];
