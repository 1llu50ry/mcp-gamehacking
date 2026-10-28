#!/usr/bin/env python3
"""
mcp-gamehacking :: Frida host-side bridge.

Standalone — unlike IDA / Ghidra / Binja this is not loaded by a GUI
host, it's a thin HTTP server that drives the `frida` Python module
(https://frida.re). Install:

    pip install frida frida-tools

Run:

    python3 mcp_bridge.py                     # listens on 127.0.0.1:48767
    MCP_FRIDA_PORT=55555 python3 mcp_bridge.py

Then let the server's `frida_*` tools call it over localhost.

Endpoints (all POST JSON unless noted):
    GET  /healthz           — liveness
    GET  /ready             — frida module importable + at least one device
    POST /tool/devices
    POST /tool/ps           — { device?: "local" }
    POST /tool/spawn        — { program: "notepad.exe", device?, args?: [] }
    POST /tool/attach       — { target: pid|name, device? }
    POST /tool/detach       — { session: id }
    POST /tool/inject       — { session: id, script: "<frida JS>" }
    POST /tool/call         — { session: id, exportName: "fn", args: [] }
    POST /tool/trace        — { session: id, pattern: "exports:kernel32!CreateFileW" }
    POST /tool/dump         — { session: id, addr: 0x…, size: N }
    POST /tool/replace      — { session: id, addr: 0x…, bytes: "90 90 CC" }
    POST /tool/exports      — { session: id, module?: "ntdll" }
    POST /tool/modules      — { session: id }

The bridge keeps attached sessions in-process; the session id returned
from /attach is what the other endpoints need. On shutdown every live
session is detached cleanly.
"""

from __future__ import annotations

import os
import sys
import json
import threading
import uuid
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = int(os.environ.get("MCP_FRIDA_PORT", "48767"))
HOST = os.environ.get("MCP_FRIDA_HOST", "127.0.0.1")

# ---- lazy frida import so /healthz works even if frida isn't installed ----
_frida = None
_frida_import_err: Exception | None = None
try:
    import frida  # type: ignore
    _frida = frida
except Exception as e:
    _frida_import_err = e

# session_id → { "session": frida.core.Session, "scripts": [frida.core.Script], "device": str, "pid": int }
_sessions: dict[str, dict] = {}
_lock = threading.Lock()

# A standard Frida script that implements the trace / exports / modules
# building blocks on the agent side. Loaded once per /attach and kept
# around in sess["scripts"][0].
_AGENT_JS = r"""
rpc.exports = {
  modules: function () {
    return Process.enumerateModules().map(m => ({
      name: m.name, base: m.base.toString(), size: m.size, path: m.path,
    }));
  },
  exports: function (module) {
    const mod = module ? Process.findModuleByName(module) : Process.enumerateModules()[0];
    if (!mod) return [];
    return mod.enumerateExports().map(e => ({ name: e.name, address: e.address.toString(), type: e.type }));
  },
  readBytes: function (addr, size) {
    return Memory.readByteArray(ptr(addr), size);
  },
  writeBytes: function (addr, bytes) {
    const b = bytes.split(/\s+/).filter(x => x.length > 0).map(x => parseInt(x, 16));
    Memory.writeByteArray(ptr(addr), b);
    return b.length;
  },
  trace: function (pattern) {
    // pattern "exports:module!function" or raw addr
    const parts = pattern.split(":");
    let target = null;
    if (parts[0] === "exports" && parts[1]) {
      const [mod, sym] = parts[1].split("!");
      target = Module.findExportByName(mod || null, sym);
    } else {
      target = ptr(pattern);
    }
    if (!target) throw new Error("target not found: " + pattern);
    Interceptor.attach(target, {
      onEnter: function (args) {
        send({ kind: "trace", target: pattern, args: [args[0].toString(), args[1].toString(), args[2].toString()] });
      },
      onLeave: function (ret) {
        send({ kind: "trace-ret", target: pattern, ret: ret.toString() });
      }
    });
    return "attached:" + pattern;
  },
  callExport: function (modName, exportName, argInts) {
    const addr = Module.findExportByName(modName || null, exportName);
    if (!addr) throw new Error("export not found: " + modName + "!" + exportName);
    // treat all args as pointers; caller formats them
    const fn = new NativeFunction(addr, "pointer", argInts.map(_ => "pointer"));
    return fn.apply(null, argInts.map(a => ptr(a))).toString();
  },
};
"""


def _ok(result):
    return {"ok": True, "result": result}


def _err(msg, trace=None):
    return {"ok": False, "error": str(msg), "trace": trace}


def _require_frida():
    if _frida is None:
        raise RuntimeError(f"frida module not installed: {_frida_import_err}")


def _device(name: str | None):
    _require_frida()
    mgr = _frida.get_device_manager()
    if not name or name == "local":
        return _frida.get_local_device()
    for d in mgr.enumerate_devices():
        if d.id == name or d.name == name:
            return d
    raise RuntimeError(f"no device: {name}")


