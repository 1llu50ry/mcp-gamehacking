# mcp-gamehacking :: Ghidra Jython plugin
# ---------------------------------------------------------------
# Save as `<ghidra_user>/ghidra_scripts/mcp_bridge.py` and run it
# from Ghidra's Script Manager, OR launch via `analyzeHeadless`:
#
#   analyzeHeadless <project> <name> -process <bin> \
#       -postScript mcp_bridge.py
#
# Exposes a minimal HTTP MCP surface on 127.0.0.1:48760. Our native
# TS tools (ghidra_decompile, ghidra_xrefs, ghidra_functions,
# ghidra_strings) talk to it.
#
#   GET  /healthz        -> {"ok": true, "program": "<name>"}
#   POST /tool/functions {} -> list of {name, entry, size}
#   POST /tool/decompile {"function": "<name|addr>"}
#   POST /tool/xrefs     {"to": "<name|addr>"}
#   POST /tool/strings   {"min": 6}

#@category MCP
#@menupath MCP.mcp_bridge
import json
import threading
from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer

from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor
from ghidra.program.model.address import GenericAddress  # noqa: F401

MCP_HOST = "127.0.0.1"
MCP_PORT = 48760

_program = None  # populated at startup

def resolve_function(ident):
    fm = _program.getFunctionManager()
    f = fm.getFunction(ident)
    if f:
        return f
    # by address
    try:
        addr = _program.getAddressFactory().getAddress(ident)
        if addr:
            return fm.getFunctionAt(addr)
    except Exception:
        pass
    # by exact name
    for fn in fm.getFunctions(True):
        if fn.getName() == ident:
            return fn
    return None


def decompile(ident):
    f = resolve_function(ident)
    if not f:
        return None, "function not found: {}".format(ident)
    di = DecompInterface()
    di.openProgram(_program)
    try:
        res = di.decompileFunction(f, 60, ConsoleTaskMonitor())
        if not res.decompileCompleted():
            return None, "decompile failed: {}".format(res.getErrorMessage())
        return res.getDecompiledFunction().getC(), None
    finally:
        di.dispose()


def xrefs_to(ident):
    addr = None
    f = resolve_function(ident)
    if f:
        addr = f.getEntryPoint()
    else:
        addr = _program.getAddressFactory().getAddress(ident)
    if not addr:
        return None, "could not resolve address for: {}".format(ident)
    out = []
    for ref in _program.getReferenceManager().getReferencesTo(addr):
        from_addr = ref.getFromAddress()
        out.append({"from": str(from_addr), "type": str(ref.getReferenceType())})
    return out, None


def list_functions(limit=1000):
    fm = _program.getFunctionManager()
    out = []
    for fn in fm.getFunctions(True):
        out.append({
            "name": fn.getName(),
            "entry": str(fn.getEntryPoint()),
            "size": fn.getBody().getNumAddresses(),
        })
        if len(out) >= limit:
            break
    return out


def list_strings(min_len=6, limit=5000):
    listing = _program.getListing()
    out = []
    for data in listing.getDefinedData(True):
        if not data.hasStringValue():
            continue
        s = data.getValue()
        if s is None:
            continue
        text = str(s)
        if len(text) < min_len:
            continue
        out.append({"addr": str(data.getAddress()), "text": text})
        if len(out) >= limit:
            break
    return out


# ----- HTTP server -----
class Handler(BaseHTTPRequestHandler):
    def _write(self, code, body):
        payload = json.dumps(body)
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        pass  # silence

    def do_GET(self):
        if self.path == "/healthz":
            self._write(200, {"ok": True, "program": _program.getName() if _program else None})
            return
        self._write(404, {"error": "unknown path"})

    def do_POST(self):
        length = int(self.headers.getheader("content-length") or 0)
        body = self.rfile.read(length) if length else "{}"
        try:
            p = json.loads(body)
        except Exception:
            p = {}
        if self.path == "/tool/functions":
            self._write(200, {"functions": list_functions(p.get("limit", 1000))})
        elif self.path == "/tool/decompile":
            c, err = decompile(p.get("function"))
            if err:
                self._write(400, {"error": err})
            else:
                self._write(200, {"c": c})
        elif self.path == "/tool/xrefs":
            x, err = xrefs_to(p.get("to"))
            if err:
                self._write(400, {"error": err})
            else:
                self._write(200, {"xrefs": x})
        elif self.path == "/tool/strings":
            self._write(200, {"strings": list_strings(p.get("min", 6), p.get("limit", 5000))})
        else:
            self._write(404, {"error": "unknown path"})


def start():
    global _program
    try:
        _program = currentProgram  # noqa: F821
    except NameError:
        _program = None
    srv = HTTPServer((MCP_HOST, MCP_PORT), Handler)
    print("[mcp-bridge] Ghidra MCP on http://{}:{}".format(MCP_HOST, MCP_PORT))
    threading.Thread(target=srv.serve_forever).start()


start()
