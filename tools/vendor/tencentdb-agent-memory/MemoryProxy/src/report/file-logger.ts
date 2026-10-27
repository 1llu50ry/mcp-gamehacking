/**
 * FileLogger — local log file writer with rotation.
 *
 * Features:
 * - WriteStream mode: keeps fd open, reduces syscall overhead
 * - Memory buffer + periodic flush: batches writes for better throughput
 * - Size-based rotation: rotates when file exceeds configured size
 * - Backup cleanup: keeps only N recent backup files
 * - Error-silent: never affects business logic
 *
 * Inspired by offload_server's file-logger.ts but adapted for higher throughput:
 * uses async WriteStream instead of appendFileSync since context-proxy has
 * higher request volume.
 */

import fs from "node:fs";
import path from "node:path";

export interface FileLoggerConfig {
  /** Log file directory. Empty disables file logging. */
  dir: string;
  /** Log file name (e.g. "proxy.log"). */
  filename: string;
  /** Max file size in bytes before rotation (default: 100MB). */
  rotateSizeBytes?: number;
  /** Number of backup files to keep (default: 10). */
  rotateBackupLimit?: number;
  /** Buffer flush interval in ms (default: 200ms). */
  flushIntervalMs?: number;
  /** Buffer flush threshold in lines (default: 50). */
  flushThreshold?: number;
}

/**
 * FileLogger writes structured log lines to a local file with rotation support.
 */
export class FileLogger {
  private readonly dir: string;
  private readonly filename: string;
  private readonly rotateSizeBytes: number;
  private readonly rotateBackupLimit: number;
  private readonly flushThreshold: number;

  private stream: fs.WriteStream | null = null;
  private currentSize = 0;
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private disabled = false;
  private filePath = "";

  constructor(cfg: FileLoggerConfig) {
    this.dir = cfg.dir;
    this.filename = cfg.filename;
    this.rotateSizeBytes = cfg.rotateSizeBytes ?? 100 * 1024 * 1024;
    this.rotateBackupLimit = cfg.rotateBackupLimit ?? 10;
    this.flushThreshold = cfg.flushThreshold ?? 50;

    if (!this.dir) {
      this.disabled = true;
      return;
    }

    try {
      this.initFile();
      const intervalMs = cfg.flushIntervalMs ?? 200;
      this.flushTimer = setInterval(() => this.flush(), intervalMs);
      // Allow process to exit naturally
      this.flushTimer.unref();
    } catch (err) {
      this.disabled = true;
      process.stderr.write(`[file-logger] init failed: ${err}\n`);
    }
  }

  /**
   * Write a log line.
   * Format: [ISO_TIMESTAMP][LEVEL] message {json_data}
   */
  write(level: string, message: string, data?: Record<string, unknown>): void {
    if (this.disabled) return;

    try {
      const line = this.formatLine(level, message, data);
      this.buffer.push(line);

      // Flush immediately if buffer threshold reached
      if (this.buffer.length >= this.flushThreshold) {
        this.flush();
      }
    } catch {
      // Silent — never block business logic
    }
  }

  /** Flush buffered lines to disk. */
  flush(): void {
    if (this.buffer.length === 0 || !this.stream || this.disabled) return;

    try {
      const chunk = this.buffer.join("");
      this.buffer = [];
      const bytes = Buffer.byteLength(chunk, "utf-8");

      // Check if rotation is needed before writing
      if (this.currentSize + bytes > this.rotateSizeBytes) {
        this.rotate();
      }

      if (this.stream) {
        this.stream.write(chunk);
        this.currentSize += bytes;
      }
    } catch {
      // Silent
    }
  }

  /** Graceful shutdown: flush remaining buffer and close stream. */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    this.flush();

    return new Promise<void>((resolve) => {
      if (this.stream) {
        this.stream.end(() => {
          this.stream = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private formatLine(level: string, message: string, data?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    let line = `[${timestamp}][${level}] ${message}`;

    if (data && Object.keys(data).length > 0) {
      // Sort keys for stable output (easier to grep/diff)
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(data).sort()) {
        sorted[key] = data[key];
      }
      line += ` ${JSON.stringify(sorted)}`;
    }

    return line + "\n";
  }

  private initFile(): void {
    // Create directory recursively
    fs.mkdirSync(this.dir, { recursive: true });

    this.filePath = path.join(this.dir, this.filename);

    // Get current file size (if exists)
    try {
      const stat = fs.statSync(this.filePath);
      this.currentSize = stat.size;
    } catch {
      this.currentSize = 0;
    }

    this.openStream();
  }

  private openStream(): void {
    this.stream = fs.createWriteStream(this.filePath, {
      flags: "a",
      encoding: "utf-8",
      // Use higher highWaterMark for better buffering
      highWaterMark: 64 * 1024,
    });

    this.stream.on("error", (err) => {
      process.stderr.write(`[file-logger] stream error: ${err.message}\n`);
      this.disabled = true;
    });
  }

  private rotate(): void {
    try {
      // Close current stream
      if (this.stream) {
        this.stream.end();
        this.stream = null;
      }

      // Rename current file to backup with timestamp suffix
      const ts = new Date()
        .toISOString()
        .replace(/[:.]/g, "")
        .replace("T", "_")
        .replace("Z", "");
      const backupName = `${this.filename}.${ts}`;
      const backupPath = path.join(this.dir, backupName);

      try {
        fs.renameSync(this.filePath, backupPath);
      } catch {
        // Rename failure is non-fatal
      }

      // Clean old backups
      this.cleanOldBackups();

      // Reopen stream for new file
      this.currentSize = 0;
      this.openStream();
    } catch (err) {
      process.stderr.write(`[file-logger] rotate failed: ${err}\n`);
      this.disabled = true;
    }
  }

  private cleanOldBackups(): void {
    try {
      const entries = fs.readdirSync(this.dir);
      const prefix = this.filename + ".";

      const backups = entries
        .filter((name) => name.startsWith(prefix) && name !== this.filename)
        .sort(); // Timestamp suffix ensures lexicographic = chronological order

      if (backups.length > this.rotateBackupLimit) {
        const toDelete = backups.slice(0, backups.length - this.rotateBackupLimit);
        for (const name of toDelete) {
          try {
            fs.unlinkSync(path.join(this.dir, name));
          } catch {
            // Silent
          }
        }
      }
    } catch {
      // Silent
    }
  }
}
