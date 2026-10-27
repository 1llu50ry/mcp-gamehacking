/**
 * NoopLogBackend — zero-overhead no-op implementation.
 *
 * Used as default when no backend is configured.
 * All methods are empty — guaranteed zero cost.
 */

import type { ILogBackend, LogAttrs } from "../types.js";

export class NoopLogBackend implements ILogBackend {
  readonly type = "noop";

  info(_event: string, _attrs?: LogAttrs): void {}
  warn(_event: string, _attrs?: LogAttrs): void {}
  error(_event: string, _attrs?: LogAttrs, _err?: Error): void {}
  debug(_event: string, _attrs?: LogAttrs): void {}

  async shutdown(): Promise<void> {}
}
