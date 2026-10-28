# mcp-gamehacking :: Binary Ninja plugin
# ---------------------------------------------------------------
# Save as `<binja>/plugins/mcp_bridge.py` or `~/.binaryninja/plugins/
# mcp_bridge.py`. On start the plugin spins an HTTP server on
# 127.0.0.1:48766 (override: MCP_BINJA_PORT).
#
# Binja's SDK is thread-safe (BinaryViewType / BinaryView carry their
# own locks) so handlers can run on the HTTP worker thread. We just
# need to pick which BV to operate on, since the user may have several
# tabs open. We expose a Plugin command "MCP Bridge: bind this view"
# that captures the active BV; if no explicit bind happened, every
# request falls back to the "last opened" BV.
#
# Routes
#   GET  /healthz        -> {"ok": true, "bndb": "<path>", "functions": N}
#   GET  /ready          -> {"ready": bool, "analysis_state": str}
#   POST /tool/functions {"limit": 5000}
#   POST /tool/decompile {"function": "<name|hex>"}
#   POST /tool/mlil      {"function": "<name|hex>"}
#   POST /tool/xrefs     {"to": "<name|hex>"}
#   POST /tool/strings   {"min": 6, "limit": 5000}
#   POST /tool/rename    {"ea":"0x401000", "name":"my_func"}
#   POST /tool/segments  {}
#   POST /tool/symbols   {"filter": "sub_"}
#
# CORS enabled on every response.

from __future__ import absolute_import
import json
import os
import threading

try:
    from http.server import BaseHTTPRequestHandler, HTTPServer
except ImportError:
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer  # type: ignore

import binaryninja  # noqa: F401
from binaryninja import PluginCommand, BinaryView, log_info, log_warn, log_error

MCP_HOST = os.environ.get("MCP_BINJA_HOST", "127.0.0.1")
MCP_PORT = int(os.environ.get("MCP_BINJA_PORT", "48766"))


# BV registry — we track every BV Binja opens and pick the "active"
# one for requests. The user can also bind a specific one via the
# plugin command.
_bv_lock = threading.Lock()
_bvs = []           # list[BinaryView]
_active_bv = None   # BinaryView | None


def _bind(bv):
    global _active_bv
    with _bv_lock:
        if bv not in _bvs:
            _bvs.append(bv)
        _active_bv = bv
    log_info("[mcp-bridge] bound to {}".format(bv.file.filename))


def _pick():
    with _bv_lock:
        if _active_bv is not None:
            return _active_bv
        return _bvs[-1] if _bvs else None


# Register user-facing plugin command so a user can explicitly bind
# a specific BV. Binja auto-exposes it in the right-click menu / command
# palette.
PluginCommand.register(
    "MCP Bridge: bind this view",
    "Make this BinaryView the active target of the MCP bridge",
    _bind,
)


# --- primitives --------------------------------------------------------
def _resolve(bv, ident):
    if isinstance(ident, int):
        return ident
    if not ident:
        return None
    try:
        return int(ident, 0)
    except Exception:
        pass
    for f in bv.functions:
        if f.name == ident:
            return f.start
    sym = bv.get_symbol_by_raw_name(ident) if hasattr(bv, "get_symbol_by_raw_name") else None
    if sym:
        return sym.address
    # Fallback: generic symbol lookup
    syms = bv.get_symbols_by_name(ident) if hasattr(bv, "get_symbols_by_name") else []
    return syms[0].address if syms else None


def list_functions(bv, limit=5000):
    out = []
    for f in bv.functions:
        out.append({
            "name": f.name,
            "ea": "0x{:X}".format(f.start),
            "size": sum(bb.length for bb in f.basic_blocks),
        })
        if len(out) >= limit:
            break
    return out


def decompile_hlil(bv, ident):
    ea = _resolve(bv, ident)
    if ea is None:
        return None, "function not found"
    f = bv.get_function_at(ea)
    if not f:
        # try containing function
        fs = bv.get_functions_containing(ea)
        f = fs[0] if fs else None
    if not f:
        return None, "no function at 0x{:X}".format(ea)
    try:
        hlil = f.hlil
        if hlil is None:
            return None, "HLIL not available"
        return "\n".join(str(line) for bb in hlil for line in bb), None
    except Exception as e:
        return None, "hlil error: {}".format(e)


def decompile_mlil(bv, ident):
    ea = _resolve(bv, ident)
    if ea is None:
        return None, "function not found"
    f = bv.get_function_at(ea)
    if not f:
        fs = bv.get_functions_containing(ea)
        f = fs[0] if fs else None
    if not f:
        return None, "no function at 0x{:X}".format(ea)
    try:
        mlil = f.mlil
        return "\n".join(str(line) for bb in mlil for line in bb), None
    except Exception as e:
        return None, "mlil error: {}".format(e)


