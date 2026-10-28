// Mock plugin-side bridge — HTTP server emulating the JSON API that
// our native-tool-clients.ts calls into. Used by integration tests
// without needing a real Ghidra/IDA/CE install.
//
// Supports the shared endpoints used by every host bridge:
//   GET  /healthz   — liveness
//   GET  /ready     — readiness (host attached + session loaded)
//   POST /rpc       — JSON { tool, args } → { ok, result | error }

import http from "node:http";

export function startMockBridge({ host = "ghidra", port = 0 } = {}) {
  const handlers = routesFor(host);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname;

    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("access-control-allow-origin", "*");

    if (path === "/healthz") return send(res, 200, { ok: true, host });
    if (path === "/ready")   return send(res, 200, { ok: true, host, ready: true });

    if (path === "/rpc" && req.method === "POST") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        let payload;
        try { payload = JSON.parse(body || "{}"); }
        catch { return send(res, 400, { ok: false, error: "bad json" }); }
        const fn = handlers[payload.tool];
        if (!fn) return send(res, 404, { ok: false, error: `unknown tool: ${payload.tool}` });
        try {
          const result = fn(payload.args || {});
          send(res, 200, { ok: true, result });
        } catch (e) {
          send(res, 500, { ok: false, error: String(e?.message ?? e) });
        }
      });
      return;
    }

    send(res, 404, { ok: false, error: "not found" });
  });

  return new Promise(resolve => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        host,
        port: addr.port,
        url: `http://127.0.0.1:${addr.port}`,
        stop: () => new Promise(r => server.close(() => r())),
      });
    });
  });
}

function send(res, code, obj) {
  res.statusCode = code;
  res.end(JSON.stringify(obj));
}

function routesFor(host) {
  // Minimal but realistic responses — enough to exercise the client wiring
  // without pretending to be a real decompiler.
  const common = {
    ping: () => ({ pong: true, host }),
    version: () => ({ host, version: "mock-1.0" }),
  };

  switch (host) {
    case "ghidra": return {
      ...common,
      list_functions: () => ({ functions: [{ name: "main", entry: "0x401000" }, { name: "foo", entry: "0x401050" }] }),
      decompile: ({ addr }) => ({ addr, code: `// mock decompile @ ${addr}\nint func() { return 0; }` }),
      get_strings: () => ({ strings: ["Hello, world!", "KERNEL32.dll"] }),
    };
    case "ida": return {
      ...common,
      list_functions: () => ({ functions: [{ name: "start", ea: 0x401000 }, { name: "bar", ea: 0x401100 }] }),
      decompile: ({ ea }) => ({ ea, pseudocode: `int __fastcall sub_${(ea||0).toString(16)}() { return 0; }` }),
      get_strings: () => ({ strings: [{ ea: 0x404000, s: "mock-ida-string" }] }),
    };
    case "binja": return {
      ...common,
      list_functions: () => ({ functions: [{ name: "main", addr: 0x1000 }] }),
      hlil: ({ addr }) => ({ addr, hlil: `/* mock hlil ${addr} */` }),
    };
    case "cheat-engine": return {
      ...common,
      process_list: () => ({ processes: [{ pid: 1234, name: "notepad.exe" }] }),
      aob_scan: ({ pattern }) => ({ pattern, hits: ["0x7FF600401000"] }),
      read_bytes: ({ addr, size }) => ({ addr, bytes: Array(size).fill(0x90) }),
    };
    case "reclass": return {
      ...common,
      current_class: () => ({ name: "Player", size: 0x100 }),
      export_header: () => ({ cpp: "struct Player { int health; float x; };" }),
    };
    case "dnspy": case "ilspy": return {
      ...common,
      list_types: () => ({ types: ["System.String", "Game.Player"] }),
      decompile: ({ type }) => ({ type, cs: `// mock decompile of ${type}\nclass Mock { }` }),
    };
    case "x64dbg": return {
      ...common,
      run_cmd: ({ cmd }) => ({ cmd, output: `[mock] ran: ${cmd}` }),
      regs: () => ({ rip: "0x401000", rsp: "0x7FFEE0000000" }),
    };
    default: return common;
  }
}
