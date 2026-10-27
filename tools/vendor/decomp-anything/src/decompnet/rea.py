"""REA's analysis tools, for decomp.wtf agents on PC targets and for the RE console.

REA (https://rea.tools) is a separate MCP server that inspects native binaries with Ghidra, IDA,
Hopper or Rizin (function inventories, pseudocode, cross references, strings, call graphs), and
Android, .NET, JavaScript/Electron, web and firmware targets. This module speaks MCP to ``rea mcp``
over stdio. Agents get a small read-only allowlist (`ALLOWED`); the console, driven by the user, can
call any tool. Nothing here is required for matching: without REA, PC programs still import and are
judged byte for byte.

Setup (optional): the console's REA settings (saved in rea.json next to the database), or
``DECOMP_REA`` set to the command (``DECOMP_REA="npx -y rea-agents@6.7.0 mcp"``), or ``rea`` on PATH,
or REA installed from Compilers & tools, or an ``rea`` server registered with Claude Code
(~/.claude.json), or npx. ``DECOMP_REA=off`` disables it.
"""

from __future__ import annotations

import atexit
import contextlib
import json
import os
import queue
import re
import shlex
import shutil
import subprocess
import threading
import time
from pathlib import Path

from . import toolchains

PACKAGE = "rea-agents@6.7.0"  # the version tested with decomp.anything
PROVIDERS = ("ghidra", "hopper", "ida", "rizin")
CONFIG: Path | None = None  # rea.json, set by the app at start
_SECRET = re.compile(r"key|token|secret|password|auth|cookie|credential", re.IGNORECASE)

# Only read-only analysis. Nothing that opens files by arbitrary path after the initial target,
# executes code, writes annotations, or touches the network.
ALLOWED = {
    "open_binary", "binary_overview", "list_procedures", "analyze_function", "procedure_pseudo_code",
    "procedure_assembly", "procedure_info", "procedure_callers", "procedure_callees", "procedure_references",
    "xrefs", "search_procedures", "search_strings", "read_bytes", "list_segments", "list_names", "close_binary",
}
# Analysis projects never reopen or close the target under an agent; everything else here only reads it.
ANALYSIS_ALLOWED = (ALLOWED - {"open_binary", "close_binary"}) | {
    "list_procedures", "list_strings", "inspect_android_package", "search_android_classes", "inspect_android_class",
    "inspect_android_method", "inspect_managed_artifact", "inspect_managed_members", "inspect_managed_native_boundaries",
    "analyze_javascript_application", "inspect_analysis_view", "inspect_firmware_regions", "inspect_artifact",
    "inspect_pe_resources", "inspect_macho", "inspect_plist", "inspect_signature", "inspect_binary_layout",
    "inspect_native_data_type", "inspect_native_instruction", "inspect_address_context", "inspect_native_api",
    # native graph work: caller/callee graphs, literal and def-use traces, several functions decompiled in one
    # call, and masked byte search. All read the open target and write nothing.
    "batch_decompile", "get_call_graph", "trace_call_path", "trace_feature", "trace_native_values", "search_bytes",
    # a static trace through the application graph the project was opened with; it opens nothing and runs nothing
    "trace_application_feature",
}


class ReaError(RuntimeError):
    pass


