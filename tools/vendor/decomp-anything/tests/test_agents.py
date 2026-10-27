"""Helper agents: each CLI's output read into the live feed (Antigravity CLI, opencode errors), prompts sent on
stdin, `decomp connect`, and the compact context agents get (assembly, diffs)."""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest

from decompnet import scoring
from decompnet.app import agents, connect


def test_antigravity_stream_json_is_read():
    state: dict = {}
    lines = [
        {"event": "init", "conversation_id": "c", "init": {"cwd": "/w", "tools": ["call_mcp_tool"]}},
        {"event": "step_update", "step_update": {"step_index": 1, "state": "ACTIVE", "step_type": "agent_response",
                                                 "text_delta": "Claiming "}},
        {"event": "step_update", "step_update": {"step_index": 1, "state": "ACTIVE", "step_type": "agent_response",
                                                 "text_delta": "the next one."}},
        {"event": "step_update", "step_update": {"step_index": 1, "state": "DONE", "step_type": "agent_response",
                                                 "text_delta": "\n"}},
        {"event": "step_update", "step_update": {"step_index": 2, "state": "ACTIVE", "step_type": "tool",
                                                 "tool_name": "call_mcp_tool", "tool_info": {"name": "call_mcp_tool",
                                                 "parameters": {"ServerName": "decomp", "ToolName": "claim_function",
                                                                "Arguments": {"strategy": "easiest"}}}}},
        {"event": "step_update", "step_update": {"step_index": 2, "state": "DONE", "step_type": "tool",
                                                 "tool_name": "call_mcp_tool", "tool_info": {"name": "call_mcp_tool",
                                                 "parameters": {"ServerName": "decomp", "ToolName": "claim_function",
                                                                "Arguments": {"strategy": "easiest"}}}}},
        {"event": "result", "result": {"status": "SUCCESS", "num_turns": 3, "usage": {"total_tokens": 1200}}},
    ]
    out = [item for line in lines for item in agents.parse_line("antigravity", json.dumps(line), state)]
    assert out == [("text", "Claiming the next one."), ("tool", "claim_function(easiest)"),
                   ("usage", json.dumps({"tokens": 1200})), ("info", "session finished (3 turns)")]


def test_antigravity_refusing_decomps_tools_says_how_to_allow_them():
    line = json.dumps({"event": "result", "result": {"status": "SUCCESS", "response": "",
                                                     "denied_actions": [{"action": "mcp", "display_name": "CallMcpTool"}]}})
    errors = [t for k, t in agents.parse_line("antigravity", line, {}) if k == "error"]
    assert errors and errors[0].startswith("Antigravity refused") and agents.AGY_ALLOW in errors[0]


def test_opencode_errors_say_what_failed():
    """Issue #3: opencode's error event nests the message under data; the feed showed "None"."""
    line = json.dumps({"type": "error", "sessionID": "s", "error": {"name": "ProviderAuthError",
                                                                    "data": {"message": "no key for deepseek"}}})
    assert agents.parse_line("opencode", line) == [("error", "ProviderAuthError: no key for deepseek")]
    generic = json.dumps({"type": "error", "error": {"name": "UnknownError", "data": {"message": "Unexpected server error."}}})
    assert agents.parse_line("opencode", generic) == []  # a placeholder: the log line on stderr says what failed
    assert agents.parse_line("codex", json.dumps({"type": "turn.failed", "error": {"message": "quota"}})) == [("error", "quota")]
    log = ('timestamp=2026-10-14T14:25:35.946Z level=ERROR run=89d82ac2 message=failed ref=err_ab91f09e '
           'error="ProviderModelNotFoundError: Model not found: nosuch/model." cause="ProviderModelNotFoundError: x\\n at y"')
    assert agents.clean_stderr("opencode", log) == "ProviderModelNotFoundError: Model not found: nosuch/model."
    assert agents.clean_stderr("opencode", "timestamp=1 level=WARN message=slow") == ""
    v2 = ('timestamp=2026-10-20T01:29:59.690Z level=ERROR run=88fd477f message="cli process failed" '
          'cause="AI.Error: Go usage limit exceeded\\n    at vV (/$bunfs/root/chunk.js:6:3619)" role=cli')
    assert agents.clean_stderr("opencode", v2) == "AI.Error: Go usage limit exceeded"  # OpenCode 2 says cause=
    assert agents.clean_stderr("opencode", "    at guarded (internal:shared:114:26)") == ""
    agy = 'AGY_ERROR: {"message": "quota exhausted", "code": 429}'
    assert agents.clean_stderr("antigravity", agy) == "quota exhausted"


