/**
 * Shared plumbing behind every namespace: the transport, the default scope,
 * the cached tool index and tool-call decoding.
 *
 * @internal
 * @module
 */

import { probeTools, requireFeature, type ToolIndex } from "./capabilities.js";
import { ArgumentError, ProtocolError, ToolError } from "./errors.js";
import { resolveScope, type Scope } from "./scope.js";
import type { CallOptions, Transport } from "./transport.js";

/** Drop `undefined` entries so they never reach the wire. */
export function wire(entries: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** A required non-empty string argument. */
export function requireText(value: unknown, name: string, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ArgumentError(`${where}: ${name} must be a non-empty string`);
  }
  return value;
}

/** The argument object itself, or an empty one when omitted. */
export function argsObject<T extends object>(value: T | undefined, where: string): T {
  if (value === undefined) return {} as T;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ArgumentError(`${where}: arguments must be an object`);
  }
  return value;
}

/** The first `{ type: "text", text }` item of a tool result's content. */
function firstText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content as unknown[]) {
    if (item === null || typeof item !== "object") continue;
    const { type, text } = item as { type?: unknown; text?: unknown };
    if (type === "text" && typeof text === "string") return text;
  }
  return undefined;
}

/** The state one client shares with its namespaces. */
export class Core {
  readonly transport: Transport;
  readonly defaultScope: Scope | undefined;
  #index: Promise<ToolIndex> | undefined;

  constructor(transport: Transport, defaultScope: Scope | undefined) {
    this.transport = transport;
    this.defaultScope = defaultScope;
  }

  /** The call's scope, else the default, else a ScopeError. */
  scope(callScope: Scope | undefined, where: string): Scope {
    return resolveScope(callScope, this.defaultScope, where);
  }

  /** `initialize` + `tools/list`, probed once per client and cached. */
  toolIndex(options?: CallOptions): Promise<ToolIndex> {
    if (this.#index === undefined) {
      const probe = probeTools(this.transport, options);
      this.#index = probe;
      // A failed probe is not cached: the next call probes again.
      probe.catch(() => {
        if (this.#index === probe) this.#index = undefined;
      });
    }
    return this.#index;
  }

  /** Drop the cached tool index. */
  forgetToolIndex(): void {
    this.#index = undefined;
  }

  /**
   * Call a wrapped tool: check the server lists the tool and every argument
   * sent, then call it and decode its JSON payload.
   */
  async invoke(
    tool: string,
    args: Record<string, unknown>,
    mutating: boolean,
    options?: CallOptions,
  ): Promise<unknown> {
    const index = await this.toolIndex(options);
    requireFeature(index, tool, Object.keys(args));
    return this.callTool(tool, args, mutating, options);
  }

  /** `tools/call` without feature checks; returns the decoded tool JSON. */
  async callTool(
    tool: string,
    args: Record<string, unknown>,
    mutating: boolean,
    options?: CallOptions,
  ): Promise<unknown> {
    const result = await this.transport.rpc(
      "tools/call",
      { name: tool, arguments: args },
      mutating,
      options,
    );
    const text = firstText(result["content"]);
    if (result["isError"] === true) {
      throw new ToolError(tool, this.transport.safeText(text ?? "no detail"));
    }
    if (text === undefined) throw new ProtocolError(`${tool} returned no text content`);
    try {
      return JSON.parse(text);
    } catch {
      throw new ProtocolError(`${tool} returned text that is not JSON`, this.transport.safeText(text));
    }
  }
}