def xrefs_to(bv, ident):
    ea = _resolve(bv, ident)
    if ea is None:
        return None, "bad target"
    out = []
    for r in bv.get_code_refs(ea):
        out.append({
            "from": "0x{:X}".format(r.address),
            "function": r.function.name if r.function else None,
        })
    return out, None


def list_strings(bv, min_len=6, limit=5000):
    out = []
    for s in bv.strings:
        if s.length < min_len:
            continue
        out.append({"ea": "0x{:X}".format(s.start), "text": s.value, "length": s.length})
        if len(out) >= limit:
            break
    return out


def rename(bv, ea_in, name):
    ea = _resolve(bv, ea_in) if isinstance(ea_in, str) else ea_in
    if ea is None:
        return False
    f = bv.get_function_at(ea)
    if not f:
        fs = bv.get_functions_containing(ea)
        f = fs[0] if fs else None
    if not f:
        return False
    f.name = name
    return True


def segments(bv):
    return [{
        "start": "0x{:X}".format(s.start),
        "end": "0x{:X}".format(s.end),
        "readable": s.readable,
        "writable": s.writable,
        "executable": s.executable,
    } for s in bv.segments]


def symbols(bv, filt=""):
    out = []
    for sym in bv.get_symbols():
        if filt and filt not in sym.name:
            continue
        out.append({
            "name": sym.name,
            "ea": "0x{:X}".format(sym.address),
            "type": str(sym.type),
        })
        if len(out) >= 5000:
            break
    return out


# ----- HTTP handler ---------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def _w(self, code, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET,POST,OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        pass

    def do_OPTIONS(self):
        self._w(204, {})

    def do_GET(self):
        bv = _pick()
        if self.path == "/healthz":
            self._w(200, {
                "ok": bv is not None,
                "bndb": bv.file.filename if bv else None,
                "functions": len(list(bv.functions)) if bv else 0,
                "port": MCP_PORT,
            })
            return
        if self.path == "/ready":
            if bv is None:
                self._w(200, {"ready": False, "analysis_state": "no view bound"})
                return
            # Binja returns one of: IdleState, DisassembleState, AnalyzeState
            state = str(bv.analysis_info.state) if hasattr(bv, "analysis_info") else "unknown"
            ready = ("Idle" in state)
            self._w(200, {"ready": ready, "analysis_state": state})
            return
        self._w(404, {"error": "unknown path: " + self.path})

    def do_POST(self):
        bv = _pick()
        if bv is None:
            return self._w(400, {"error": "no BinaryView bound; open a bndb and run the 'MCP Bridge: bind this view' command"})
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            p = json.loads(raw.decode("utf-8"))
        except Exception:
            p = {}
        try:
            if self.path == "/tool/functions":
                self._w(200, {"functions": list_functions(bv, p.get("limit", 5000))})
            elif self.path == "/tool/decompile":
                c, err = decompile_hlil(bv, p.get("function"))
                self._w(400 if err else 200, {"error": err} if err else {"hlil": c})
            elif self.path == "/tool/mlil":
                c, err = decompile_mlil(bv, p.get("function"))
                self._w(400 if err else 200, {"error": err} if err else {"mlil": c})
            elif self.path == "/tool/xrefs":
                x, err = xrefs_to(bv, p.get("to"))
                self._w(400 if err else 200, {"error": err} if err else {"xrefs": x})
            elif self.path == "/tool/strings":
                self._w(200, {"strings": list_strings(bv, p.get("min", 6), p.get("limit", 5000))})
            elif self.path == "/tool/rename":
                self._w(200, {"ok": rename(bv, p.get("ea"), p.get("name", ""))})
            elif self.path == "/tool/segments":
                self._w(200, {"segments": segments(bv)})
            elif self.path == "/tool/symbols":
                self._w(200, {"symbols": symbols(bv, p.get("filter", ""))})
            else:
                self._w(404, {"error": "unknown path: " + self.path})
        except Exception as e:
            self._w(500, {"error": "handler exception: " + str(e)})


def _start_server():
    try:
        srv = HTTPServer((MCP_HOST, MCP_PORT), Handler)
        log_info("[mcp-bridge] Binja MCP on http://{}:{}".format(MCP_HOST, MCP_PORT))
        t = threading.Thread(target=srv.serve_forever)
        t.daemon = True
        t.start()
    except Exception as e:
        log_error("[mcp-bridge] failed to start: {}".format(e))


_start_server()