def _manager(tmp_path, monkeypatch, kind):
    (tmp_path / "bin").mkdir(exist_ok=True)
    exe = tmp_path / "bin" / {"claude": "claude", "codex": "codex", "antigravity": "agy", "opencode": "opencode"}[kind]
    exe.write_text("#!/bin/sh\n")
    exe.chmod(0o755)
    monkeypatch.setattr(agents, "_which", lambda cmd: str(exe))
    m = agents.Manager.__new__(agents.Manager)
    m.mcp_url = "http://127.0.0.1:6464/mcp"
    m.prompt = lambda s: "line one\nline two with \"quotes\" & <ampersands>"
    return m


def test_prompts_go_in_on_stdin_never_the_command_line(tmp_path, monkeypatch):
    """On Windows, npm installs agents as .cmd scripts: cmd.exe cuts a multi-line argument at its first line break
    and caps the command line at 8191 characters."""
    for kind in ("claude", "codex", "antigravity", "opencode"):
        m = _manager(tmp_path, monkeypatch, kind)
        s = agents.Session(f"{kind}-1", kind, kind, "demo", f"{kind}-1", {"model": "some-model"})
        work = tmp_path / kind
        work.mkdir()
        cmd, env, stdin = m._command(s, "tok", work)
        assert not any("line one" in a for a in cmd), (kind, cmd)
        assert "line one" in stdin and "some-model" in cmd
        assert env["DECOMP_SESSION_TOKEN"] == "tok"  # a `decomp mcp` the agent starts works as this session
    # Antigravity: one stream-json user message, the server in the workspace's own MCP config
    m = _manager(tmp_path, monkeypatch, "antigravity")
    s = agents.Session("antigravity-2", "antigravity", "a", "demo", "antigravity-2", {})
    (tmp_path / "agy2").mkdir()
    cmd, _, stdin = m._command(s, "tok", tmp_path / "agy2")
    assert json.loads(stdin) == {"event": "user", "message": {"content": "line one\nline two with \"quotes\" & <ampersands>"}}
    assert cmd[1:5] == ["--output-format", "stream-json", "--input-format", "stream-json"]
    cfg = json.loads((tmp_path / "agy2" / ".agents" / "mcp_config.json").read_text())
    assert cfg["mcpServers"]["decomp"] == {"serverUrl": "http://127.0.0.1:6464/mcp",
                                           "headers": {"Authorization": "Bearer tok"}}


def test_opencode_free_models_keep_their_tools_but_never_get_to_use_them(tmp_path, monkeypatch):
    """OpenCode Zen's free models refuse requests whose tools were taken out ("deny"); "ask" keeps them listed and
    `opencode run` rejects every ask. Models of other providers get "deny"."""
    monkeypatch.setattr(agents, "_config_model", lambda kind: None)
    for model, rule in (("opencode/big-pickle", "ask"), ("", "ask"), ("deepseek/deepseek-chat", "deny")):
        m = _manager(tmp_path, monkeypatch, "opencode")
        s = agents.Session("opencode-1", "opencode", "o", "demo", "opencode-1", {"model": model})
        work = tmp_path / f"oc-{rule}-{model.replace('/', '_')}"
        work.mkdir()
        m._command(s, "tok", work)
        assert json.loads((work / "opencode.json").read_text())["permission"] == {"edit": rule, "bash": rule, "webfetch": rule}


