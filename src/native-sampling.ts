// ============================================================
// MCP sampling helpers — ask the connected client's model to
// summarize a decompile / explain a function / name a struct,
// without the server having its own API key.
//
// Uses MCP's `sampling/createMessage` which lets a server request
// LLM completions from the client. The client decides whether to
// grant each request (so this is permission-respecting by design).
//
// Three tools:
//   decompile_summarize — paste in decompile output, get a 3-line
//     plain-English summary (what the function does, interesting
//     callees, side effects).
//   struct_name_suggest — given a C struct, suggest a better name
//     and field names based on usage context.
//   explain_at_level    — generic "explain this text at <level>"
//     where level is beginner/intermediate/expert.
//
// Each tool gracefully falls back if the client doesn't support
// sampling (older clients, Claude Code without the capability):
// instead of failing, it returns the raw prompt so the user can
// paste it themselves.
// ============================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface SamplingLike {
  server: {
    createMessage?: (req: {
      messages: { role: "user" | "assistant"; content: { type: "text"; text: string } }[];
      maxTokens: number;
      temperature?: number;
      systemPrompt?: string;
      modelPreferences?: { hints?: { name: string }[]; costPriority?: number; speedPriority?: number; intelligencePriority?: number };
    }) => Promise<{ content: { type: "text"; text: string } | { type: string } }>;
  };
}

async function askClient(
  server: McpServer,
  system: string,
  user: string,
  maxTokens = 400,
): Promise<string> {
  const anyServer = server as unknown as SamplingLike;
  // Guard against clients that don't advertise sampling: the SDK method
  // either doesn't exist or throws McpError when the capability is off.
  if (typeof anyServer?.server?.createMessage !== "function") {
    throw new Error("client did not negotiate sampling capability");
  }
  const resp = await anyServer.server.createMessage({
    messages: [{ role: "user", content: { type: "text", text: user } }],
    systemPrompt: system,
    maxTokens,
    temperature: 0.2,
    modelPreferences: {
      hints: [{ name: "claude" }],
      intelligencePriority: 0.7,
      speedPriority: 0.3,
      costPriority: 0.5,
    },
  });
  if (resp.content.type === "text") return (resp.content as { text: string }).text;
  return JSON.stringify(resp.content);
}

export function registerSampling(server: McpServer): void {
  server.tool(
    "decompile_summarize",
    "Ask the connected client's model to summarize a pseudocode / decompile dump in 3-4 lines (uses MCP sampling).",
    { code: z.string(), hint: z.string().optional() },
    async ({ code, hint }: { code: string; hint?: string }) => {
      const system = "You are an expert reverse engineer. Summarize decompiler pseudocode in 3-4 lines, plain English. Say WHAT it does and WHY it looks that way (e.g. 'this is a RC4 keystream init'). Call out interesting constants.";
      const user = hint
        ? `Hint: ${hint}\n\nPseudocode:\n\`\`\`c\n${code}\n\`\`\``
        : `Pseudocode:\n\`\`\`c\n${code}\n\`\`\``;
      try {
        const summary = await askClient(server, system, user, 400);
        return { content: [{ type: "text" as const, text: `# decompile_summarize\n\n${summary}` }] };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text:
            `# decompile_summarize — sampling not available\n\n` +
            `${(e as Error).message}\n\n` +
            `Paste this into your model yourself:\n\n` +
            `**system:** ${system}\n\n**user:** ${user}`
          }],
        };
      }
    },
  );

  server.tool(
    "struct_name_suggest",
    "Ask the client's model to propose a better name + field names for a struct based on usage context.",
    { struct: z.string(), context: z.string().optional() },
    async ({ struct, context }: { struct: string; context?: string }) => {
      const system = "You are a reverse engineer. Given a C struct, suggest a better struct name AND better field names. Return a replacement struct in a fenced code block, then one line per rename.";
      const user = context
        ? `Context (usage snippets, strings referenced, etc):\n${context}\n\nStruct:\n\`\`\`c\n${struct}\n\`\`\``
        : `Struct:\n\`\`\`c\n${struct}\n\`\`\``;
      try {
        const out = await askClient(server, system, user, 500);
        return { content: [{ type: "text" as const, text: `# struct_name_suggest\n\n${out}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `struct_name_suggest fallback: paste into your model yourself.\n\nreason: ${(e as Error).message}\n\nsystem: ${system}\n\nuser: ${user}` }] };
      }
    },
  );

  server.tool(
    "explain_at_level",
    "Generic: ask the client's model to explain any text at a given level (beginner|intermediate|expert).",
    { text: z.string(), level: z.enum(["beginner", "intermediate", "expert"]).default("intermediate") },
    async ({ text, level }: { text: string; level: "beginner" | "intermediate" | "expert" }) => {
      const system = `Explain the following at a ${level} level. Be concise. Use concrete examples where helpful.`;
      try {
        const out = await askClient(server, system, text, 600);
        return { content: [{ type: "text" as const, text: `# explain_at_level (${level})\n\n${out}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `explain_at_level fallback (${level}): paste yourself.\n\nreason: ${(e as Error).message}\n\n${text}` }] };
      }
    },
  );
}
