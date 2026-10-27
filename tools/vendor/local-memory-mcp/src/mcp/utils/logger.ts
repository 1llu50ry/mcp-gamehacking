import fs from "fs";

type LogLevel = "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency";

type LogMethodLevel = LogLevel | "warn";

export type LogSinkPayload = {
	level: LogLevel;
	logger?: string;
	data: Record<string, unknown>;
};

export type LogSink = (payload: LogSinkPayload) => void;

/**
 * Returns ISO 8601 timestamp in the system's local timezone.
 * Respects OS timezone setting (e.g., Asia/Jakarta = UTC+7).
 */
function toLocalISOString(date: Date = new Date()): string {
	const y = date.getFullYear();
	const mo = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	const h = String(date.getHours()).padStart(2, "0");
	const mi = String(date.getMinutes()).padStart(2, "0");
	const s = String(date.getSeconds()).padStart(2, "0");
	const ms = String(date.getMilliseconds()).padStart(3, "0");
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const offHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
	const offMins = String(Math.abs(offset) % 60).padStart(2, "0");
	return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}${sign}${offHours}:${offMins}`;
}

const LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	notice: 2,
	warning: 3,
	error: 4,
	critical: 5,
	alert: 6,
	emergency: 7
};

const LEVEL_ALIASES: Record<string, LogLevel> = {
	warn: "warning"
};

let currentLevel: LogLevel = parseLevel(process.env.LOG_LEVEL?.toLowerCase());
const sinks = new Set<LogSink>();

function parseLevel(raw: string | undefined): LogLevel {
	if (!raw) return "info";
	const normalized = LEVEL_ALIASES[raw] || raw;
	if (normalized in LEVELS) return normalized as LogLevel;
	return "info";
}

function normalizeMethodLevel(level: LogMethodLevel): LogLevel {
	return level === "warn" ? "warning" : level;
}

function formatContextForStderr(context?: Record<string, unknown>): string {
	if (!context || Object.keys(context).length === 0) return "";
	return ` ${JSON.stringify(context)}`;
}

function deriveLoggerName(message: string): string | undefined {
	if (message.startsWith("[Server]")) return "server";
	if (message.startsWith("[Vectors]")) return "vectors";
	if (message.startsWith("[Tool]")) return "tool";
	if (message.startsWith("[Router]")) return "router";
	if (message.startsWith("[Dashboard]")) return "dashboard";
	return "app";
}

function emitToStderr(level: LogLevel, message: string, context?: Record<string, unknown>) {
	// Skip stderr output when running as MCP server (stdin/stdout used for JSON-RPC)
	// Logs are still emitted to sinks if configured
	if (process.env.MCP_SERVER === "true") {
		return;
	}

	const timestamp = toLocalISOString();
	const levelStr = level.toUpperCase().padEnd(9);
	process.stderr.write(`${timestamp} [${levelStr}] ${message}${formatContextForStderr(context)}\n`);
}

function sanitizeLogData(message: string, context?: Record<string, unknown>) {
	return {
		message,
		...(context ?? {})
	};
}

function emitToSinks(level: LogLevel, message: string, context?: Record<string, unknown>) {
	const payload: LogSinkPayload = {
		level,
		logger: deriveLoggerName(message),
		data: sanitizeLogData(message, context)
	};

	for (const sink of sinks) {
		try {
			sink(payload);
		} catch {
			// Sinks must never break the main logger path.
		}
	}
}

function log(level: LogMethodLevel, message: string, context?: Record<string, unknown>): void {
	const normalizedLevel = normalizeMethodLevel(level);
	if (LEVELS[normalizedLevel] < LEVELS[currentLevel]) return;

	emitToStderr(normalizedLevel, message, context);
	emitToSinks(normalizedLevel, message, context);
}

export const logger = {
	debug(message: string, context?: Record<string, unknown>): void {
		log("debug", message, context);
	},
	info(message: string, context?: Record<string, unknown>): void {
		log("info", message, context);
	},
	notice(message: string, context?: Record<string, unknown>): void {
		log("notice", message, context);
	},
	warn(message: string, context?: Record<string, unknown>): void {
		log("warn", message, context);
	},
	warning(message: string, context?: Record<string, unknown>): void {
		log("warning", message, context);
	},
	error(message: string, context?: Record<string, unknown>): void {
		log("error", message, context);
	},
	critical(message: string, context?: Record<string, unknown>): void {
		log("critical", message, context);
	},
	alert(message: string, context?: Record<string, unknown>): void {
		log("alert", message, context);
	},
	emergency(message: string, context?: Record<string, unknown>): void {
		log("emergency", message, context);
	}
};

export function setLogLevel(level: string): LogLevel {
	const raw = level.toLowerCase();
	const normalized = LEVEL_ALIASES[raw] || raw;
	if (!(normalized in LEVELS)) {
		const error = new Error(`Invalid log level: ${level}`) as Error & { code?: number };
		error.code = -32602;
		throw error;
	}
	currentLevel = normalized;
	return currentLevel;
}

export function getLogLevel(): LogLevel {
	return currentLevel;
}

export function addLogSink(sink: LogSink) {
	sinks.add(sink);
	return () => sinks.delete(sink);
}

export function clearLogSinks() {
	sinks.clear();
}

export const LOG_LEVEL_VALUES = Object.keys(LEVELS) as LogLevel[];

/**
 * Creates a file-based log sink with rotation (keeps last `maxFiles` log files).
 * Log files are written to `logDir` as `mcp-YYYYMMDD.log` (one file per day).
 * On creation, old files beyond `maxFiles` are deleted (oldest first).
 */
export function createFileSink(logDir: string, maxFiles = 5): LogSink {
	fs.mkdirSync(logDir, { recursive: true });

	const existing = fs
		.readdirSync(logDir)
		.filter((f) => f.startsWith("mcp-") && f.endsWith(".log"))
		.sort();

	while (existing.length >= maxFiles) {
		try {
			fs.unlinkSync(`${logDir}/${existing.shift()!}`);
		} catch {
			/* best effort */
		}
	}

	const date = toLocalISOString().slice(0, 10).replace(/-/g, "");
	const logFile = `${logDir}/mcp-${date}.log`;

	// Asynchronous append stream (FIX-CODESEARCH-STORM): the previous
	// `fs.appendFileSync` issued one BLOCKING write syscall per line, so a
	// warning storm (~20k lines/min) starved the event loop. A WriteStream
	// buffers writes and flushes off the main path; lines stay ordered because
	// they funnel through a single stream. Best-effort: sink errors are
	// swallowed so logging can never break the caller.
	const stream = fs.createWriteStream(logFile, { flags: "a" });
	stream.on("error", () => {
		/* best effort — a failed log sink must not crash the process */
	});

	return (payload) => {
		const line = `${toLocalISOString()} [${payload.level.toUpperCase()}] [pid:${process.pid}] ${JSON.stringify(payload.data)}\n`;
		try {
			stream.write(line);
		} catch {
			/* best effort */
		}
	};
}
