import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AiMemoryClient } from "../../src/client.js";
import {
  AbortError,
  AuthError,
  ConfigError,
  ForbiddenError,
  HttpError,
  InvalidParamsError,
  NotFoundError,
  PREVIEW_LIMIT,
  PreconditionFailedError,
  ProtocolError,
  RateLimitedError,
  RpcError,
  TimeoutError,
  ToolError,
  TransportError,
  UnsupportedServerError,
  preview,
} from "../../src/errors.js";
import { parseJsonRpcMessage, Transport } from "../../src/transport.js";
import { FakeServer, RpcFailure, hang, json, text } from "../support/fake.js";
import * as payloads from "../support/payloads.js";

const SCOPE = { workspace: "demo", project: "app" };

function client(server: FakeServer, extra: Record<string, unknown> = {}) {
  return new AiMemoryClient({
    serverUrl: "http://127.0.0.1:49374",
    scope: SCOPE,
    fetch: server.fetch,
    ...extra,
  });
}

describe("JSON-RPC response parsing", () => {
  it("reads a plain JSON body", () => {
    const message = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"result":{}}');
    assert.deepEqual(message, { jsonrpc: "2.0", id: 1, result: {} });
  });

  it("takes the last SSE frame that parses as JSON", () => {
    const sse =
      "data: \nid: 0\nretry: 3000\n\n" +
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n' +
      'data: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\nid: 1\n\n';
    assert.deepEqual(parseJsonRpcMessage(sse), { jsonrpc: "2.0", id: 2, result: { ok: true } });
  });

  it("joins multi-line data within one SSE event", () => {
    const sse = 'data: {"jsonrpc":"2.0",\ndata: "id":3,"result":{}}\n\n';
    assert.deepEqual(parseJsonRpcMessage(sse), { jsonrpc: "2.0", id: 3, result: {} });
  });

  it("returns nothing for an SSE stream without a data frame or with malformed JSON", () => {
    assert.equal(parseJsonRpcMessage("event: ping\n\n"), undefined);
    assert.equal(parseJsonRpcMessage("data: {not json\n\n"), undefined);
  });

  it("raises ProtocolError when the body holds no JSON-RPC message", async () => {
    const server = new FakeServer();
    server.mcp = async () => text("event: ping\n\n", 200, { "content-type": "text/event-stream" });
    await assert.rejects(client(server).callTool("memory_status", {}), ProtocolError);
  });

  it("decodes an SSE answer to a tool call", async () => {
    const server = new FakeServer();
    server.mcp = async (request) => {
      const id = (request.body as { id: number }).id;
      const result = { content: [{ type: "text", text: '{"a":1}' }], isError: false };
      return text(`data: \n\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`, 200, {
        "content-type": "text/event-stream",
      });
    };
    assert.deepEqual(await client(server).callTool("memory_status", {}), { a: 1 });
  });

  it("refuses an answer to a different request id", async () => {
    const server = new FakeServer();
    server.mcp = async () => json({ jsonrpc: "2.0", id: 999, result: {} });
    await assert.rejects(client(server).callTool("memory_status", {}), ProtocolError);
  });

  it("raises ProtocolError for a result with no result member", async () => {
    const server = new FakeServer();
    server.mcp = async (r) => json({ jsonrpc: "2.0", id: (r.body as { id: number }).id });
    await assert.rejects(client(server).callTool("memory_status", {}), ProtocolError);
  });

  it("raises ProtocolError when the tool text is not JSON", async () => {
    const server = new FakeServer();
    server.mcp = async (r) =>
      json({
        jsonrpc: "2.0",
        id: (r.body as { id: number }).id,
        result: { content: [{ type: "text", text: "plain words" }] },
      });
    await assert.rejects(client(server).callTool("memory_status", {}), ProtocolError);
  });

  it("increases JSON-RPC ids per client", async () => {
    const server = new FakeServer();
    server.tools.set("memory_status", () => payloads.status);
    const memory = client(server);
    await memory.status();
    await memory.status();
    const ids = server.requests.map((r) => (r.body as { id?: number }).id);
    assert.deepEqual(ids, [1, 2, 3, 4]);
  });
});

