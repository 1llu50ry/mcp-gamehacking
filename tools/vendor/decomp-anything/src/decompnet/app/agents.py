"""Running the user's AI agents on a ROM project.

CLI agents (Claude Code, Codex, Antigravity CLI, opencode) run headless in a private working folder, connected
to this app's MCP endpoint and allowed to use only its tools. Each session works through a few functions
and exits; the runner starts a fresh one until the user stops it or nothing is left. Models reached with
an API key (DeepSeek, OpenRouter, a local Ollama, any OpenAI-compatible endpoint) run in a small built-in
tool loop instead. Everything the agents print is parsed into a readable live feed.

The prompt goes in on stdin, never on the command line: no length limit (Windows caps a command line at 32,767
characters, and the prompt with its guides and the user's instructions can be long) and nothing in it is parsed.
"""

from __future__ import annotations

import collections
import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from ..network import NetworkError
from . import tools
from .engine import RomNetwork

WIN = sys.platform == "win32"


class Fatal(RuntimeError):
    """A helper can't work until the user changes something (shown as the helper's error, not retried)."""


@dataclass
class Kind:
    id: str
    name: str
    command: str  # executable, "" for the built-in agent
    vendor: str
    install: dict[str, str]  # os -> command
    signin: str
    docs: str


KINDS = {
    "claude": Kind("claude", "Claude Code", "claude", "Anthropic",
                   {"unix": "curl -fsSL https://claude.ai/install.sh | bash",
                    "windows": "irm https://claude.ai/install.ps1 | iex"},
                   "Open a terminal, run `claude` and sign in with /login.", "https://docs.claude.com/en/docs/claude-code"),
    "codex": Kind("codex", "Codex CLI", "codex", "OpenAI",
                  {"unix": "npm install -g @openai/codex", "windows": "npm install -g @openai/codex"},
                  "Run `codex login` once in a terminal.", "https://github.com/openai/codex"),
    "antigravity": Kind("antigravity", "Antigravity CLI", "agy", "Google",
                        {"unix": "curl -fsSL https://antigravity.google/cli/install.sh | bash",
                         "windows": "irm https://antigravity.google/cli/install.ps1 | iex"},
                        "Open a terminal and run `agy` once to sign in.", "https://antigravity.google/docs/cli"),
    "opencode": Kind("opencode", "opencode", "opencode", "any provider (DeepSeek, Qwen, Kimi, ...)",
                     {"unix": "curl -fsSL https://opencode.ai/install | bash", "windows": "npm install -g opencode-ai"},
                     "Run `opencode auth login` once to add a provider (DeepSeek, OpenRouter, ...).", "https://opencode.ai"),
    "api": Kind("api", "API key", "", "DeepSeek, OpenRouter, Ollama, any OpenAI-compatible API", {}, "",
                "https://api-docs.deepseek.com"),
}

