/**
 * Report module — structured logging system for context-proxy.
 *
 * Public API:
 *   import { log, initLogger, shutdownLogger } from "./report/index.js";
 */

export { log, initLogger, shutdownLogger, getLogLevel } from "./log.js";
export { FileLogger } from "./file-logger.js";
export type { ILogBackend, LogAttrs, LogConfig, LogLevel, FileRotateConfig } from "./types.js";
export { LOG_LEVEL_PRIORITY } from "./types.js";
export { NoopLogBackend } from "./backends/noop.js";
export { ConsoleLogBackend } from "./backends/console.js";
