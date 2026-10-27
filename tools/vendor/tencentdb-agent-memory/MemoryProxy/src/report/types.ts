/**
 * Report module — type definitions for the structured logging system.
 *
 * Design principles (borrowed from offload_server observability layer):
 * 1. Backend-agnostic: business code depends only on interfaces
 * 2. Safe by default: never throw, never block business logic
 * 3. Extensible: new backends can be added without changing callers
 */

// ─── Log Attributes ──────────────────────────────────────────────────────────

/** Log attributes — only primitive types allowed (safe for serialization). */
export type LogAttrs = Record<string, string | number | boolean>;

// ─── Log Backend Interface ───────────────────────────────────────────────────

/**
 * Log backend interface.
 *
 * Implementations:
 * - NoopLogBackend    — zero overhead (default when unconfigured)
 * - ConsoleLogBackend — stderr output (development/debugging)
 * - Future: OtlpLogBackend, OpikLogBackend, etc.
 */
export interface ILogBackend {
  /** Backend identifier. */
  readonly type: string;

  /** INFO level log. */
  info(event: string, attrs?: LogAttrs): void;

  /** WARN level log. */
  warn(event: string, attrs?: LogAttrs): void;

  /** ERROR level log (optionally with Error object). */
  error(event: string, attrs?: LogAttrs, err?: Error): void;

  /** DEBUG level log. */
  debug(event: string, attrs?: LogAttrs): void;

  /** Graceful shutdown (flush pending data). */
  shutdown(): Promise<void>;
}

// ─── Log Level ───────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ─── Log Configuration ───────────────────────────────────────────────────────

/** File logger rotation configuration. */
export interface FileRotateConfig {
  /** Max file size in bytes before rotation (default: 100MB). */
  maxSizeBytes: number;
  /** Number of backup files to keep (default: 10). */
  backupLimit: number;
}

/** Log configuration (part of ProxyConfig). */
export interface LogConfig {
  /** Minimum log level: debug | info | warn | error */
  level: LogLevel;
  /** Local log file directory (empty string disables file logging). */
  filePath: string;
  /** File rotation settings. */
  rotate: FileRotateConfig;
  /** Backend type: noop | console */
  backend: "noop" | "console";
}
