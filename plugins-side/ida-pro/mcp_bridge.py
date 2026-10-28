# mcp-gamehacking :: IDA Pro plugin
# ---------------------------------------------------------------
# Save as `<ida>/plugins/mcp_bridge.py` and restart IDA.
# Alternatively, load manually: File > Script File > this file.
# Exposes HTTP MCP on 127.0.0.1:48761.
#
#   GET  /healthz        -> {"ok": true, "idb": "<path>"}
#   POST /tool/functions {}
#   POST /tool/decompile {"function": "<name|ea>"}
#   POST /tool/disasm    {"ea": "0x401000", "size": 256}
#   POST /tool/xrefs     {"to": "<name|ea>"}
#   POST /tool/strings   {"min": 6}
#   POST /tool/rename    {"ea": "0x401000", "name": "my_func"}

import threading

try:
    from http.server import BaseHTTPRequestHandler, HTTPServer
except ImportError:
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer

import json

import idaapi
import idc
import idautils
import ida_funcs
import ida_name
import ida_bytes
import ida_lines
import ida_strlist
import ida_hexrays

MCP_HOST = "127.0.0.1"
MCP_PORT = 48761


def resolve_ea(ident):
    """Accepts a function name, '0xADDR', or decimal address."""
    try:
        ea = int(ident, 0) if isinstance(ident, str) else int(ident)
        return ea
    except Exception:
        pass
    ea = ida_name.get_name_ea(idaapi.BADADDR, ident)
    return ea if ea != idaapi.BADADDR else None


def list_functions(limit=5000):
    out = []
    for ea in idautils.Functions():
        name = idc.get_func_name(ea)
        f = ida_funcs.get_func(ea)
        size = (f.end_ea - f.start_ea) if f else 0
        out.append({"name": name, "ea": "0x{:X}".format(ea), "size": size})
        if len(out) >= limit:
            break
    return out


def decompile(ident):
    ea = resolve_ea(ident)
    if ea is None:
        return None, "function not found: {}".format(ident)
    if not ida_hexrays.init_hexrays_plugin():
        return None, "Hex-Rays not available"
    try:
        cfunc = ida_hexrays.decompile(ea)
        if not cfunc:
            return None, "decompile failed at 0x{:X}".format(ea)
        return str(cfunc), None
    except Exception as e:
        return None, "exception: {}".format(e)


def disasm(ea, size=256):
    ea = resolve_ea(ea) if isinstance(ea, str) else ea
    if ea is None:
        return None, "bad ea"
    out = []
    curr = ea
    while curr < ea + size:
        line = idc.generate_disasm_line(curr, 0) or ""
        line = ida_lines.tag_remove(line)
        out.append({"ea": "0x{:X}".format(curr), "text": line})
        n = idc.next_head(curr, ea + size + 16)
        if n == idaapi.BADADDR or n <= curr:
            break
        curr = n
    return out, None


def xrefs_to(ident):
    ea = resolve_ea(ident)
    if ea is None:
        return None, "bad target"
    out = []
    for ref in idautils.XrefsTo(ea, 0):
        out.append({"from": "0x{:X}".format(ref.frm), "type": idautils.XrefTypeName(ref.type)})
    return out, None


def list_strings(min_len=6, limit=5000):
    out = []
    sl = ida_strlist.strlist_t()
    ida_strlist.build_strlist()
    for i in range(ida_strlist.get_strlist_qty()):
        si = ida_strlist.string_info_t()
        if not ida_strlist.get_strlist_item(si, i):
            continue
        s = idc.get_strlit_contents(si.ea, si.length, si.type) or b""
        try:
            text = s.decode("utf-8", errors="replace")
        except Exception:
            text = str(s)
        if len(text) < min_len:
            continue
        out.append({"ea": "0x{:X}".format(si.ea), "text": text, "length": si.length})
        if len(out) >= limit:
            break
    _ = sl
    return out


def rename(ea, name):
    ea = resolve_ea(ea) if isinstance(ea, str) else ea
    if ea is None:
        return False
    return bool(idc.set_name(ea, name, idc.SN_NOWARN | idc.SN_FORCE))


# ----- HTTP server -----
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
            idb = idc.get_idb_path() if hasattr(idc, "get_idb_path") else ""
            self._w(200, {"ok": True, "idb": idb})
            return
        self._w(404, {"error": "unknown path"})

    def do_POST(self):
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
            self._w(400 if err else 200, {"error": err} if err else {"c": c})
        elif self.path == "/tool/disasm":
            d, err = disasm(p.get("ea"), p.get("size", 256))
            self._w(400 if err else 200, {"error": err} if err else {"lines": d})
        elif self.path == "/tool/xrefs":
            x, err = xrefs_to(p.get("to"))
            self._w(400 if err else 200, {"error": err} if err else {"xrefs": x})
        elif self.path == "/tool/strings":
            self._w(200, {"strings": list_strings(p.get("min", 6), p.get("limit", 5000))})
        elif self.path == "/tool/rename":
            ok = rename(p.get("ea"), p.get("name", ""))
            self._w(200 if ok else 400, {"ok": ok})
        else:
            self._w(404, {"error": "unknown path"})


class McpBridgePlugin(idaapi.plugin_t):
    flags = idaapi.PLUGIN_FIX
    comment = "mcp-gamehacking bridge"
    help = "https://github.com/1llu50ry/mcp-gamehacking"
    wanted_name = "MCP Bridge"
    wanted_hotkey = ""

    def init(self):
        srv = HTTPServer((MCP_HOST, MCP_PORT), Handler)
        print("[mcp-bridge] IDA MCP on http://{}:{}".format(MCP_HOST, MCP_PORT))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return idaapi.PLUGIN_KEEP

    def run(self, arg):  # noqa: ARG002
        return

    def term(self):
        return


def PLUGIN_ENTRY():
    return McpBridgePlugin()
