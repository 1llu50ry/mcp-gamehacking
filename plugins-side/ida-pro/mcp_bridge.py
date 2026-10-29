# mcp-reverse :: IDA Pro plugin
# ---------------------------------------------------------------
# Save as `<ida>/plugins/mcp_bridge.py` and restart IDA. The plugin
# auto-loads via PLUG_INITSTRUCT with PLUGIN_FIX. HTTP MCP on
# 127.0.0.1:48761 (override: MCP_IDA_PORT env var).
#
# Routes
#   GET  /healthz        -> {"ok": true, "idb": "<path>"}
#   GET  /ready          -> {"ready": <bool>, "analysis": <percentage>}
#   POST /tool/functions {}
#   POST /tool/decompile {"function": "<name|ea>"}
#   POST /tool/disasm    {"ea": "0x401000", "size": 256}
#   POST /tool/xrefs     {"to": "<name|ea>"}
#   POST /tool/strings   {"min": 6, "limit": 5000}
#   POST /tool/rename    {"ea": "0x401000", "name": "my_func"}
#   POST /tool/comment   {"ea": "0x401000", "text": "..."}
#   POST /tool/segment   {"ea": "0x401000"}
#
# CORS: every response carries access-control-allow-origin: * so a
# browser-based MCP client (claude.ai, Cursor web) can hit it.
#
# Thread safety: IDA's SDK is not thread-safe. We funnel every call
# through ida_kernwin.execute_sync so handlers run on IDA's main
# thread. Without it, calling ida_hexrays.decompile from an HTTP
# worker thread deadlocks IDA.

import json
import os
import threading

try:
    # Python 3 (IDA 7.4+)
    from http.server import BaseHTTPRequestHandler, HTTPServer
except ImportError:
    # Python 2 (IDA 7.0-7.3)
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer  # type: ignore

import idaapi
import idc
import idautils
import ida_funcs
import ida_name
import ida_hexrays
import ida_kernwin
import ida_bytes

MCP_HOST = os.environ.get("MCP_IDA_HOST", "127.0.0.1")
MCP_PORT = int(os.environ.get("MCP_IDA_PORT", "48761"))


# --- primitives (run on IDA main thread via execute_sync) --------
def _on_main(fn):
    """Decorator: dispatch fn to IDA's main thread and return result."""
    def wrapper(*args, **kwargs):
        box = {}
        def runner():
            try:
                box["result"] = fn(*args, **kwargs)
            except Exception as e:
                box["error"] = str(e)
            return 1
        ida_kernwin.execute_sync(runner, ida_kernwin.MFF_READ)
        if "error" in box:
            raise RuntimeError(box["error"])
        return box.get("result")
    return wrapper


def _on_main_write(fn):
    def wrapper(*args, **kwargs):
        box = {}
        def runner():
            try:
                box["result"] = fn(*args, **kwargs)
            except Exception as e:
                box["error"] = str(e)
            return 1
        ida_kernwin.execute_sync(runner, ida_kernwin.MFF_WRITE)
        if "error" in box:
            raise RuntimeError(box["error"])
        return box.get("result")
    return wrapper


def resolve_ea(ident):
    """name | '0xADDR' | int → EA, or None."""
    if ident is None:
        return None
    if isinstance(ident, int):
        return ident
    try:
        return int(ident, 0)
    except Exception:
        pass
    ea = ida_name.get_name_ea(idaapi.BADADDR, ident)
    return ea if ea != idaapi.BADADDR else None


@_on_main
def list_functions(limit=5000):
    out = []
    for ea in idautils.Functions():
        name = idc.get_func_name(ea) or ""
        f = ida_funcs.get_func(ea)
        size = (f.end_ea - f.start_ea) if f else 0
        out.append({"name": name, "ea": "0x{:X}".format(ea), "size": size})
        if len(out) >= limit:
            break
    return out


@_on_main
def decompile(ident):
    ea = resolve_ea(ident)
    if ea is None:
        return {"error": "function not found: {}".format(ident)}
    if not ida_hexrays.init_hexrays_plugin():
        return {"error": "Hex-Rays not available in this IDA edition"}
    try:
        cfunc = ida_hexrays.decompile(ea)
        if not cfunc:
            return {"error": "decompile failed at 0x{:X}".format(ea)}
        return {"c": str(cfunc), "ea": "0x{:X}".format(ea)}
    except ida_hexrays.DecompilationFailure as e:
        return {"error": "DecompilationFailure: {}".format(e)}


@_on_main
def disasm(ea_in, size=256):
    ea = resolve_ea(ea_in) if isinstance(ea_in, str) else ea_in
    if ea is None:
        return {"error": "bad ea"}
    out = []
    curr = ea
    end = ea + size
    while curr < end:
        line = idc.generate_disasm_line(curr, 0) or ""
        # strip IDA color tags
        try:
            from ida_lines import tag_remove
            line = tag_remove(line)
        except Exception:
            pass
        out.append({"ea": "0x{:X}".format(curr), "text": line})
        n = idc.next_head(curr, end + 16)
        if n == idaapi.BADADDR or n <= curr:
            break
        curr = n
    return {"lines": out}