def _claude_code() -> dict | None:
    """An `rea` MCP server the user registered with Claude Code: the same command and environment."""
    try:
        data = json.loads((Path.home() / ".claude.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    servers = [data.get("mcpServers") or {}, *((p or {}).get("mcpServers") or {} for p in (data.get("projects") or {}).values())]
    for found in servers:
        rea = found.get("rea") if isinstance(found, dict) else None
        if isinstance(rea, dict) and rea.get("command"):
            env = {k: str(v) for k, v in (rea.get("env") or {}).items()}
            return {"command": [str(rea["command"]), *map(str, rea.get("args") or [])], "env": env}
    return None


def _installed_toolchain() -> dict | None:
    """REA installed from Compilers & tools (toolchains.install("rea")), with the environment an existing
    Claude Code registration already has (GHIDRA_INSTALL_DIR, JAVA_HOME...)."""
    try:
        if toolchains.installed("rea") is not None:
            env = (_claude_code() or {}).get("env") or {}
            return {"command": [str(toolchains.binary("rea")), "mcp"], "env": env}
    except (toolchains.ToolchainError, OSError, ValueError):
        return None
    return None


def settings() -> dict:
    """How REA starts: {command, env, provider, source}. Saved console settings first, then DECOMP_REA,
    `rea` on PATH, REA from Compilers & tools, Claude Code's registration, and npx with the tested version."""
    saved: dict = {}
    if CONFIG is not None and CONFIG.exists():
        try:
            saved = json.loads(CONFIG.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            saved = {}
    out = {"command": None, "env": {}, "provider": saved.get("provider", "ghidra"), "source": None}
    env = os.environ.get("DECOMP_REA", "").strip()
    if env.lower() in ("off", "0", "false", "no"):
        return out | {"source": "off"}
    if saved.get("command"):
        return out | {"command": list(saved["command"]), "env": dict(saved.get("env") or {}), "source": "saved"}
    if env:
        return out | {"command": shlex.split(env), "source": "DECOMP_REA"}
    found = shutil.which("rea") or shutil.which("rea-agents")
    if found:
        return out | {"command": [found, "mcp"], "source": "PATH"}
    installed = _installed_toolchain()
    if installed:
        return out | installed | {"source": "installed"}
    claude = _claude_code()
    if claude:
        return out | claude | {"source": "Claude Code"}
    if shutil.which("npx"):
        return out | {"command": ["npx", "-y", PACKAGE, "mcp"], "source": "npx"}
    return out


def save(command: list[str] | str, env: dict | None = None, provider: str = "ghidra") -> dict:
    """Keep the console's REA settings (used by the agents' bridge too)."""
    if CONFIG is None:
        raise ReaError("decomp.wtf has no settings folder")
    argv = shlex.split(command) if isinstance(command, str) else [str(a) for a in command]
    if provider and provider not in PROVIDERS:
        raise ReaError(f"provider must be one of {', '.join(PROVIDERS)}")
    clean = {str(k).strip(): str(v) for k, v in (env or {}).items() if str(k).strip()}
    CONFIG.write_text(json.dumps({"command": argv, "env": clean, "provider": provider}, indent=1), encoding="utf-8")
    return settings()


def public(cfg: dict | None = None) -> dict:
    """Settings safe to show in the page: values of variables that look like secrets are hidden."""
    cfg = cfg or settings()
    return {**cfg, "env": {k: ("•••" if _SECRET.search(k) else v) for k, v in cfg["env"].items()}}


def command() -> list[str] | None:
    """How to start REA's MCP server, or None when it isn't configured on this machine."""
    return settings()["command"]


def unwrap(result):
    """REA wraps every answer in an evidence record; the answer itself is its normalized_result."""
    if isinstance(result, dict) and "normalized_result" in result and "operation" in result:
        return result["normalized_result"]
    return result


def _error(text: str) -> str:
    """REA's error JSON as a sentence: the message, and what to do about it when it says."""
    try:
        err = json.loads(text).get("error") or {}
    except (ValueError, AttributeError):
        return text.strip()
    message = str(err.get("message") or text).strip()
    action = str((err.get("remediation") or {}).get("action") or "").strip()
    return message if not action or action == message else f"{message} {action}"


class Client:
    """A minimal MCP client: initialize, then tools/call by name."""

    def __init__(self, argv: list[str] | None = None, timeout: float = 600, env: dict | None = None,
                 provider: str | None = None):
        cfg = settings() if argv is None else {"command": argv, "env": env or {}, "provider": provider}
        argv = cfg["command"]
        if not argv:
            raise ReaError("REA isn't set up: set its command in the RE console's settings (or install rea-agents)")
        extra = {**cfg.get("env", {}), **(env or {})}
        if cfg.get("provider") and "REA_ANALYSIS_PROVIDER" not in extra:
            extra["REA_ANALYSIS_PROVIDER"] = cfg["provider"]
        self.argv, self.timeout = argv, timeout
        self._id = 0
        self._lock = threading.Lock()
        self._lines: queue.Queue[str | None] = queue.Queue()
        try:
            self.proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                         text=True, encoding="utf-8", errors="replace", bufsize=1,
                                         env={**os.environ, **extra, "NO_COLOR": "1"})
        except OSError as e:
            raise ReaError(f"REA couldn't start ({' '.join(argv)}): {e}") from e
        threading.Thread(target=self._read, daemon=True).start()
        self._initialize()

    def _read(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            line = line.strip()
            if line:
                self._lines.put(line)
        self._lines.put(None)

    def _send(self, message: dict) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
        self.proc.stdin.flush()

    def _request(self, method: str, params: dict | None = None, timeout: float | None = None) -> dict:
        with self._lock:
            self._id += 1
            ident = self._id
            self._send({"jsonrpc": "2.0", "id": ident, "method": method, "params": params or {}})
            deadline = time.time() + (timeout or self.timeout)
            while True:
                left = deadline - time.time()
                if left <= 0:
                    raise ReaError(f"REA did not answer {method} in {timeout or self.timeout:.0f}s")
                try:
                    line = self._lines.get(timeout=left)
                except queue.Empty:
                    raise ReaError(f"REA did not answer {method} in {timeout or self.timeout:.0f}s") from None
                if line is None:
                    raise ReaError("REA exited")
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                if msg.get("id") == ident and "method" not in msg:
                    if "error" in msg:
                        raise ReaError(str(msg["error"].get("message") or msg["error"]))
                    return msg.get("result") or {}
                if "method" in msg and "id" in msg:  # a server request (ping, roots): answer minimally
                    self._send({"jsonrpc": "2.0", "id": msg["id"], "result": {}})

    def _initialize(self) -> None:
        self._request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                     "clientInfo": {"name": "decomp.wtf", "version": "1"}}, timeout=30)
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})

    def call(self, tool: str, arguments: dict | None = None, timeout: float | None = None, *,
             any_tool: bool = False, envelope: bool = False):
        """A tool's answer (its normalized_result). `any_tool`: the console, past the agents' allowlist;
        `envelope`: the whole evidence record (provider, confidence, limitations) instead of the answer."""
        if tool not in ALLOWED and not any_tool:
            raise ReaError(f"REA tool {tool!r} is not on decomp.wtf's allowlist")
        result = self._request("tools/call", {"name": tool, "arguments": arguments or {}}, timeout=timeout)
        if result.get("isError"):
            text = " ".join(c.get("text", "") for c in result.get("content") or [] if isinstance(c, dict))
            raise ReaError(_error(text) or f"REA's {tool} failed")
        if "structuredContent" in result:
            value = result["structuredContent"]
        else:
            text = "".join(c.get("text", "") for c in result.get("content") or [] if isinstance(c, dict))
            try:
                value = json.loads(text)
            except ValueError:
                value = text
        return value if envelope else unwrap(value)

    def tools(self) -> list[dict]:
        """REA's whole catalog: name, title, description, input schema and hints, for every tool."""
        out, cursor = [], None
        for _ in range(50):
            page = self._request("tools/list", {"cursor": cursor} if cursor else {}, timeout=60)
            out += page.get("tools") or []
            cursor = page.get("nextCursor")
            if not cursor:
                break
        return out

    def alive(self) -> bool:
        return self.proc.poll() is None

    def close(self) -> None:
        try:
            self.proc.terminate()
            self.proc.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            with contextlib.suppress(OSError):
                self.proc.kill()

    def __enter__(self) -> Client:
        return self

    def __exit__(self, *exc) -> None:
        self.close()