def test_opencode_2_gets_its_own_config_shape(tmp_path, monkeypatch):
    """OpenCode 2: servers under mcp.servers, decomp's tools offered as themselves (no Code Mode), a permissions
    list, and a private server whose errors reach stderr. Go's free models keep their tools like Zen's."""
    monkeypatch.setattr(agents, "_config_model", lambda kind: None)
    monkeypatch.setattr(agents, "version", lambda kind, path: "opencode v2.0.32")
    for model, rule in (("opencode-go/minimax-m3.1-flash-free", "ask"), ("deepseek/deepseek-chat", "deny")):
        m = _manager(tmp_path, monkeypatch, "opencode")
        s = agents.Session("opencode-1", "opencode", "o", "demo", "opencode-1", {"model": model})
        work = tmp_path / f"oc2-{rule}"
        work.mkdir()
        cmd, _, _ = m._command(s, "tok", work)
        assert "--standalone" in cmd and "--log-level" not in cmd
        cfg = json.loads((work / "opencode.json").read_text())
        assert cfg["mcp"] == {"servers": {"decomp": {"type": "remote", "url": "http://127.0.0.1:6464/mcp", "oauth": False,
                                                     "codemode": False, "headers": {"Authorization": "Bearer tok"}}}}
        rules = {r["action"]: r["effect"] for r in cfg["permissions"]}
        assert rules == {"execute": "deny", "decomp_*": "allow", "edit": rule, "shell": rule, "webfetch": rule}
    assert agents.major("opencode v2.0.32") == 2 and agents.major("1.4.3") == 1 and agents.major(None) == 0


def test_gemini_cli_helpers_carry_on_as_antigravity():
    assert agents.kind_id("gemini") == "antigravity" and agents.kind_id("agy") == "antigravity"
    assert "gemini" not in agents.KINDS and agents.KINDS["antigravity"].command == "agy"


def test_antigravity_permission_is_added_without_losing_other_settings(tmp_path, monkeypatch):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"model": "Gemini", "permissions": {"allow": ["command(ls)"]}}), encoding="utf-8")
    monkeypatch.setattr(connect, "agy_settings", lambda: path)
    assert not connect.antigravity_allows()
    assert connect.allow_antigravity()
    cfg = json.loads(path.read_text(encoding="utf-8"))
    assert cfg["model"] == "Gemini" and cfg["permissions"]["allow"] == ["command(ls)", agents.AGY_ALLOW]
    assert connect.antigravity_allows()
    assert connect.allow_antigravity() and cfg["permissions"]["allow"].count(agents.AGY_ALLOW) == 1


def test_connect_antigravity(tmp_path, monkeypatch):
    monkeypatch.setattr(connect, "_which", lambda cmd: f"/bin/{cmd}")
    monkeypatch.setattr(connect, "bridge_command", lambda: ["/usr/bin/python3", "-m", "decompnet.app.cli", "mcp"])
    cmd = connect.commands("antigravity")
    # agy wants flags before the name, and `--` before a command whose arguments start with "-"
    assert cmd == ["/bin/agy", "mcp", "add", "-e", "DECOMP_AGENT_NAME=antigravity", "decomp", "--",
                   "/usr/bin/python3", "-m", "decompnet.app.cli", "mcp"]


def test_assembly_for_agents_is_compact():
    asm = ("glabel func_80013C60\n/* 4460 80013C60 27BDFF88 */  addiu      $sp, $sp, -0x78\n"
           "/* 4464 80013C64 AFB10054 */  sw         $s1, 0x54($sp)\n.L80013CC4:\n"
           "/* 44C8 80013CC8 00000000 */  nop\n")
    assert scoring.compact_asm(asm) == ("glabel func_80013C60\n  addiu $sp, $sp, -0x78\n  sw $s1, 0x54($sp)\n"
                                        ".L80013CC4:\n  nop")
    assert scoring.compact_asm("\tpush {r4, lr}\n") == "\tpush {r4, lr}"  # other listings stay as they are


def test_diffs_sum_up_and_shorten_long_runs():
    rows = [(" ", "addiu $sp, $sp, -8", "addiu $sp, $sp, -8"), ("r", "move $s0, $a0", "move $s1, $a0")]
    rows += [("<", f"lw $v0, {i}($s0)", "") for i in range(300)]
    rows += [(" ", "jr $ra", "jr $ra")]
    text = scoring.render_rows(rows)
    assert text.splitlines()[0] == "300 missing, 1 regalloc"
    assert "... 297 more missing (target only) ..." in text and "lw $v0, 299($s0)" in text
    assert len(text.splitlines()) < 15


