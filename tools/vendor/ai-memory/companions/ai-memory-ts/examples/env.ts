/**
 * Connection settings shared by the examples. The SDK reads no environment
 * variables itself; the examples do, so the caller's code shows where the
 * token comes from.
 */
import type { Scope } from "ai-memory-ts";

export const serverUrl = process.env["AI_MEMORY_SERVER_URL"] ?? "http://127.0.0.1:49374";
export const token = process.env["AI_MEMORY_AUTH_TOKEN"] || undefined;
export const scope: Scope = {
  workspace: process.env["AI_MEMORY_EXAMPLE_WORKSPACE"] ?? "demo",
  project: process.env["AI_MEMORY_EXAMPLE_PROJECT"] ?? "app",
};