def op_devices(_):
    _require_frida()
    return [{"id": d.id, "name": d.name, "type": d.type} for d in _frida.enumerate_devices()]


def op_ps(args):
    d = _device(args.get("device"))
    procs = d.enumerate_processes()
    return [{"pid": p.pid, "name": p.name} for p in procs]


def op_spawn(args):
    d = _device(args.get("device"))
    pid = d.spawn([args["program"], *args.get("args", [])])
    return {"pid": pid, "resumed": False}


def op_attach(args):
    d = _device(args.get("device"))
    target = args["target"]
    sess = d.attach(target)
    script = sess.create_script(_AGENT_JS)
    sess.messages = []  # type: ignore[attr-defined]

    def on_message(message, _data):
        try:
            sess.messages.append(message)  # type: ignore[attr-defined]
            if len(sess.messages) > 1024:  # type: ignore[attr-defined]
                sess.messages = sess.messages[-1024:]  # type: ignore[attr-defined]
        except Exception:
            pass

    script.on("message", on_message)
    script.load()
    sid = uuid.uuid4().hex[:16]
    with _lock:
        _sessions[sid] = {"session": sess, "scripts": [script], "device": d.id, "pid": target}
    return {"session": sid, "device": d.id, "pid": target}


def _get_session(sid):
    with _lock:
        rec = _sessions.get(sid)
    if not rec:
        raise RuntimeError(f"unknown session: {sid}")
    return rec


def op_detach(args):
    sid = args["session"]
    rec = _get_session(sid)
    try:
        for s in rec["scripts"]:
            try: s.unload()
            except Exception: pass
        rec["session"].detach()
    finally:
        with _lock:
            _sessions.pop(sid, None)
    return {"detached": sid}


def op_inject(args):
    rec = _get_session(args["session"])
    script = rec["session"].create_script(args["script"])
    script.on("message", lambda m, d: None)
    script.load()
    rec["scripts"].append(script)
    return {"scripts": len(rec["scripts"])}


def op_call(args):
    rec = _get_session(args["session"])
    agent = rec["scripts"][0].exports_sync
    return {"ret": agent.call_export(args.get("module"), args["exportName"], args.get("args", []))}


def op_trace(args):
    rec = _get_session(args["session"])
    agent = rec["scripts"][0].exports_sync
    return {"status": agent.trace(args["pattern"])}


def op_dump(args):
    rec = _get_session(args["session"])
    agent = rec["scripts"][0].exports_sync
    buf = agent.read_bytes(str(args["addr"]), int(args["size"]))
    return {"addr": args["addr"], "size": len(buf) if buf else 0, "hex": buf.hex() if buf else ""}


def op_replace(args):
    rec = _get_session(args["session"])
    agent = rec["scripts"][0].exports_sync
    n = agent.write_bytes(str(args["addr"]), args["bytes"])
    return {"written": n}


def op_exports(args):
    rec = _get_session(args["session"])
    agent = rec["scripts"][0].exports_sync
    return {"exports": agent.exports(args.get("module"))}


def op_modules(args):
    rec = _get_session(args["session"])
    agent = rec["scripts"][0].exports_sync
    return {"modules": agent.modules()}


ROUTES = {
    "/tool/devices": op_devices,
    "/tool/ps":      op_ps,
    "/tool/spawn":   op_spawn,
    "/tool/attach":  op_attach,
    "/tool/detach":  op_detach,
    "/tool/inject":  op_inject,
    "/tool/call":    op_call,
    "/tool/trace":   op_trace,
    "/tool/dump":    op_dump,
    "/tool/replace": op_replace,
    "/tool/exports": op_exports,
    "/tool/modules": op_modules,
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a, **kw): pass  # quiet

    def _send(self, code, obj):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/healthz":
            return self._send(200, {"ok": True, "host": "frida", "frida_installed": _frida is not None})
        if path == "/ready":
            try:
                _require_frida()
                _ = _frida.enumerate_devices()
                return self._send(200, {"ok": True, "host": "frida", "ready": True})
            except Exception as e:
                return self._send(503, {"ok": False, "ready": False, "error": str(e)})
        return self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        fn = ROUTES.get(path)
        if not fn:
            return self._send(404, {"ok": False, "error": "unknown route"})
        length = int(self.headers.get("content-length", "0") or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            args = json.loads(raw) if raw else {}
        except Exception as e:
            return self._send(400, _err(f"bad json: {e}"))
        try:
            return self._send(200, _ok(fn(args)))
        except Exception as e:
            return self._send(500, _err(e, trace=traceback.format_exc()))


def main():
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[frida-bridge] listening on http://{HOST}:{PORT}  (frida={'ok' if _frida else 'missing'})", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        with _lock:
            for sid, rec in list(_sessions.items()):
                try: rec["session"].detach()
                except Exception: pass
        srv.server_close()


if __name__ == "__main__":
    main()