# ------------------------------------------------------------------ what the decomp tools use

_clients: dict[str, Client] = {}
_opened: dict[str, str] = {}
_cache: dict[tuple[str, int], str] = {}
_lock = threading.Lock()


def _client(binary: Path) -> Client:
    key = str(binary.resolve())
    client = _clients.get(key)
    if client is None or client.proc.poll() is not None:
        client = Client()
        _clients[key] = client
    if _opened.get(key) != key:
        client.call("open_binary", {"path": key}, timeout=900)
        _opened[key] = key
    return client


def _procedure(fn) -> str:
    return f"0x{int(fn['vram']):X}"


def draft(binary: Path, fn, timeout: float = 60) -> str | None:
    """REA/Ghidra pseudocode as a starting draft, if REA answers in time. Never blocks the claim loop
    for long: a cold Ghidra import takes minutes, and agents can call inspect_binary themselves."""
    if os.environ.get("DECOMP_REA_DRAFTS", "").lower() not in ("1", "on", "yes", "true"):
        return None  # a cold Ghidra import takes minutes; agents ask for a dossier with inspect_binary instead
    key = (str(Path(binary).resolve()), int(fn["vram"]))
    if key in _cache:
        return _cache[key]
    if command() is None:
        return None
    try:
        with _lock:
            text = _client(Path(binary)).call("procedure_pseudo_code", {"procedure": _procedure(fn)},
                                              timeout=timeout)
    except (ReaError, OSError):
        return None
    if not isinstance(text, str) or not text.strip():
        return None
    result = ("/* draft from REA's decompiler (Ghidra) via MCP: a starting point, not a match */\n"
              + text.strip() + "\n")
    _cache[key] = result
    return result