describe("error taxonomy", () => {
  it("maps HTTP statuses to their classes with hints", async () => {
    const cases: [number, new (...args: never[]) => HttpError][] = [
      [401, AuthError],
      [403, ForbiddenError],
      [404, NotFoundError],
      [429, RateLimitedError],
      [500, HttpError],
    ];
    for (const [status, expected] of cases) {
      const server = new FakeServer();
      server.mcp = async () => json({ error: `status ${status}` }, status);
      await assert.rejects(client(server).callTool("memory_status", {}), (error: unknown) => {
        assert.ok(error instanceof expected, `status ${status}`);
        assert.equal((error as HttpError).status, status);
        assert.equal((error as HttpError).preview, `status ${status}`);
        return true;
      });
    }
  });

  it("decodes the precondition table exactly as wikisync does", () => {
    const transport = new Transport({ serverUrl: "http://127.0.0.1:1" });
    const right = transport.rpcError("tools/call", {
      code: -32600,
      message: "precondition failed",
      data: {
        reason: "precondition_failed",
        path: "notes/a.md",
        expected_page_id: "v1",
        current_page_id: null,
      },
    });
    assert.ok(right instanceof PreconditionFailedError);
    assert.equal(right.path, "notes/a.md");
    assert.equal(right.expectedPageId, "v1");
    assert.equal(right.currentPageId, null);

    const wrongReason = transport.rpcError("x", { code: -32600, data: { reason: "nope" } });
    assert.ok(!(wrongReason instanceof PreconditionFailedError));
    assert.ok(wrongReason instanceof RpcError);

    const wrongCode = transport.rpcError("x", {
      code: -32602,
      data: { reason: "precondition_failed" },
    });
    assert.ok(!(wrongCode instanceof PreconditionFailedError));
    assert.ok(wrongCode instanceof InvalidParamsError);

    const noData = transport.rpcError("x", { code: -32600 });
    assert.ok(!(noData instanceof PreconditionFailedError));
    assert.equal(noData.rpcCode, -32600);
  });

  it("keeps an admission-style -32603 a plain RpcError", async () => {
    const server = new FakeServer();
    server.tools.set("memory_write_page", () => new RpcFailure(-32603, "admission rejected"));
    await assert.rejects(
      client(server).pages.write({ path: "notes/a.md", body: "x" }),
      (error: unknown) =>
        error instanceof RpcError && error.code === "rpc" && error.rpcCode === -32603,
    );
  });

  it("raises ToolError for result.isError", async () => {
    const server = new FakeServer();
    server.mcp = async (r) =>
      json({
        jsonrpc: "2.0",
        id: (r.body as { id: number }).id,
        result: { content: [{ type: "text", text: "tool blew up" }], isError: true },
      });
    await assert.rejects(client(server).callTool("memory_status", {}), (error: unknown) => {
      assert.ok(error instanceof ToolError);
      assert.equal(error.detail, "tool blew up");
      assert.equal(error.tool, "memory_status");
      return true;
    });
  });

  it("gives every class a stable code", () => {
    assert.equal(new ConfigError("x").code, "config");
    assert.equal(new TimeoutError("x", false).code, "timeout");
    assert.equal(new AbortError("x", false).code, "aborted");
    assert.equal(new UnsupportedServerError("f", "3.0.0").code, "unsupported_server");
    assert.equal(new TransportError("x").code, "transport");
  });
});

describe("timeouts and aborts", () => {
  it("reports a timeout on a mutation as uncertain", async () => {
    const server = new FakeServer();
    server.tools.set("memory_write_page", (_args, request) => hang(request));
    const memory = client(server, { timeoutMs: 50 });
    await assert.rejects(memory.pages.write({ path: "notes/a.md", body: "x" }), (error: unknown) => {
      assert.ok(error instanceof TimeoutError);
      assert.equal(error.uncertain, true);
      return true;
    });
  });

  it("reports a timeout on a read as certain", async () => {
    const server = new FakeServer();
    server.tools.set("memory_status", (_args, request) => hang(request));
    await assert.rejects(client(server, { timeoutMs: 50 }).status(), (error: unknown) => {
      assert.ok(error instanceof TimeoutError);
      assert.equal(error.uncertain, false);
      return true;
    });
  });

  it("tells a caller abort from the deadline and marks a sent mutation uncertain", async () => {
    const server = new FakeServer();
    server.tools.set("memory_handoff_accept", (_args, request) => hang(request));
    const controller = new AbortController();
    const pending = client(server).handoffs.accept({}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof AbortError);
      assert.equal(error.uncertain, true);
      return true;
    });
  });

  it("does not send anything when the signal is already aborted", async () => {
    const server = new FakeServer();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      client(server).callTool("memory_status", {}, { signal: controller.signal }),
      (error: unknown) => error instanceof AbortError && error.uncertain === false,
    );
    assert.equal(server.requests.length, 0);
  });

  it("honours a per-call timeout override", async () => {
    const server = new FakeServer();
    server.tools.set("memory_status", (_args, request) => hang(request));
    const started = Date.now();
    await assert.rejects(client(server).status({}, { timeoutMs: 30 }), TimeoutError);
    assert.ok(Date.now() - started < 5_000);
  });

  it("makes no automatic retries", async () => {
    const server = new FakeServer();
    server.tools.set("memory_write_page", () => json({ error: "boom" }, 500));
    await assert.rejects(client(server).pages.write({ path: "notes/a.md", body: "x" }), HttpError);
    assert.equal(server.toolCalls().length, 1);
  });
});