@_on_main
def xrefs_to(ident):
    ea = resolve_ea(ident)
    if ea is None:
        return {"error": "bad target"}
    out = []
    for ref in idautils.XrefsTo(ea, 0):
        out.append({
            "from": "0x{:X}".format(ref.frm),
            "type": idautils.XrefTypeName(ref.type),
            "iscode": bool(ref.iscode),
        })
    return {"xrefs": out}


@_on_main
def list_strings(min_len=6, limit=5000):
    # idautils.Strings() is the modern, Python-friendly iterator.
    # It handles the `strlist_t` + `string_info_t` dance internally.
    out = []
    s_iter = idautils.Strings()
    s_iter.setup()  # ensures the string list is current
    for s in s_iter:
        text = str(s)
        if len(text) < min_len:
            continue
        out.append({
            "ea": "0x{:X}".format(s.ea),
            "text": text,
            "length": s.length,
            "type": s.strtype,
        })
        if len(out) >= limit:
            break
    return {"strings": out}


@_on_main_write
def rename(ea_in, name):
    ea = resolve_ea(ea_in) if isinstance(ea_in, str) else ea_in
    if ea is None:
        return {"ok": False, "error": "bad ea"}
    ok = bool(idc.set_name(ea, name, idc.SN_NOWARN | idc.SN_FORCE))
    return {"ok": ok, "ea": "0x{:X}".format(ea), "name": name}


@_on_main_write
def set_comment(ea_in, text):
    ea = resolve_ea(ea_in) if isinstance(ea_in, str) else ea_in
    if ea is None:
        return {"ok": False, "error": "bad ea"}
    ida_bytes.set_cmt(ea, text, 0)
    return {"ok": True}


@_on_main
def segment_info(ea_in):
    ea = resolve_ea(ea_in) if isinstance(ea_in, str) else ea_in
    if ea is None:
        return {"error": "bad ea"}
    seg = idaapi.getseg(ea)
    if not seg:
        return {"error": "no segment at 0x{:X}".format(ea)}
    return {
        "name": idaapi.get_segm_name(seg),
        "start": "0x{:X}".format(seg.start_ea),
        "end": "0x{:X}".format(seg.end_ea),
        "perm": seg.perm,
        "bitness": seg.bitness,
    }


@_on_main
def readiness():
    try:
        from ida_auto import get_auto_state, AU_NONE
        state = get_auto_state()
        return {"ready": state == AU_NONE, "state": state}
    except Exception:
        return {"ready": True, "state": "unknown"}


# ----- HTTP handler -------------------------------------------------
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
        pass  # silence stdout

    def do_OPTIONS(self):
        self._w(204, {})

    def do_GET(self):
        if self.path == "/healthz":
            idb_path = ""
            try:
                idb_path = idc.get_idb_path() if hasattr(idc, "get_idb_path") else ""
            except Exception:
                pass
            self._w(200, {"ok": True, "idb": idb_path, "port": MCP_PORT})
            return
        if self.path == "/ready":
            self._w(200, readiness())
            return
        self._w(404, {"error": "unknown path: " + self.path})

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            p = json.loads(raw.decode("utf-8"))
        except Exception:
            p = {}
        try:
            if self.path == "/tool/functions":
                self._w(200, {"functions": list_functions(p.get("limit", 5000))})
            elif self.path == "/tool/decompile":
                r = decompile(p.get("function"))
                self._w(400 if "error" in r else 200, r)
            elif self.path == "/tool/disasm":
                r = disasm(p.get("ea"), p.get("size", 256))
                self._w(400 if "error" in r else 200, r)
            elif self.path == "/tool/xrefs":
                r = xrefs_to(p.get("to"))
                self._w(400 if "error" in r else 200, r)
            elif self.path == "/tool/strings":
                self._w(200, list_strings(p.get("min", 6), p.get("limit", 5000)))
            elif self.path == "/tool/rename":
                r = rename(p.get("ea"), p.get("name", ""))
                self._w(200 if r.get("ok") else 400, r)
            elif self.path == "/tool/comment":
                r = set_comment(p.get("ea"), p.get("text", ""))
                self._w(200 if r.get("ok") else 400, r)
            elif self.path == "/tool/segment":
                r = segment_info(p.get("ea"))
                self._w(400 if "error" in r else 200, r)
            else:
                self._w(404, {"error": "unknown path: " + self.path})
        except Exception as e:
            self._w(500, {"error": "handler exception: " + str(e)})


# ----- plugin lifecycle ---------------------------------------------
class McpBridgePlugin(idaapi.plugin_t):
    flags = idaapi.PLUGIN_FIX
    comment = "mcp-reverse bridge"
    help = "https://github.com/1llu50ry/mcp-reverse/tree/main/plugins-side/ida-pro"
    wanted_name = "MCP Bridge"
    wanted_hotkey = ""

    def init(self):
        try:
            srv = HTTPServer((MCP_HOST, MCP_PORT), Handler)
            print("[mcp-bridge] IDA MCP on http://{}:{}".format(MCP_HOST, MCP_PORT))
            t = threading.Thread(target=srv.serve_forever)
            t.daemon = True
            t.start()
        except Exception as e:
            print("[mcp-bridge] failed to start: {}".format(e))
        return idaapi.PLUGIN_KEEP

    def run(self, arg):  # noqa: ARG002
        print("[mcp-bridge] running on http://{}:{}".format(MCP_HOST, MCP_PORT))

    def term(self):
        pass


def PLUGIN_ENTRY():
    return McpBridgePlugin()