def inspect(binary: Path, fn, symbols, what: str = "", timeout: float = 900) -> str:
    """A function dossier from REA for the inspect_binary tool: pseudocode, signature, callers, references."""
    what = (what or "all").lower()
    parts: list[str] = []
    with _lock:
        client = _client(Path(binary))
        proc = _procedure(fn)
        if what in ("all", "info"):
            dossier = client.call("analyze_function", {"procedure": proc}, timeout=timeout)
            if isinstance(dossier, dict):
                info = dossier.get("procedure") or dossier.get("function") or {}
                if isinstance(info, dict):
                    sig = info.get("signature") or info.get("name")
                    if sig:
                        parts.append(f"signature: {sig}")
        if what in ("all", "pseudocode", "code"):
            code = client.call("procedure_pseudo_code", {"procedure": proc}, timeout=timeout)
            if isinstance(code, str) and code.strip():
                parts += ["", "REA pseudocode (Ghidra; a draft, not the original source):", "```c", code.strip(), "```"]
        if what in ("all", "assembly"):
            asm = client.call("procedure_assembly", {"procedure": proc}, timeout=timeout)
            if isinstance(asm, str) and asm.strip():
                parts += ["", "REA assembly:", "```asm", asm.strip(), "```"]
        if what in ("all", "callers"):
            callers = client.call("procedure_callers", {"procedure": proc}, timeout=timeout)
            if callers:
                parts += ["", "callers: " + _addr_list(callers, symbols)]
        if what in ("all", "callees"):
            callees = client.call("procedure_callees", {"procedure": proc}, timeout=timeout)
            if callees:
                parts += ["", "callees: " + _addr_list(callees, symbols)]
        if what in ("all", "references"):
            refs = client.call("procedure_references", {"procedure": proc, "direction": "outgoing"}, timeout=timeout)
            if refs:
                parts += ["", "references: " + _addr_list(refs, symbols)]
    return "\n".join(parts) or f"REA returned nothing for {what or 'this function'}."


def search(binary: Path, query: str, symbols, timeout: float = 900) -> str:
    """Names and strings in the binary, through REA: the fastest way to find what a game calls."""
    with _lock:
        client = _client(Path(binary))
        rows = []
        try:
            found = client.call("search_strings", {"pattern": query}, timeout=timeout)
            for row in (found if isinstance(found, list) else [])[:40]:
                value = row.get("value") or row.get("text") if isinstance(row, dict) else row
                addr = row.get("address") if isinstance(row, dict) else None
                rows.append(f"- string {symbols.label(int(addr, 0)) if addr is not None else ''}: {str(value)[:160]}")
        except ReaError:
            pass
        try:
            found = client.call("search_procedures", {"pattern": query}, timeout=timeout)
            for row in (found if isinstance(found, list) else [])[:40]:
                addr, value = (row.get("address"), row.get("value") or row.get("name")) if isinstance(row, dict) else (None, row)
                rows.append(f"- procedure {symbols.label(int(addr, 0)) if addr is not None else ''}: {value}")
        except ReaError:
            pass
    return "\n".join(rows) or f"REA found no string or procedure matching {query!r}."