API_PRESETS = {
    "deepseek": {"name": "DeepSeek", "base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat", "key": True},
    "openrouter": {"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "model": "deepseek/deepseek-chat", "key": True},
    "ollama": {"name": "Ollama (local)", "base_url": "http://127.0.0.1:11434/v1", "model": "qwen3-coder", "key": False},
    "lmstudio": {"name": "LM Studio (local)", "base_url": "http://127.0.0.1:1234/v1", "model": "local-model", "key": False},
    "llamacpp": {"name": "llama.cpp (local)", "base_url": "http://127.0.0.1:8080/v1", "model": "local", "key": False},
    "openai": {"name": "OpenAI", "base_url": "https://api.openai.com/v1", "model": "gpt-5", "key": True},
    "custom": {"name": "Custom", "base_url": "", "model": "", "key": True},
}
# Google retired Gemini CLI on 2026-06-18; Antigravity CLI (`agy`) replaced it. Helpers and launcher choices saved
# by older versions as "gemini" carry on as Antigravity.
ALIASES = {"gemini": "antigravity", "agy": "antigravity"}

# decomp.anything's tools are loaded up front in Antigravity (tools.ALWAYS_LOAD) and need no permission. Should a helper
# reach one through agy's generic MCP dispatcher instead, a headless run can't ask, and agy quietly refuses it:
# this rule in the user's agy settings allows decomp.anything's tools (and nothing else).
AGY_ALLOW = "mcp(decomp/*)"

# Functions per helper session: a fresh session starts with a small, clean context (each function's assembly,
# drafts and diffs would otherwise ride along into the next one): cheaper per call, and the model stays sharp.
PER_SESSION = 2


def kind_id(kind: str) -> str:
    return ALIASES.get(kind, kind)


def agy_settings() -> Path:
    return Path.home() / ".gemini" / "antigravity-cli" / "settings.json"


def endpoint_entry(e: dict) -> dict:
    """A saved API endpoint, with what's left out filled in from its provider (a name: the provider's, or for a
    custom server the address's host, so sessions say which machine they run on)."""
    provider = e.get("provider") if e.get("provider") in API_PRESETS else "custom"
    preset = API_PRESETS[provider]
    base = (e.get("base_url") or preset["base_url"]).strip()
    host = re.sub(r"^\w+://", "", base).split("/", 1)[0]
    moved = provider == "custom" or base.rstrip("/") != preset["base_url"].rstrip("/")  # Ollama on another box...
    out = {"id": str(e.get("id") or ""), "provider": provider, "base_url": base,
           "model": (e.get("model") or preset["model"]).strip(),
           "name": (e.get("name") or "").strip() or (host if moved and host else preset["name"]) or "API"}
    for k in ("api_key", "context_tokens", "max_sessions"):
        if e.get(k):
            out[k] = e[k]
    return out


def is_local(base: str, resolve: bool = True) -> bool:
    """An address on this computer or the local network (a llama.cpp box, Ollama on another machine): a private,
    loopback, link-local or Tailscale address, a name without dots or under .local/.lan/.internal/.home.arpa, or
    (`resolve`) a name that resolves to such addresses only."""
    import ipaddress
    import socket

    host = re.sub(r"^\w+://", "", base.strip()).split("/", 1)[0].rsplit("@", 1)[-1]
    host = host[1:].split("]", 1)[0] if host.startswith("[") else host.split(":", 1)[0] if host.count(":") == 1 else host
    if not host:
        return False

    def private(ip: str) -> bool:
        try:
            a = ipaddress.ip_address(ip)
        except ValueError:
            return False
        tailscale = a.version == 4 and a in ipaddress.ip_network("100.64.0.0/10")
        return a.is_private or a.is_loopback or a.is_link_local or tailscale or a.is_unspecified

    if private(host):
        return True
    if "." not in host or re.search(r"\.(local|lan|home|internal|localdomain|home\.arpa)$", host, re.IGNORECASE) \
            or host.lower() == "localhost":
        return True
    if not resolve or re.fullmatch(r"[\d.]+|[0-9a-fA-F:]+", host):
        return False
    try:
        addrs = {i[4][0] for i in socket.getaddrinfo(host, None)}
    except (OSError, UnicodeError):
        return False
    return bool(addrs) and all(private(a) for a in addrs)


# what an agent CLI says when nobody signed in to it (Claude Code: "Not logged in · Please run /login")
_SIGNED_OUT = re.compile(r"not logged in|run /login|invalid api key|not authenticated|please (?:log|sign) ?in|"
                         r"auth(?:entication)? method", re.IGNORECASE)
# what a model's provider says when the account has no credit left (DeepSeek: "Insufficient Balance", OpenAI:
# "insufficient_quota", Anthropic: "credit balance is too low"): trying again can't help until it's topped up
_NO_CREDIT = re.compile(r"insufficient[ _](?:balance|credits?|funds|quota)|exceeded your current quota|"
                        r"credit balance is too low|payment required|out of credits?", re.IGNORECASE)
# and when it's asked too much at once (HTTP 429): it works again in a while
_THROTTLED = re.compile(r"too many requests|rate[ _-]?limit|concurrency limit|\b429\b|overloaded", re.IGNORECASE)


def no_credit(said: str) -> str | None:
    """The helper's error when its model's provider says the account is out of credit, else None."""
    if not (m := _NO_CREDIT.search(said)):
        return None
    return (f"the model's provider says the account is out of credit (\u201c{m.group(0)}\u201d): top it up, then "
            "start the agents again")


_versions: dict[str, tuple[float, str | None]] = {}
_models: dict[str, tuple[float, list[dict]]] = {}

# Claude Code's aliases always point at Anthropic's latest model of each kind.
CLAUDE_MODELS = [("fable", "Fable", "Anthropic's most capable model"), ("opus", "Opus", "very capable"),
                 ("sonnet", "Sonnet", "fast and capable, cheaper"), ("haiku", "Haiku", "fastest, cheapest")]


def _codex_config() -> dict:
    """The user's Codex settings (~/.codex/config.toml, or $CODEX_HOME's)."""
    import tomllib

    home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    try:
        return tomllib.loads((home / "config.toml").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _config_model(kind: str) -> str | None:
    """The model the user set as default in the agent's own settings, if any."""
    home = Path.home()
    try:
        if kind == "claude":
            return json.loads((home / ".claude" / "settings.json").read_text(encoding="utf-8")).get("model") or None
        if kind == "codex":
            return _codex_config().get("model") or None
        if kind == "antigravity":
            return json.loads(agy_settings().read_text(encoding="utf-8")).get("model") or None
        if kind == "opencode":
            base = Path(os.environ.get("XDG_CONFIG_HOME") or home / ".config")
            return json.loads((base / "opencode" / "opencode.json").read_text(encoding="utf-8")).get("model") or None
    except (OSError, ValueError, AttributeError):
        return None
    return None


def models(kind: str, path: str | None) -> list[dict]:
    """Models to offer for this agent: [{"id", "name", "note"}]. Claude Code's aliases; opencode's and Antigravity's
    own lists (what the user's sign-in offers); for Codex the user's default plus any model name they type."""
    if kind == "claude":
        return [{"id": i, "name": n, "note": note} for i, n, note in CLAUDE_MODELS]
    if kind not in ("opencode", "antigravity") or not path:
        return []
    cached = _models.get(kind)
    if cached and time.time() - cached[0] < 600:
        return cached[1]
    try:
        res = subprocess.run(argv([path, "models"]), capture_output=True, text=True, encoding="utf-8", errors="replace",
                             stdin=subprocess.DEVNULL, timeout=30)
        lines = [line.strip() for line in res.stdout.splitlines()]
    except (OSError, subprocess.TimeoutExpired):
        lines = []
    if kind == "opencode":
        rows = [r for r in lines if re.fullmatch(r"[\w.-]+/[\w.:/-]+", r)]
        out = [{"id": r, "name": r.split("/", 1)[1], "note": r.split("/", 1)[0]} for r in rows[:200]]
    else:  # agy: "<slug>\t<name>" per model
        rows = [r.split("\t", 1) for r in lines if re.fullmatch(r"[\w.:-]+\t.+", r)]
        out = [{"id": slug, "name": name.strip(), "note": slug.split("-", 1)[0]} for slug, name in rows[:200]]
    _models[kind] = (time.time(), out)
    return out


def search_path() -> str | None:
    """Where to look for agents and npm (None: this process's PATH). On Windows also the PATH set for the user right
    now, read from the registry: an agent or Node.js installed while the app runs is found without restarting it."""
    if not WIN:
        return None
    import winreg

    dirs = os.environ.get("PATH", "").split(os.pathsep)
    for root, key in ((winreg.HKEY_CURRENT_USER, "Environment"),
                      (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")):
        try:
            with winreg.OpenKey(root, key) as k:
                dirs += [os.path.expandvars(d) for d in str(winreg.QueryValueEx(k, "Path")[0]).split(";")]
        except OSError:
            pass
    return os.pathsep.join(dict.fromkeys(d for d in dirs if d))


def _which(cmd: str) -> str | None:
    found = shutil.which(cmd, path=search_path())
    if found:
        return found
    home = Path.home()
    dirs = [home / ".local" / "bin", home / ".claude" / "local", home / ".opencode" / "bin", home / ".npm-global" / "bin"]
    if WIN and os.environ.get("APPDATA"):
        dirs.append(Path(os.environ["APPDATA"]) / "npm")  # npm's global installs on Windows
    if WIN and os.environ.get("LOCALAPPDATA"):
        dirs.append(Path(os.environ["LOCALAPPDATA"]) / "agy" / "bin")  # where Antigravity's installer puts agy
    # on Windows the file without an extension next to npm's foo.cmd is a shell script Windows can't run
    names = (f"{cmd}.exe", f"{cmd}.cmd") if WIN else (cmd, f"{cmd}.cmd", f"{cmd}.exe")
    for d in dirs:
        for name in names:
            if (d / name).exists():
                return str(d / name)
    return None


# npm's Windows launcher (cmd-shim) ends with: "%_prog%" [node options] "%dp0%\node_modules\...\cli.js" %*
_NPM_SHIM = re.compile(r'"%_prog%"\s+(?P<opts>[^"\r\n]*?)\s*"%~?dp0%?\\(?P<script>[^"\r\n]+)"\s+%\*', re.IGNORECASE)


def argv(cmd: list[str]) -> list[str]:
    """The command to start, as Windows needs it. npm installs agents there as .cmd scripts, which run through cmd.exe:
    it cuts an argument at its first line break (a prompt loses everything after its first line, and the flags after
    it with it) and treats & | < > in it as commands. Start node with the agent's script instead, as the .cmd would."""
    if not WIN or Path(cmd[0]).suffix.lower() not in (".cmd", ".bat"):
        return cmd
    shim = Path(cmd[0])
    try:
        m = _NPM_SHIM.search(shim.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        m = None
    if not m:
        return cmd
    script = shim.parent / m["script"]
    node = shim.parent / "node.exe"
    node = str(node) if node.exists() else shutil.which("node", path=search_path())
    if not node or not script.exists():
        return cmd
    return [node, *m["opts"].split(), str(script), *cmd[1:]]


def signin(k: Kind) -> str:
    """How to sign in to an agent, said for where decomp.anything runs (WSL/Docker: in decomp.anything's own terminal)."""
    from .. import hostenv

    if not k.signin or hostenv.runtime() == "native":
        return k.signin
    text = k.signin.removeprefix("Open a terminal, ").removeprefix("Open a terminal and ")
    return f"{hostenv.terminal_hint()}, then: {text[0].lower()}{text[1:]}"


def version(kind: str, path: str) -> str | None:
    """What the agent's `--version` says (cached for 5 minutes), or None."""
    cached = _versions.get(kind)
    if cached is None or time.time() - cached[0] > 300:
        try:
            res = subprocess.run(argv([path, "--version"]), capture_output=True, text=True, encoding="utf-8",
                                 errors="replace", timeout=15)
            said = (res.stdout or res.stderr).strip()
            _versions[kind] = (time.time(), said.splitlines()[0][:60] if said else None)
        except (OSError, subprocess.TimeoutExpired):
            _versions[kind] = (time.time(), None)
    return _versions[kind][1]


def major(said: str | None) -> int:
    """The major version in what `--version` said ("opencode v2.0.32" -> 2), 0 when there's none."""
    m = re.search(r"(\d+)\.\d+", said or "")
    return int(m.group(1)) if m else 0


def detect() -> list[dict]:
    out = []
    for k in KINDS.values():
        row = {"id": k.id, "name": k.name, "vendor": k.vendor, "signin": signin(k), "docs": k.docs,
               "install": k.install.get("windows" if WIN else "unix", "")}
        if not k.command:
            row.update(installed=True, version=None, path=None)
        else:
            path = _which(k.command)
            row.update(installed=path is not None, path=path, version=version(k.id, path) if path else None)
            if path:
                row.update(models=models(k.id, path), default_model=_config_model(k.id))
        if row["install"].startswith("npm ") and not row["installed"] and not shutil.which("npm", path=search_path()):
            row["needs"] = "Node.js (https://nodejs.org) for npm"
        elif k.id == "claude" and WIN and not shutil.which("git", path=search_path()):
            row["needs"] = "Git for Windows (https://git-scm.com/downloads/win): Claude Code needs its Git Bash"
        out.append(row)
    return out


# ---------------------------------------------------------------------------------- output parsing

def _tool_name(name: str) -> str:
    for prefix in ("mcp__decomp__", "mcp_decomp_", "decomp_agent.", "decomp_agent__", "decomp__", "decomp_", "decomp."):
        if name.startswith(prefix):
            return name[len(prefix):]
    return name


def _args_brief(args) -> str:
    if not isinstance(args, dict):
        return ""
    parts = []
    for k, v in args.items():
        if k == "source":
            parts.append(f"{len(str(v).splitlines())} lines of C")
        elif isinstance(v, str):
            parts.append(v if len(v) < 40 else v[:37] + "…")
        elif v not in (None, "", {}):
            parts.append(str(v))
    return ", ".join(parts)


def _error_text(err) -> str:
    """The message in an agent's error object, whatever its shape (opencode nests it under data)."""
    if isinstance(err, dict):
        data = err.get("data") if isinstance(err.get("data"), dict) else {}
        msg = err.get("message") or data.get("message") or ""
        name = err.get("name") or err.get("type") or ""
        if msg and name and name not in ("UnknownError", "Error") and name not in msg:
            return f"{name}: {msg}"
        return str(msg or name or json.dumps(err)[:300])
    return str(err or "")


def _parse_agy(obj: dict, state: dict) -> list[tuple[str, str]]:
    """Antigravity CLI's stream-json: step_update events (text arrives in deltas, gathered per step) and a result."""
    out: list[tuple[str, str]] = []
    ev = obj.get("event")
    if ev == "step_update" and isinstance(obj.get("step_update"), dict):
        st = obj["step_update"]
        step, kind = st.get("step_index"), st.get("step_type")
        if kind in ("agent_response", "thinking", "planner_response"):
            texts = state.setdefault("agy_text", {})
            texts[step] = texts.get(step, "") + str(st.get("text_delta") or "")
            if st.get("state") == "DONE" and texts.get(step, "").strip():
                out.append(("think" if kind == "thinking" else "text", texts.pop(step).strip()))
        elif kind == "tool" and st.get("state") == "ACTIVE" and step not in state.setdefault("agy_tools", set()):
            state["agy_tools"].add(step)
            info = st.get("tool_info") if isinstance(st.get("tool_info"), dict) else {}
            name, params = info.get("name") or st.get("tool_name") or "", info.get("parameters")
            if name == "call_mcp_tool" and isinstance(params, dict):  # agy reaches MCP tools through one dispatcher
                name, params = params.get("ToolName") or name, params.get("Arguments")
            out.append(("tool", f"{_tool_name(name)}({_args_brief(params)})"))
    elif ev == "result" and isinstance(obj.get("result"), dict):
        res = obj["result"]
        usage = res.get("usage") if isinstance(res.get("usage"), dict) else {}
        if usage.get("total_tokens"):
            out.append(("usage", json.dumps({"tokens": usage["total_tokens"]})))
        denied = [d for d in res.get("denied_actions") or [] if isinstance(d, dict)]
        if any(d.get("action") == "mcp" for d in denied):
            out.append(("error", f"Antigravity refused decomp.anything's tools: a background run can't ask you for permission. "
                                 f"Allow them once: add \"{AGY_ALLOW}\" to \"permissions\": {{\"allow\": [...]}} in "
                                 f"{agy_settings()} (only decomp.anything's tools; shell, files and the web keep asking)."))
        if res.get("status") not in (None, "SUCCESS"):
            out.append(("error", str(res.get("error") or f"session ended: {res.get('status')}")[:400]))
        else:
            turns = res.get("num_turns")
            out.append(("info", "session finished" + (f" ({turns} turns)" if turns else "")))
    elif ev == "error":
        out.append(("error", _error_text(obj.get("error") or obj.get("message"))[:400]))
    return out


def clean_stderr(kind: str, line: str) -> str:
    """One line of an agent's stderr as worth showing, or "" for noise."""
    line = line.strip()
    if kind == "opencode" and "level=" in line:  # opencode --print-logs: keep the error itself, drop stack noise
        # (the error is error="..." before OpenCode 2, cause="..." from 2 on, its stack trace escaped inside it)
        m = re.search(r'\b(?:error|cause)="((?:[^"\\]|\\.)*)"', line)
        return m.group(1).replace('\\"', '"').split("\\n")[0] if m and "level=ERROR" in line else ""
    if kind == "opencode" and line.startswith("at "):  # a stack frame of a crash: its message came lines before
        return ""
    if line.startswith("AGY_ERROR:"):  # agy: a structured error line
        try:
            return _error_text(json.loads(line.split(":", 1)[1]))[:300]
        except ValueError:
            return line
    return line


def parse_line(kind: str, line: str, state: dict | None = None) -> list[tuple[str, str]]:
    """(type, text) items for the live feed from one line of agent output: text, think, tool, info, error, usage.
    `state` carries what spans lines (Antigravity streams text in pieces) for one session."""
    line = line.strip()
    if not line:
        return []
    try:
        obj = json.loads(line)
    except ValueError:
        return [("info", line[:400])]
    if not isinstance(obj, dict):
        return []
    if "event" in obj and "type" not in obj:  # Antigravity CLI
        return [(k, v) for k, v in _parse_agy(obj, {} if state is None else state) if v]
    t = obj.get("type")
    out: list[tuple[str, str]] = []
    if t == "assistant" and isinstance(obj.get("message"), dict):  # Claude Code
        for c in obj["message"].get("content", []):
            if c.get("type") == "text" and c.get("text", "").strip():
                out.append(("text", c["text"].strip()))
            elif c.get("type") == "thinking" and c.get("thinking", "").strip():
                out.append(("think", c["thinking"].strip()))
            elif c.get("type") == "tool_use" and c.get("name") != "ToolSearch":  # ToolSearch: Claude Code loading tools
                out.append(("tool", f"{_tool_name(c.get('name', ''))}({_args_brief(c.get('input'))})"))
    elif t == "result":  # Claude Code end of session
        if obj.get("is_error") or obj.get("status") == "error":
            out.append(("error", str(obj.get("result") or obj.get("error") or "session failed")[:400]))
        else:
            cost = obj.get("total_cost_usd")
            turns = obj.get("num_turns")
            bits = [f"{turns} turns" if turns else "", f"${cost:.2f}" if isinstance(cost, (int, float)) else ""]
            out.append(("info", "session finished" + (f" ({', '.join(b for b in bits if b)})" if any(bits) else "")))
            if isinstance(cost, (int, float)):
                out.append(("usage", json.dumps({"usd": cost})))
            stats = obj.get("stats") if isinstance(obj.get("stats"), dict) else {}
            if stats.get("total_tokens"):
                out.append(("usage", json.dumps({"tokens": stats["total_tokens"]})))
    elif t in ("item.started", "item.completed") and isinstance(obj.get("item"), dict):  # Codex
        item = obj["item"]
        it = item.get("type") or item.get("item_type")
        if it == "agent_message" and t == "item.completed":
            out.append(("text", str(item.get("text", "")).strip()))
        elif it == "reasoning" and t == "item.completed" and item.get("text"):
            out.append(("think", str(item["text"]).strip()))
        elif it == "mcp_tool_call" and t == "item.started":
            out.append(("tool", f"{_tool_name(item.get('tool', ''))}({_args_brief(item.get('arguments'))})"))
        elif it == "command_execution" and t == "item.started":
            out.append(("tool", f"shell: {str(item.get('command', ''))[:80]}"))
        elif it == "error":
            out.append(("error", str(item.get("message", ""))[:400]))
    elif t == "turn.completed":
        out.append(("info", "turn finished"))
        usage = obj.get("usage") if isinstance(obj.get("usage"), dict) else {}
        tokens = sum(v for k, v in usage.items() if k in ("input_tokens", "output_tokens") and isinstance(v, int))
        if tokens:
            out.append(("usage", json.dumps({"tokens": tokens})))
    elif t in ("error", "turn.failed"):  # Codex; opencode: {"error": {"name", "data": {"message"}}}
        text = _error_text(obj.get("error") or obj.get("message"))
        if not text.startswith("Unexpected server error"):  # opencode's placeholder: its log line says what failed
            out.append(("error", text[:400]))
    elif t == "tool_use":  # opencode
        part = obj.get("part") if isinstance(obj.get("part"), dict) else obj
        name = part.get("tool_name") or part.get("tool") or part.get("name") or ""
        args = part.get("parameters") or (part.get("state") or {}).get("input") or part.get("input")
        out.append(("tool", f"{_tool_name(name)}({_args_brief(args)})"))
    elif t == "text" and isinstance(obj.get("part"), dict):  # opencode
        text = obj["part"].get("text", "").strip()
        if text:
            out.append(("text", text))
    elif t in ("step_finish", "step-finish") and isinstance(obj.get("part"), dict):  # opencode: cost per step
        part = obj["part"]
        if isinstance(part.get("cost"), (int, float)) and part["cost"]:
            out.append(("usage", json.dumps({"usd": part["cost"]})))
    return [(k, v) for k, v in out if v]


# ---------------------------------------------------------------------------------- sessions

@dataclass
class Session:
    id: str
    kind: str
    label: str
    slug: str
    agent_name: str
    options: dict
    state: str = "starting"  # starting | working | waiting | stopped | error
    started_at: float = field(default_factory=time.time)
    runs: int = 0
    error: str = ""
    feed: collections.deque = field(default_factory=lambda: collections.deque(maxlen=400))
    seq: int = 0
    stop: threading.Event = field(default_factory=threading.Event)
    proc: subprocess.Popen | None = None
    http: httpx.Client | None = None  # an API agent's request in flight; closing it aborts the wait
    usd: float = 0.0  # what the agent's provider charged, as the agent reports it
    tokens: int = 0
    signed_out: bool = False  # the agent CLI isn't signed in: trying again won't help
    throttled: bool = False  # the last run ended on the provider's limit of requests at once: not a failure

    def push(self, kind: str, text: str) -> None:
        self.seq += 1
        self.feed.append({"seq": self.seq, "t": time.time(), "type": kind, "text": text[:4000]})

    def snapshot(self, since: int = 0) -> dict:
        return {"id": self.id, "kind": self.kind, "label": self.label, "slug": self.slug, "agent": self.agent_name,
                "state": self.state, "runs": self.runs, "error": self.error, "started_at": self.started_at,
                "model": self.options.get("model") or "", "usd": round(self.usd, 4), "tokens": self.tokens,
                "feed": [f for f in self.feed if f["seq"] > since]}


class Manager:
    def __init__(self, net: RomNetwork, home: Path, mcp_url: str):
        self.net, self.home, self.mcp_url = net, home, mcp_url
        self.sessions: dict[str, Session] = {}
        self.assignments: dict[int, str] = {}  # agent id -> project slug
        self._lock = threading.Lock()
        self._prep: dict[str, threading.Event] = {}  # slug -> giving its code source files before agents claim
        self.on_stop = lambda: None  # set by the server: close tunnels when the app quits
        self.persist = lambda running: None  # set by the server: remember helpers to resume after a restart

    # -- control

    def start(self, kind: str, slug: str, count: int = 1, options: dict | None = None) -> list[str]:
        options = dict(options or {})
        if kind_id(kind) != kind:
            kind = kind_id(kind)
            options.pop("model", None)  # a Gemini CLI model name may mean nothing to Antigravity: use its default
        if kind not in KINDS:
            raise ValueError(f"unknown agent kind {kind!r}")
        ids = []
        self._prepare(slug)
        with self._lock:
            for _ in range(max(1, min(int(count), 8))):
                n = 1 + sum(1 for s in self.sessions.values() if s.kind == kind)
                sid = f"{kind}-{n}"
                while sid in self.sessions:
                    n += 1
                    sid = f"{kind}-{n}"
                if kind == "api":  # numbered per endpoint: "gpu-box #2" says which machine it runs on
                    name = options.get("provider_name") or "API"
                    k = 1 + max((int(s.label.rsplit(" #", 1)[1]) for s in self.sessions.values() if s.kind == "api"
                                 and s.label.rsplit(" #", 1)[0] == name and s.label.rsplit(" #", 1)[-1].isdigit()), default=0)
                    label = f"{name} #{k}"
                else:
                    label = f"{KINDS[kind].name} #{n}"
                s = Session(sid, kind, label, slug, sid, dict(options))
                self.sessions[sid] = s
                threading.Thread(target=self._run, args=(s,), daemon=True, name=f"agent-{sid}").start()
                ids.append(sid)
        self.persist(self.running())
        return ids

    def _prepare(self, slug: str) -> None:
        """Before agents claim: free matches from identical code (twins, in the background: what they'd match is
        left for last meanwhile), and on a GameCube/Wii decomp where code has no source file yet, files for it
        (start_files, checked against the game's checksum), or they'd all share the few hard functions left."""
        try:
            self.net.twins.refresh(slug)
            self.net.permuter.start(slug)  # near misses agents leave, on spare CPU
        except Exception:  # noqa: BLE001 agents work without them
            pass
        with self._lock:
            if slug in self._prep:
                return
            try:
                if not self.net.fork_slug(slug):
                    return
                _, fp, _cfg = self.net.forks.get(slug)
                if not (self.net.forks.uncovered(slug) or {}).get("functions") or not fp.linkable():
                    return
            except Exception:  # noqa: BLE001
                return
            done = self._prep[slug] = threading.Event()

        def run() -> None:
            try:
                self.net.forks.start_files(slug, log=lambda *_: None)
            except Exception:  # noqa: BLE001 the agents still work on what has files
                pass
            finally:
                done.set()
                with self._lock:
                    self._prep.pop(slug, None)

        threading.Thread(target=run, daemon=True, name=f"start-files-{slug}").start()

    def running(self) -> list[dict]:
        """The helpers that should keep working: resumed by the server after the app restarts."""
        return [{"kind": s.kind, "slug": s.slug, "options": {k: v for k, v in s.options.items() if k != "api_key"}}
                for s in self.sessions.values() if s.state in ("starting", "working", "waiting") and not s.stop.is_set()]

    def stop(self, sid: str | None = None) -> None:
        """Stop one helper (for good) or all of them (the app is quitting: they resume next time)."""
        for s in list(self.sessions.values()):
            if sid in (None, s.id):
                s.stop.set()
                if s.proc and s.proc.poll() is None:
                    _terminate(s.proc)
                if s.http is not None:  # a local model can take minutes to answer: don't wait for it
                    with contextlib.suppress(Exception):
                        s.http.close()
                if s.state != "error":
                    s.state = "stopped"
        if sid is not None:
            self.persist(self.running())

    def remove(self, sid: str) -> None:
        self.stop(sid)
        self.sessions.pop(sid, None)

    def snapshot(self, since: dict | None = None) -> list[dict]:
        since = since or {}
        return [s.snapshot(int(since.get(s.id, 0))) for s in self.sessions.values()]

    def project_of(self, agent_id: int) -> str | None:
        return self.assignments.get(agent_id)

    # -- loop

    def _progress(self, agent_id: int) -> int:
        """Compiles + claims + notes by this agent: a session that adds none of these made no progress."""
        row = self.net.store.one(
            "SELECT (SELECT COUNT(*) FROM attempts WHERE agent_id=?) + (SELECT COUNT(*) FROM events WHERE agent_id=?) AS n",
            agent_id, agent_id)
        return row["n"]

    def _left(self, slug: str) -> int:
        proj = self.net.project_row(slug)
        row = self.net.store.one("SELECT COUNT(*) AS n FROM functions WHERE project_id=? AND status='open'", proj["id"])
        return row["n"]

    def _account(self, s: Session, usage: dict) -> None:
        """Add what a session spent to the session and to the project (kept in its config across restarts)."""
        usd, tokens = float(usage.get("usd") or 0), int(usage.get("tokens") or 0)
        s.usd += usd
        s.tokens += tokens
        self.net.add_spend(s.slug, usd, tokens)

    def over_budget(self, slug: str) -> float | None:
        """The budget (USD) when the project's agents have spent it, else None."""
        cap = self.budget()
        spent = (self.net.spend(slug) or {}).get("usd", 0)
        return cap if cap and spent >= cap else None

    def budget(self) -> float:
        return 0.0  # set by the server from the settings

    def _run(self, s: Session) -> None:
        agent, token = self.net.local_agent(s.agent_name)
        self.assignments[agent.id] = s.slug
        workdir = self.home / "agents" / s.id
        workdir.mkdir(parents=True, exist_ok=True)
        failures = throttles = 0
        s.push("info", f"{s.label} starting on {s.slug}")
        if (prep := self._prep.get(s.slug)) is not None:
            s.push("info", "first giving the game's code without a source file one (about a minute)")
            prep.wait(900)
        twins = getattr(getattr(self.net, "twins", None), "jobs", {}).get(s.slug)
        if twins is not None and not twins.ordered.is_set():
            s.push("info", "first setting hand-written assembly aside and putting the functions in order "
                           "(seconds; a minute the first time)")
            twins.ordered.wait(120)
        while not s.stop.is_set():
            if self._left(s.slug) == 0:
                s.push("info", "nothing left to decompile here 🎉")
                break
            if (cap := self.over_budget(s.slug)) is not None:
                s.push("info", f"stopping: the agents on this project have spent the ${cap:.2f} budget (Setup)")
                break
            link = self.net.links.get(s.slug)
            if link is not None and (link.error or time.time() - link.last_ok > 30):
                # in a room whose host is away (or that hasn't let us in yet): wait, don't fail
                if s.state != "waiting" or not s.feed or "waiting for the room" not in s.feed[-1]["text"]:
                    s.push("info", f"waiting for the room's host: {link.error or 'not reachable right now'}")
                s.state = "waiting"
                with contextlib.suppress(Exception):
                    link.sync()
                s.stop.wait(10)
                continue
            s.state = "working"
            s.runs += 1
            t0 = time.time()
            before = self._progress(agent.id)
            try:
                ok = self._run_api(s, agent) if s.kind == "api" else self._run_cli(s, token, workdir)
            except Fatal as e:  # needs the user first: retrying can't help
                s.state, s.error = "error", str(e)
                break
            except Exception as e:  # noqa: BLE001 keep the runner alive; show what happened
                s.push("error", f"{type(e).__name__}: {e}")
                ok = False
            if ok and not s.stop.is_set() and self._progress(agent.id) == before:
                s.error = "the session ended without compiling anything (check the agent's output)"
                s.push("error", s.error)
                ok = False
            if s.stop.is_set():
                break
            if s.signed_out:
                s.state = "error"
                break
            if s.throttled and throttles < 10:  # the provider's limit, not the agent's failure: wait it out
                s.throttled, throttles = False, throttles + 1
                s.state = "waiting"
                s.push("info", "the model's provider says too many requests at once: trying again in a minute "
                               "(fewer agents at once on this account would wait less)")
                s.stop.wait(60)
                continue
            throttles = 0 if ok else throttles
            failures = 0 if ok else failures + 1
            if failures >= 3:
                s.state = "error"
                s.error = s.error or "the agent failed three times in a row"
                s.push("error", f"stopping: {s.error}. {signin(KINDS[s.kind])}".strip())
                break
            s.state = "waiting"
            s.stop.wait(3 if ok else min(60, 5 * failures + max(0, 10 - (time.time() - t0))))
        if s.state != "error":
            s.state = "stopped"
        if not s.stop.is_set():  # finished by itself (done, budget, errors): no need to resume it
            s.stop.set()
            self.persist(self.running())
        held = self.net.store.one("SELECT f.name FROM claims c JOIN functions f ON f.id=c.function_id WHERE c.agent_id=?", agent.id)
        link = self.net.links.get(s.slug)
        if held and link is not None:  # in a room, the host holds the real claim
            with contextlib.suppress(Exception):
                link.call("/collab/release", agent, function=held["name"], notes="")
        with self.net.store.tx() as db:  # release any claim the agent still holds so others can take it
            db.execute("DELETE FROM claims WHERE agent_id=?", (agent.id,))

    def prompt(self, s: Session) -> str:
        text = self._prompt(s)
        # the know-how every session reads first, given up front (saves each session its first tool calls)
        ov = self.net.overview(s.slug)
        if ov.get("kind") == "fork":
            # CodeWarrior's register and stack rules decide most of what's left on GameCube, Wii and DS
            topics = ["fork", "objdiff", *(["mwcc"] if ov.get("platform") in ("gc", "wii", "nds") else [])]
        elif ov.get("platform") in ("windows", "linux"):
            topics = ["workflow", "x86", *(["cpp"] if ov.get("source_language") == "C++" else [])]
        else:
            topics = ["workflow", {"psx": "psx", "ps2": "ps2", "gba": "agbcc"}.get(ov.get("platform")) or (
                "ido" if ov["compiler"]["toolchain"].startswith("ido") else "gcc-kmc")]
        text += "\nKnow-how you'd otherwise read with guide() (more topics: guide()):\n\n" + "\n\n".join(
            tools._guide(t) for t in topics)
        if (learned := self.net.learnings(s.slug)):
            text += ("\nWhat agents learned on this project so far (compiler quirks, conventions; add yours with "
                     f"add_note and no function):\n{learned}\n")
        if (facts := self.net.intake_line(s.slug)):
            text += f"\n{facts}\n"
        if (wish := self.net.instructions(s.slug)):
            text += f"\nThe user's instructions for this project (they come first):\n{wish}\n"
        if (roots := self.net.references(s.slug)):
            from . import references

            text += f"\n{references.prompt_line(roots)}\n"
        return text

    def _prompt(self, s: Session) -> str:
        ov = self.net.overview(s.slug)
        if ov.get("kind") == "analysis":
            return tools.ANALYSIS_PROMPT.format(title=ov["title"], count=s.options.get("per_session", PER_SESSION),
                                                guides='guide("analysis")')
        if ov.get("kind") == "fork":
            guides = ["fork", "objdiff", *tools.PLATFORM_GUIDES.get(ov.get("platform") or "", [])]
            return tools.FORK_PROMPT.format(title=ov["title"], platform=ov.get("platform_name") or "its platform",
                                            count=s.options.get("per_session", PER_SESSION),
                                            guides=", ".join(f'guide("{g}")' for g in guides))
        platform = ov.get("platform") or ""
        language = ov.get("source_language") or "C"
        if platform in ("windows", "linux"):
            target = "program"
            guide = "x86" + (" and cpp" if language == "C++" else "")
            note = ("\nThe target's function names are C++ mangled names: write the class and signature that mangle to "
                    "them (or wrap a sub_<address> in extern \"C\"); the cpp guide has the ABI details.") \
                if language == "C++" else ""
        else:
            target = "game"
            guide = {"psx": "psx", "ps2": "ps2", "gba": "agbcc"}.get(platform) or (
                "ido" if ov["compiler"]["toolchain"].startswith("ido") else "gcc-kmc")
            note = ""
        detected = ov.get("detected") or {}
        if detected and not detected.get("matchable", True):
            note += (f"\nThis target was built with {detected['label']}: C/C++ cannot reproduce that compiler's output, "
                     "so matches will stay elusive. Use the tools to inspect and explain the program; don't claim a match.")
        return tools.WORK_PROMPT.format(title=ov["title"], count=s.options.get("per_session", PER_SESSION),
                                        compiler_guide=guide, language=language, target=target, language_note=note)

    def _command(self, s: Session, token: str, workdir: Path) -> tuple[list[str], dict, str]:
        """The agent's command line, environment and what goes in on stdin (the prompt)."""
        k = KINDS[s.kind]
        exe = _which(k.command)
        if not exe:
            raise RuntimeError(f"{k.name} is not installed")
        env = dict(os.environ)
        if WIN:
            env["PATH"] = search_path()  # the agent finds node (and what it needs) even when installed after the app
        # An agent that only loads the MCP servers in the user's own settings (Antigravity CLI since 1.1.3 ignores a
        # workspace's .agents/mcp_config.json) reaches decomp.anything through the `decomp mcp` the user connected it
        # with: that bridge works as this session's agent when it finds this, not as a new agent of the user's
        env["DECOMP_SESSION_TOKEN"] = token
        prompt = self.prompt(s)
        model = s.options.get("model") or ""
        if s.kind == "claude":
            cfg = workdir / "mcp.json"
            cfg.write_text(json.dumps({"mcpServers": {"decomp": {"type": "http", "url": self.mcp_url,
                                                                  "headers": {"Authorization": f"Bearer {token}"}}}}),
                           encoding="utf-8")
            cmd = [exe, "-p", "--output-format", "stream-json", "--verbose", "--mcp-config", str(cfg),
                   "--strict-mcp-config", "--allowedTools", "mcp__decomp", "--disallowedTools",
                   "Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch"]
            if model:
                cmd += ["--model", model]
        elif s.kind == "codex":
            env["DECOMP_TOKEN"] = token
            # The worker's own server, under a name of its own: `-c` settings merge into the user's config, and
            # `decomp connect codex` gave that a stdio `decomp` entry (a url on top of it: "url is not supported for
            # stdio"). The user's MCP servers are switched off for the run, as --strict-mcp-config does for Claude.
            cmd = [exe, "exec", "--json", "--skip-git-repo-check", "--ephemeral", "-C", str(workdir), "-s", "read-only"]
            for name in (_codex_config().get("mcp_servers") or {}):
                if re.fullmatch(r"[A-Za-z0-9_-]+", name):
                    cmd += ["-c", f"mcp_servers.{name}.enabled=false"]
            cmd += ["-c", f'mcp_servers.decomp_agent={{url="{self.mcp_url}", bearer_token_env_var="DECOMP_TOKEN", '
                          'default_tools_approval_mode="approve", tool_timeout_sec=180}',
                    "-c", 'approval_policy="never"']
            if model:
                cmd += ["-m", model]
            cmd.append("-")  # the prompt comes from stdin
        elif s.kind == "antigravity":
            # the workspace's own MCP config; tool permission comes from the user's rule for decomp's tools (AGY_ALLOW)
            (workdir / ".agents").mkdir(exist_ok=True)
            (workdir / ".agents" / "mcp_config.json").write_text(json.dumps({"mcpServers": {"decomp": {
                "serverUrl": self.mcp_url, "headers": {"Authorization": f"Bearer {token}"}}}}), encoding="utf-8")
            # a session works through several functions: more than agy's default 5 minutes
            cmd = [exe, "--output-format", "stream-json", "--input-format", "stream-json", "--print-timeout", "2h"]
            if model:
                cmd += ["--model", model]
            prompt = json.dumps({"event": "user", "message": {"content": prompt}}) + "\n"
        elif s.kind == "opencode":
            # "deny" takes the tools out of the request, and OpenCode Zen's free models then refuse it ("can only be
            # used from within OpenCode"). "ask" keeps the usual tools, and `opencode run` rejects every ask itself.
            # (Zen's and Go's free models alike: opencode/... and opencode-go/...)
            zen = (model or _config_model("opencode") or "opencode/").split("/", 1)[0] in ("opencode", "opencode-go")
            never = "ask" if zen else "deny"
            server = {"type": "remote", "url": self.mcp_url, "headers": {"Authorization": f"Bearer {token}"}}
            v2 = major(version("opencode", exe)) >= 2
            if v2:
                # OpenCode 2 reaches MCP tools through one `execute` tool by default (Code Mode), where models wander
                # off to the user's other servers: decomp's tools are offered as themselves and `execute` is denied.
                cfg = {"mcp": {"servers": {"decomp": {**server, "oauth": False, "codemode": False}}},
                       "permissions": [{"action": "execute", "resource": "*", "effect": "deny"},
                                       {"action": "decomp_*", "resource": "*", "effect": "allow"},
                                       *({"action": a, "resource": "*", "effect": never} for a in ("edit", "shell", "webfetch"))]}
            else:
                cfg = {"mcp": {"decomp": {**server, "enabled": True}},
                       "permission": {"edit": never, "bash": never, "webfetch": never}}
            (workdir / "opencode.json").write_text(json.dumps({"$schema": "https://opencode.ai/config.json", **cfg}),
                                                   encoding="utf-8")
            # --print-logs: opencode's JSON error only says "Unexpected server error"; the log line says what failed.
            # (No --dir: it runs in workdir, and OpenCode before 1.4 stops at the flag. No --log-level: OpenCode 2
            # stops at "ERROR", earlier ones at "error"; clean_stderr keeps only the errors anyway.) OpenCode 2 runs
            # on a shared background service unless --standalone: then the server's own errors reach stderr too.
            cmd = [exe, "run", "--format", "json", "--print-logs", *(["--standalone"] if v2 else [])]
            if model:
                cmd += ["-m", model]
        else:
            raise RuntimeError(s.kind)
        return argv(cmd), env, prompt

    def _run_cli(self, s: Session, token: str, workdir: Path) -> bool:
        if s.kind == "antigravity" and s.runs == 1:
            from . import connect  # (connect imports this module)

            if not connect.status("antigravity"):  # decomp.anything's tools only reach it through the user's settings
                raise Fatal("Antigravity CLI only loads the MCP servers in your own settings: connect it to decomp.anything "
                            "once (Connect your agent, or `decomp connect antigravity`), then start the helpers again")
            allowed = connect.antigravity_allows()
            if not connect.allow_antigravity():
                raise Fatal("Antigravity's settings couldn't be updated to allow decomp.anything's tools: add "
                            f"\"{AGY_ALLOW}\" to \"permissions\": {{\"allow\": [...]}} in {agy_settings()}")
            if not allowed:
                s.push("info", "allowed decomp.anything's tools in Antigravity's settings")
        cmd, env, prompt = self._command(s, token, workdir)
        s.push("info", f"session {s.runs}: {KINDS[s.kind].name} started")
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if WIN else 0
        proc = subprocess.Popen(cmd, cwd=workdir, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", bufsize=1,
                                creationflags=flags, start_new_session=not WIN)
        s.proc = proc
        errors: collections.deque = collections.deque(maxlen=20)

        def feed_prompt():
            try:
                proc.stdin.write(prompt)
                proc.stdin.close()  # end of input: the agent works on this one prompt, then exits
            except OSError:  # it exited before reading (stderr says why)
                pass

        def drain_err():
            for line in proc.stderr:
                if (text := clean_stderr(s.kind, line)) and (not errors or errors[-1] != text):
                    errors.append(text)
        threading.Thread(target=feed_prompt, daemon=True).start()
        threading.Thread(target=drain_err, daemon=True).start()
        saw_tool = False
        said: collections.deque = collections.deque(maxlen=20)
        state: dict = {}
        last_error = refused = ""
        for line in proc.stdout:
            for kind, text in parse_line(s.kind, line, state):
                if kind == "usage":
                    self._account(s, json.loads(text))
                    continue
                saw_tool |= kind == "tool"
                said.append(text)
                if kind == "error":
                    last_error = text
                    refused = refused or (text if text.startswith("Antigravity refused") else "")
                s.push(kind, text)
            if s.stop.is_set():
                _terminate(proc)
                break
        code = proc.wait()
        s.proc = None
        if refused and not s.stop.is_set():
            raise Fatal(refused)  # every retry would be refused the same way
        if code != 0 and not s.stop.is_set() and (why := no_credit(" ".join([*said, *errors]))):
            raise Fatal(why)  # every agent on this account fails the same way until it's topped up
        if code != 0 and not s.stop.is_set() and _THROTTLED.search(" ".join([*said, *errors])):
            s.throttled = True
        if code != 0 and not s.stop.is_set() and _SIGNED_OUT.search(" ".join([*said, *errors])):
            s.signed_out = True
            s.error = f"{KINDS[s.kind].name} isn't signed in on this computer. {signin(KINDS[s.kind])}"
            s.push("error", s.error)
            return False
        if code != 0 and not s.stop.is_set():
            tail = " · ".join(list(errors)[-3:]) or last_error or f"exited with code {code}"
            s.error = tail[:300]
            s.push("error", f"exited with code {code}: {tail[:600]}" if tail != f"exited with code {code}" else tail)
            return False
        if not saw_tool and not s.stop.is_set():
            s.error = "the agent never used the decomp tools" + (f": {list(errors)[-1]}" if errors else "")
            s.push("error", s.error)
            return False
        s.error = ""
        return True

    # -- built-in agent for OpenAI-compatible APIs

    def _run_api(self, s: Session, agent) -> bool:
        """The agent loop for any OpenAI-compatible API. The conversation is kept within the model's context
        (`context_tokens`, or what a local llama.cpp server says it has): older tool output is trimmed first, and
        when the server still says it's too long, trimmed harder and sent again."""
        base = (s.options.get("base_url") or "").rstrip("/")
        model = s.options.get("model") or ""
        if not base or not model:
            raise RuntimeError("set the API address and model first")
        headers = {"Content-Type": "application/json"}
        if s.options.get("api_key"):
            headers["Authorization"] = f"Bearer {s.options['api_key']}"
        try:
            analysis = self.net.is_analysis(self.net.project_row(s.slug))
        except NetworkError:
            analysis = False
        schema = api_tool_schemas(fork=bool(self.net.fork_slug(s.slug)), analysis=analysis)
        messages = [{"role": "system", "content": tools.INSTRUCTIONS},
                    {"role": "user", "content": self.prompt(s)}]
        used_tool = False
        client = httpx.Client(timeout=httpx.Timeout(300, connect=15))
        s.http = client  # stop() closes this, so a long local generation doesn't keep the session alive
        try:
            with client:
                window = context_window(client, base, s.options, s.stop)
                s.push("info", f"session {s.runs}: {model} via {base} ({window // 1000}K tokens of context)")
                budget = int(window * 0.7) - _tokens(schema)  # room for the reply and the tools' definitions
                for _step in range(int(s.options.get("max_steps", 120))):
                    if s.stop.is_set():
                        return True
                    for _attempt in range(4):
                        if s.stop.is_set():
                            return True
                        fit(messages, budget)
                        r = _request_or_stop(s.stop, client, "post", f"{base}/chat/completions", headers=headers,
                                             json={"model": model, "messages": messages, "tools": schema,
                                                   "tool_choice": "auto"})
                        if r is None:
                            return True
                        if r.status_code == 200 or not _too_long(r):
                            break
                        budget = int(budget * 0.6)  # the server counts differently, or knows better: trim more
                    if r.status_code != 200:
                        if (why := no_credit(r.text)) or r.status_code == 402:
                            raise Fatal(why or no_credit("payment required"))
                        s.throttled = r.status_code == 429 or bool(_THROTTLED.search(r.text))
                        s.error = f"API error {r.status_code}: {r.text[:300]}"
                        if _too_long(r):
                            s.error = ("the model's context is too small for this work even after trimming: give it at "
                                       "least 16K tokens (llama.cpp: -c 16384; Ollama: OLLAMA_CONTEXT_LENGTH=16384; LM "
                                       "Studio: Context Length) and set it in Agents & models")
                        s.push("error", s.error)
                        return False
                    reply = r.json()
                    msg = reply["choices"][0]["message"]
                    usage = reply.get("usage") if isinstance(reply.get("usage"), dict) else {}
                    if usage.get("total_tokens"):
                        self._account(s, {"tokens": usage["total_tokens"]})
                    if msg.get("reasoning_content"):
                        s.push("think", msg["reasoning_content"][:2000])
                    if msg.get("content"):
                        s.push("text", msg["content"])
                    calls = msg.get("tool_calls") or []
                    messages.append({k: v for k, v in msg.items() if k in ("role", "content", "tool_calls")} | {"role": "assistant"})
                    if not calls:
                        return used_tool
                    for c in calls:
                        if s.stop.is_set():
                            return True
                        name = c["function"]["name"]
                        try:
                            args = json.loads(c["function"].get("arguments") or "{}")
                        except ValueError:
                            args = {}
                        used_tool = True
                        s.push("tool", f"{name}({_args_brief(args)})")
                        result = tools.call(self.net, agent, s.slug, name, args)
                        if s.stop.is_set():
                            return True
                        messages.append({"role": "tool", "tool_call_id": c["id"], "content": result})
                    if len(messages) > 80:  # keep the conversation small: summarize by restarting fresh
                        return True
            return used_tool
        except httpx.HTTPError:
            if s.stop.is_set():  # stop() closed the request: this isn't an agent failure
                return True
            raise
        finally:
            s.http = None


def _tokens(obj) -> int:
    """A cautious token estimate: code and assembly run about 3 characters a token."""
    return len(obj if isinstance(obj, str) else json.dumps(obj)) // 3 + 4


def _too_long(r) -> bool:
    """The server refused the request because it doesn't fit the model's context."""
    return r.status_code in (400, 413, 422, 500) and bool(re.search(
        r"context|too long|exceed|maximum.*tokens|n_ctx|prompt is too|reduce the length", r.text[:2000], re.IGNORECASE))


def fit(messages: list[dict], budget: int) -> int:
    """Shrink the conversation to `budget` tokens: older tool output goes first (a function's assembly and diffs
    from several steps ago), then older reasoning. The instructions, the task and the latest exchange stay whole.
    Returns the estimate after."""
    total = sum(_tokens(m) for m in messages)
    keep_from = max(2, len(messages) - 2)
    for kinds in (("tool",), ("assistant",)):
        for m in messages[2:keep_from]:
            if total <= budget:
                return total
            text = m.get("content")
            if m.get("role") in kinds and isinstance(text, str) and len(text) > 300:
                before = _tokens(m)
                m["content"] = text[:240] + "\n[... trimmed to save context: call the tool again if you need this]"
                total -= before - _tokens(m)
    return total


def _request_or_stop(stop: threading.Event, client, method: str, url: str, **kwargs):
    """Run one HTTP request in a worker thread and return early when the session is stopped.

    Closing an httpx client does not interrupt a server that has not sent its headers yet (a local model can
    think for minutes before that). The session thread must return on Stop regardless; the daemon worker is
    abandoned, and closing the client still asks the transport to abort when it can."""
    if stop.is_set():
        return None
    box: dict = {}
    done = threading.Event()

    def call() -> None:
        try:
            box["response"] = getattr(client, method)(url, **kwargs)
        except BaseException as e:  # noqa: BLE001 handed to the waiting thread
            box["error"] = e
        finally:
            done.set()

    threading.Thread(target=call, daemon=True, name="agent-api-request").start()
    while not done.wait(0.25):
        if stop.is_set():
            with contextlib.suppress(Exception):
                client.close()
            return None
    if stop.is_set():
        return None
    if "error" in box:
        raise box["error"]
    return box.get("response")


def context_window(client, base: str, options: dict, stop: threading.Event | None = None) -> int:
    """The model's context in tokens: what the user set, else what a llama.cpp server reports (/props), else a
    guess (local servers often run small contexts)."""
    try:
        if int(options.get("context_tokens") or 0) >= 2048:
            return int(options["context_tokens"])
    except (TypeError, ValueError):
        pass
    if is_local(base):
        try:
            r = _request_or_stop(stop, client, "get", re.sub(r"/v1$", "", base) + "/props", timeout=5) if stop else client.get(
                re.sub(r"/v1$", "", base) + "/props", timeout=5)
            n = (r.json().get("default_generation_settings") or {}).get("n_ctx") if r is not None and r.status_code == 200 else None
            if isinstance(n, int) and n >= 2048:
                return n
        except (httpx.HTTPError, ValueError, AttributeError):
            pass
        return 16384
    return 128000


def api_tool_schemas(fork: bool = False, analysis: bool = False) -> list[dict]:
    """OpenAI-style tool definitions for the built-in agent, from the same tools CLI agents get."""
    def s(**props):
        return {"type": "object", "properties": props, "required": [k for k, v in props.items() if v.pop("req", False)]}

    def st(desc, req=False):
        return {"type": "string", "description": desc, "req": req}

    def it(desc):
        return {"type": "integer", "description": desc}
    defs = {
        "project_info": ("Which game, compiler and progress.", s()),
        "claim_function": ("Claim the next function (or one by name/address). Returns assembly, data, best attempt, "
                           "notes and a draft. count > 1: a batch of small functions to judge together.",
                           s(function=st("optional name or address"), strategy=st("finish | easiest | closest | hardest | random"),
                             count=it("up to 6 small functions at once"))),
        "get_function": ("Show any function by name or address.", s(function=st("name or address", True))),
        "compile_and_diff": ("Compile C or C++ for the function, link it at its address and diff against the target. "
                             "Score 0 = matched. Several functions: names comma-separated, all definitions in source.",
                             s(function=st("function name, or several: a, b, c", True), source=st("C or C++ source", True))),
        "complete_function": ("Analysis projects: mark this work item analyzed and save the finding.",
                              s(function=st("work item", True),
                                summary=st("what it does, calls, data, surprises", True))),
        "write_source": ("Save the code you reconstructed into recovered/: a module, a procedure or task of an "
                         "analyzed binary, or a function that can't be made byte-exact. Labelled reconstructed "
                         "(unverified), never a match.",
                         s(function=st("work item: a module, procedure, task or function", True),
                           source=st("the complete module, or the function's code", True))),
        "rea_tool": ("Analysis projects: run one read-only REA tool on the target.",
                     s(tool=st("tool name, e.g. search_strings", True),
                       arguments=st("JSON object of arguments (optional)"))),
        "read_artifact_entry": ("Archive analysis projects: read one file entry in place, without extracting the archive.",
                                s(entry=st("exact archive path", True), offset=it("byte offset"),
                                  length=it("bytes, up to 8192"))),
        "release_function": ("Give up a function with notes for the next agent.",
                             s(function=st("function", True), notes=st("what you tried, what is left", True))),
        "get_context": ("The shared header included in every compile.", s()),
        "edit_context": ("Replace `old` (exactly once) with `new` in the shared header, or append when old is empty.",
                         s(old=st("text to replace, or empty", True), new=st("replacement", True),
                           message=st("why", True))),
        "rename_symbol": ("Give a function or data address a real name.",
                          s(old=st("current name", True), new=st("new name", True), message=st("why"))),
        "split_function": ("Split a merged function at an address.",
                           s(function=st("function", True), at=st("address like 0x80001234", True), new_name=st("name"))),
        "read_data": ("Hex dump of the original's data at an address or symbol.", s(what=st("address or symbol", True),
                                                                                    length=it("bytes, up to 512"))),
        "list_functions": ("List functions by status.", s(status=st("open | matched | all"), limit=it("max rows"))),
        "search_facts": ("Search functions, symbols, strings, imports and addresses; returns callers and users.",
                         s(query=st("name, string, API or address", True), limit=it("max rows"))),
        "list_subsystems": ("Group functions by imported APIs/strings: render, audio, input, network, file, UI, ...",
                            s(limit=it("groups"))),
        "add_note": ("Leave a note for other agents.", s(text=st("note", True), function=st("function"))),
        "search_notes": ("Search notes.", s(query=st("text", True))),
        "find_similar": ("Functions that look like this one, matched ones first, with the best one's source.",
                         s(function=st("function", True), limit=it("how many"))),
        "guide": ("Decompilation know-how; no topic lists topics.", s(topic=st("topic"))),
        "read_file": ("Read a file with line numbers (forks: the project's; ROM projects: the reference folders the "
                      "user named).", s(path=st("path from the project (or first reference folder) root", True),
                                        start=it("first line"), count=it("lines"))),
        "search_code": ("Regex search (forks: the project's C/C++ sources and headers; ROM projects: the reference "
                        "folders' text files, case-insensitive, an address as 0x401070).",
                        s(pattern=st("regular expression", True), glob=st("optional file glob"))),
        "edit_file": ("Replace `old` (exactly once) with `new` in a source/header file, or append when old is empty. "
                      "Undone if any match breaks.", s(path=st("file", True), old=st("text to replace, or empty", True),
                                                       new=st("replacement", True), message=st("why", True))),
        "file_status": ("How far a source file (or a function's file) is from being linked: functions left, its data "
                        "next to the original's, why the last link failed.", s(path=st("file or function", True))),
        "split_file": ("Divide a source file at a function: it and the rest of the file's code (and data from the given "
                       "offsets) go to a new file. Kept only if the game still builds identically.",
                       s(path=st("file", True), at=st("function name or .text offset", True),
                         new_name=st("new file path (optional)"), data=st("e.g. .rodata:0x88 .data:0x28 (optional)"))),
    }
    if fork:
        defs["compile_and_diff"] = ("Write one complete function definition into its source file, build it and diff "
                                    "with objdiff. 100% / score 0 = matched.",
                                    s(function=st("function name", True), source=st("the function definition", True)))
    names = set(tools.tool_names(fork, analysis))
    return [{"type": "function", "function": {"name": n, "description": d, "parameters": p}}
            for n, (d, p) in defs.items() if n in names]


def _terminate(proc: subprocess.Popen) -> None:
    try:
        if WIN:
            # the agent with everything it started (node starts opencode.exe, ...): terminate() would only end the
            # first process and leave the rest working, and spending, in the background
            res = subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, timeout=30)
            if res.returncode != 0 and proc.poll() is None:
                proc.terminate()
        else:
            os.killpg(proc.pid, 15)
    except (OSError, ProcessLookupError, subprocess.TimeoutExpired):
        pass
