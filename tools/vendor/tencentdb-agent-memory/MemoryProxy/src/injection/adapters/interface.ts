/**
 * ProtocolAdapter interface.
 * Responsible for converting protocol-specific request/response to/from AgentContext.
 */

import type { AgentContext, AgentContextMetadata, Protocol } from "../types.js";

/**
 * Protocol adapter: handles parse (raw body → AgentContext)
 * and serialize (AgentContext → raw body).
 */
export interface ProtocolAdapter {
  /** Protocol identifier. */
  readonly protocol: Protocol;

  /**
   * Parse a raw request body into an AgentContext.
   * @param body Raw request body (protocol-specific format)
   * @param metadata Request metadata (traceId, keyId, etc.)
   * @returns Parsed AgentContext
   */
  parse(body: Record<string, unknown>, metadata: AgentContextMetadata): AgentContext;

  /**
   * Serialize an AgentContext back into protocol-native request body format.
   * @param ctx The (possibly modified) AgentContext
   * @returns A body object that can be directly used with fetch()
   */
  serialize(ctx: AgentContext): Record<string, unknown>;
}