def _addr_list(value, symbols) -> str:
    rows = value if isinstance(value, list) else value.get("addresses") or value.get("references") or []
    out = []
    for row in rows[:40]:
        addr = row.get("address") if isinstance(row, dict) else row
        try:
            at = int(addr, 0) if isinstance(addr, str) else int(addr)
        except (TypeError, ValueError):
            continue
        out.append(symbols.label(at))
    return ", ".join(out) or str(value)[:500]


atexit.register(lambda: close_all())


_analysis_clients: dict[tuple, Client] = {}
_analysis_results: dict[tuple, object] = {}
_analysis_records: dict[tuple, object] = {}  # the whole evidence record, for tools that take it inline
_analysis_lock = threading.Lock()


def _target_key(target: dict, provider: str = "") -> tuple:
    import json

    return (str(target.get("path")), str(target.get("tool") or "open_binary"),
            json.dumps(target.get("arguments") or {}, sort_keys=True), provider or "")


def open_analysis(target: dict, provider: str = "") -> tuple[Client, object]:
    """The REA process for an analysis project's target, opened with the tool the user picked, and its answer."""
    key = _target_key(target, provider)
    with _analysis_lock:
        client = _analysis_clients.get(key)
        if client is None or not client.alive():
            client = Client(provider=provider or None, timeout=1800)
            tool = str(target.get("tool") or "open_binary")
            args = dict(target.get("arguments") or {})
            arg = "input_path" if tool == "analyze_javascript_application" else "path"
            if tool != "inspect_artifact":
                args.setdefault(arg, str(target["path"]))
            if tool == "open_binary" and provider and "provider_id" not in args:
                args["provider_id"] = provider
            try:
                record = client.call(tool, args, any_tool=True, timeout=1800, envelope=True)
                _analysis_records[key] = record
                _analysis_results[key] = unwrap(record)
            except BaseException:
                client.close()
                raise
            _analysis_clients[key] = client
        return client, _analysis_results.get(key)

def analysis_client(target: dict, provider: str = "") -> Client:
    return open_analysis(target, provider)[0]


def analysis_result(target: dict, provider: str = "") -> object:
    return open_analysis(target, provider)[1]


def analysis_evidence(target: dict, provider: str = "") -> object | None:
    """The evidence record the target was opened with (what REA's graph tools take as their input)."""
    return _analysis_records.get(_target_key(target, provider))


def trace_feature(target: dict, provider: str, seed: dict, direction: str = "both", timeout: float = 1800) -> object:
    """Trace one literal seed through the JavaScript application graph the project was opened with.

    REA keeps the opening evidence in the session, so the trace usually references it by id; a server that
    doesn't retain it gets the complete record instead. The answer is the whole evidence record.
    """
    client = analysis_client(target, provider)
    record = analysis_evidence(target, provider)
    if not isinstance(record, dict) or not record:
        raise ReaError("REA has no application graph for this project; reopen the target with "
                       "analyze_javascript_application first")
    args: dict = {"seed": seed, "direction": direction}
    if record.get("evidence_id"):
        args["application"] = {"kind": "retained-evidence", "evidence_id": record["evidence_id"]}
        try:
            return client.call("trace_application_feature", args, any_tool=True, envelope=True, timeout=timeout)
        except ReaError as e:
            # Some servers don't retain opening evidence across calls; them, and only them, get the record inline.
            if not any(word in str(e).lower() for word in ("evidence", "retain", "missing")):
                raise
    args["application"] = record
    return client.call("trace_application_feature", args, any_tool=True, envelope=True, timeout=timeout)


def close_all() -> None:
    with _lock:
        for client in _clients.values():
            client.close()
        _clients.clear()
        _opened.clear()
    with _analysis_lock:
        for client in _analysis_clients.values():
            client.close()
        _analysis_clients.clear()
        _analysis_results.clear()
        _analysis_records.clear()