describe("response bounds", () => {
  it("refuses a body over maxResponseBytes", async () => {
    const server = new FakeServer();
    server.mcp = async () => text("x".repeat(4096));
    await assert.rejects(
      client(server, { maxResponseBytes: 1024 }).callTool("memory_status", {}),
      ProtocolError,
    );
  });

  it("bounds previews and strips control characters", () => {
    const hostile = `\u001b[31m${"x".repeat(1_000)}`;
    const shown = preview(hostile);
    assert.ok(!shown.includes("\u001b"));
    assert.equal([...shown].length, PREVIEW_LIMIT);
  });
});

describe("stateful sessions", () => {
  it("keeps Mcp-Session-Id, sends notifications/initialized and attaches it", async () => {
    const server = new FakeServer();
    server.sessionId = "session-123";
    server.tools.set("memory_status", () => payloads.status);
    const memory = client(server);
    await memory.status();
    const methods = server.requests.map((r) => (r.body as { method: string }).method);
    assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    assert.equal(server.requests[0]?.headers["mcp-session-id"], undefined);
    for (const request of server.requests.slice(1)) {
      assert.equal(request.headers["mcp-session-id"], "session-123");
    }
    assert.equal((await memory.capabilities()).statefulSession, true);
  });

  it("stays stateless when initialize returns no session id", async () => {
    const server = new FakeServer();
    server.tools.set("memory_status", () => payloads.status);
    await client(server).status();
    const methods = server.requests.map((r) => (r.body as { method: string }).method);
    assert.deepEqual(methods, ["initialize", "tools/list", "tools/call"]);
    assert.ok(server.requests.every((r) => r.headers["mcp-session-id"] === undefined));
  });

  it("refuses an unsupported protocol version", async () => {
    const server = new FakeServer();
    server.protocolVersion = "1999-01-01";
    server.tools.set("memory_status", () => payloads.status);
    await assert.rejects(client(server).status(), UnsupportedServerError);
    assert.equal(server.toolCalls().length, 0);
  });
});

describe("request headers", () => {
  it("sends the MCP accept header, JSON content type and bearer token", async () => {
    const server = new FakeServer();
    server.tools.set("memory_status", () => payloads.status);
    await client(server, { token: "FAKE-token-for-header-test" }).status();
    const call = server.requests.at(-1);
    assert.equal(call?.headers["accept"], "application/json, text/event-stream");
    assert.equal(call?.headers["content-type"], "application/json");
    assert.equal(call?.headers["authorization"], "Bearer FAKE-token-for-header-test");
    assert.equal(call?.method, "POST");
    assert.equal(call?.url, "http://127.0.0.1:49374/mcp");
  });

  it("sends no Authorization header without a token and never X-Memory-Actor-*", async () => {
    const server = new FakeServer();
    server.tools.set("memory_status", () => payloads.status);
    await client(server).status();
    for (const request of server.requests) {
      assert.equal(request.headers["authorization"], undefined);
      assert.ok(Object.keys(request.headers).every((h) => !h.startsWith("x-memory-actor")));
    }
  });

  it("asks fetch never to follow redirects", async () => {
    let redirect: RequestInit["redirect"];
    const memory = new AiMemoryClient({
      serverUrl: "http://127.0.0.1:1",
      fetch: async (_url, init) => {
        redirect = init.redirect;
        return json({});
      },
    });
    await memory.identity().catch(() => undefined);
    assert.equal(redirect, "error");
  });
});