def test_helpers_and_the_agent_you_talk_to_never_share_an_identity(tmp_path):
    """8 Antigravity helpers showed as 15 agents: the helpers reached decomp.wtf through the user's own `decomp mcp`,
    which signed each in as a new agent of the user's, named like the helpers (antigravity-9...). Chat identities
    are numbered differently now, and a helper never counts as the agent the user talks to."""
    from decompnet.app.engine import RomNetwork

    net = RomNetwork(tmp_path / "app.db", tmp_path)
    a, _ = net.chat_agent("antigravity")
    b, _ = net.chat_agent("antigravity")  # a second chat session at the same time
    assert (a.name, b.name) == ("antigravity", "antigravity_2")
    net.register_agent("antigravity-2", "you", origin="chat")  # a chat identity from before, named like a helper
    helper, _ = net.local_agent("antigravity-2")
    assert not net.is_chat(helper) and net.is_chat(a)
    assert net.local_agent("autopilot")[0].name == "autopilot"


def test_a_replaced_token_counts_as_a_lost_session():
    from decompnet.app.bridge import _session_lost

    assert _session_lost("invalid api token")
    assert _session_lost("Error executing tool progress: missing API token")
    assert _session_lost("session terminated")
    assert _session_lost("connection closed")
    assert not _session_lost("a compile error")


def test_local_agent_tokens_survive_restarts(tmp_path):
    """A helper's MCP bridge reconnects after the app restarts; its token must still authenticate."""
    from decompnet.app.engine import RomNetwork

    net = RomNetwork(tmp_path / "app.db", tmp_path, agent_secret="stable-secret")
    a1, t1 = net.local_agent("helper-1")
    a2, t2 = net.local_agent("helper-1")
    assert a1.id == a2.id and t1 == t2
    assert net.authenticate(t1).name == "helper-1"
    again = RomNetwork(tmp_path / "app.db", tmp_path, agent_secret="stable-secret")
    assert again.local_agent("helper-1")[1] == t1


def test_antigravity_helpers_say_when_it_isnt_connected(tmp_path, monkeypatch):
    from decompnet.app import connect

    m = _manager(tmp_path, monkeypatch, "antigravity")
    monkeypatch.setattr(connect, "status", lambda kind: False)
    s = agents.Session("antigravity-1", "antigravity", "a", "demo", "antigravity-1", {})
    s.runs = 1
    with pytest.raises(agents.Fatal, match="decomp connect antigravity"):
        m._run_cli(s, "tok", tmp_path)


def test_stopping_an_api_agent_aborts_the_request_in_flight(tmp_path):
    """A local model can think for minutes. Stop must close the HTTP request, not wait for the answer."""
    class Net:
        def is_analysis(self, _project): return False
        def project_row(self, _slug): return {}
        def fork_slug(self, _slug): return None

    class Slow(BaseHTTPRequestHandler):
        def do_POST(self):
            self.server.hit.set()
            time.sleep(10)  # what a local model does before its first byte

        def log_message(self, *_args): pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Slow)
    server.daemon_threads = True
    server.hit = threading.Event()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        manager = agents.Manager(Net(), tmp_path, "http://127.0.0.1:9/mcp")
        manager.prompt = lambda _s: "work"
        s = agents.Session("api-1", "api", "Local #1", "game", "api-local",
                           {"base_url": f"http://127.0.0.1:{server.server_port}/v1", "model": "local",
                            "context_tokens": 32768})
        manager.sessions[s.id] = s
        result = {}
        thread = threading.Thread(target=lambda: result.update(ok=manager._run_api(s, SimpleNamespace(id=1))))
        thread.start()
        assert server.hit.wait(2), "the request did not reach the server"
        started = time.time()
        manager.stop(s.id)
        thread.join(2)
        assert not thread.is_alive(), "Stop waited for the model instead of closing the request"
        assert result == {"ok": True} and s.state == "stopped" and time.time() - started < 1
    finally:
        server.shutdown()
        server.server_close()
