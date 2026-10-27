/**
 * ConsoleLogBackend — stderr output for development/debugging.
 *
 * Provides colored, timestamped log output to stderr.
 * Never throws, never blocks.
 */

import type { ILogBackend, LogAttrs } from "../types.js";

const TAG = "";

export class ConsoleLogBackend implements ILogBackend {
  readonly type = "console";

  info(event: string, attrs?: LogAttrs): void {
    this.emit("INFO ", event, attrs);
  }

  warn(event: string, attrs?: LogAttrs): void {
    this.emit("WARN ", event, attrs);
  }

  error(event: string, attrs?: LogAttrs, err?: Error): void {
    const merged = err
      ? { ...attrs, "error.message": err.message, "error.name": err.name }
      : attrs;
    this.emit("ERROR", event, merged);
  }

  debug(event: string, attrs?: LogAttrs): void {
    this.emit("DEBUG", event, attrs);
  }

  async shutdown(): Promise<void> {}

  private emit(level: string, event: string, attrs?: LogAttrs): void {
    try {
      const ts = this.timestamp();
      const attrStr = attrs && Object.keys(attrs).length > 0
        ? " " + JSON.stringify(attrs)
        : "";
      process.stderr.write(`${ts} ${level} ${event}${attrStr}\n`);
    } catch {
      // Silent
    }
  }

  private timestamp(): string {
    const d = new Date();
    const YY = String(d.getFullYear()).slice(2);
    const MM = String(d.getMonth() + 1).padStart(2, "0");
    const DD = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${YY}-${MM}-${DD} ${h}:${m}:${s}.${ms}`;
  }
}
