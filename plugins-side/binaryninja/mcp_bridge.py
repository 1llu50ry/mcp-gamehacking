# mcp-gamehacking :: Binary Ninja plugin
# ---------------------------------------------------------------
# Save as `<binja>/plugins/mcp_bridge.py`. HTTP MCP on
# 127.0.0.1:48766.
#
#   GET  /healthz        -> {"ok":true,"bndb":"<path>","functions":<n>}
#   POST /tool/functions {}
#   POST /tool/decompile {"function": "<name|hex>"}      — HLIL C
#   POST /tool/xrefs     {"to": "<name|hex>"}
#   POST /tool/strings   {"min": 6}
#   POST /tool/rename    {"ea":"0x401000","name":"my_func"}

import json
import threading

try:
    from http.server import BaseHTTPRequestHandler, HTTPServer
except ImportError:
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer

import binaryninja
from binaryninja import BinaryViewType

MCP_HOST = "127.0.0.1"
MCP_PORT = 48766

_bv = None  # set on first open


def set_bv(bv):
    global _bv
    _bv = bv


def _resolve(bv, ident):
    if isinstance(ident, int):
        return ident
    try:
        return int(ident, 0)
    except Exception:
        pass
    for f in bv.functions:
        if f.name == ident:
            return f.start
    sym = bv.get_symbol_by_raw_name(ident)
    return sym.address if sym else None


def list_functions(limit=5000):
    return [{"name": f.name, "ea": "0x{:X}".format(f.start),
             "size": sum(bb.length for bb in f.basic_blocks)} for f in list(_bv.functions)[:limit]]


def decompile(ident):
    ea = _resolve(_bv, ident)
    if ea is None:
        return None, "function not found"
    f = _bv.get_function_at(ea)
    if not f:
        return None, "no function at 0x{:X}".format(ea)
    hlil = f.hlil
    return "\n".join(str(line) for bb in hlil for line in bb), None


def xrefs_to(ident):
    ea = _resolve(_bv, ident)
    if ea is None:
        return None, "bad target"
    return [{"from": "0x{:X}".format(r.address), "function": r.function.name} for r in _bv.get_code_refs(ea)], None


def list_strings(min_len=6, limit=5000):
    out = []
    for s in _bv.strings:
        if s.length < min_len:
            continue
        out.append({"ea": "0x{:X}".format(s.start), "text": s.value, "length": s.length})
        if len(out) >= limit:
            break
    return out


def rename(ea, name):
    ea = _resolve(_bv, ea) if isinstance(ea, str) else ea
    if ea is None:
        return False
    f = _bv.get_function_at(ea)
    if not f:
        return False
    f.name = name
    return True


class Handler(BaseHTTPRequestHandler):
    def _w(self, code, body):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path == "/healthz":
            self._w(200, {"ok": _bv is not None, "bndb": getattr(_bv, "file", None) and _bv.file.filename, "functions": len(list(_bv.functions)) if _bv else 0})
            return
        self._w(404, {"error": "unknown path"})

    def do_POST(self):
        if _bv is None:
            return self._w(400, {"error": "no bndb loaded"})
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length) if length else b"{}"
        try:
            p = json.loads(body)
        except Exception:
            p = {}
        if self.path == "/tool/functions":
            self._w(200, {"functions": list_functions(p.get("limit", 5000))})
        elif self.path == "/tool/decompile":
            c, err = decompile(p.get("function"))
            self._w(400 if err else 200, {"error": err} if err else {"hlil": c})
        elif self.path == "/tool/xrefs":
            x, err = xrefs_to(p.get("to"))
            self._w(400 if err else 200, {"error": err} if err else {"xrefs": x})
        elif self.path == "/tool/strings":
            self._w(200, {"strings": list_strings(p.get("min", 6), p.get("limit", 5000))})
        elif self.path == "/tool/rename":
            self._w(200, {"ok": rename(p.get("ea"), p.get("name", ""))})
        else:
            self._w(404, {"error": "unknown path"})


def _start_server():
    srv = HTTPServer((MCP_HOST, MCP_PORT), Handler)
    binaryninja.log_info("[mcp-bridge] Binja MCP on http://{}:{}".format(MCP_HOST, MCP_PORT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()


# Register a BV-open callback so we pick up whatever the user opens next.
def _on_bv_open(bv):
    set_bv(bv)
    binaryninja.log_info("[mcp-bridge] bound to {}".format(bv.file.filename))


binaryninja.BinaryView.add_handler(_on_bv_open) if hasattr(binaryninja.BinaryView, "add_handler") else None
_start_server()
