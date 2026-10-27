import type { LogFields, Logger, LogLevel } from './logger.js';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m', // gray
  info: '\x1b[36m', // cyan
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
};
const RESET = '\x1b[0m';

export interface ConsoleLoggerOptions {
  /** 最低输出级别，低于此级别的日志被丢弃。 */
  level: LogLevel;
  /** json：每行一个 JSON（适合采集）；pretty：人类可读（适合本地开发）。 */
  format: 'json' | 'pretty';
  /** 固定绑定字段（child 累加）。 */
  bindings?: LogFields;
}

/**
 * 零依赖的结构化 console 日志实现。
 * - error 走 stderr，其余走 stdout；
 * - format=json 时每行一个 JSON 对象，便于被日志平台采集；
 * - child() 累加绑定字段，实现 reqId 串联。
 */
export class ConsoleLogger implements Logger {
  private readonly minWeight: number;

  constructor(private readonly opts: ConsoleLoggerOptions) {
    this.minWeight = LEVEL_WEIGHT[opts.level];
  }

  debug(msg: string, fields?: LogFields): void {
    this.write('debug', msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.write('info', msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.write('warn', msg, fields);
  }
  error(msg: string, fields?: LogFields): void {
    this.write('error', msg, fields);
  }

  child(bindings: LogFields): Logger {
    return new ConsoleLogger({
      ...this.opts,
      bindings: { ...this.opts.bindings, ...bindings },
    });
  }

  private write(level: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVEL_WEIGHT[level] < this.minWeight) return;
    const time = new Date().toISOString();
    const merged: LogFields = { ...this.opts.bindings, ...fields };
    const stream = level === 'error' ? process.stderr : process.stdout;

    if (this.opts.format === 'json') {
      stream.write(`${JSON.stringify({ time, level, msg, ...merged })}\n`);
      return;
    }

    const head = `${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
    const tail =
      Object.keys(merged).length > 0
        ? ` ${Object.entries(merged)
            .map(([k, v]) => `${k}=${fmtValue(v)}`)
            .join(' ')}`
        : '';
    stream.write(`${time} ${head} ${msg}${tail}\n`);
  }
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
