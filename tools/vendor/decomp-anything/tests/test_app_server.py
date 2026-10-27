"""The local app: GUI API security, demo import, live feed, agent output parsing, the built-in API agent."""

import json
import os
import shutil
import sys
import time

import httpx
import pytest
from starlette.testclient import TestClient

from decompnet import toolchains
from decompnet.app import agents
from decompnet.app.engine import RomNetwork
from decompnet.app.server import build

# the tests that import the demo ROM (the rest, such as the GUI's security, run anywhere)
needs_demo = pytest.mark.skipif(toolchains.installed("gcc-2.7.2-kmc") is None or not shutil.which("ld.lld"),
                                reason="needs gcc-2.7.2-kmc")
PORT, SECRET = 6499, "s3cret-for-tests"


@pytest.fixture(scope="module")
def app(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    (home / ".decomp").mkdir()
    net = RomNetwork(home / ".decomp" / "decomp.db", home)
    mcp, manager, security = build(net, home / ".decomp", PORT, SECRET)
    app = mcp.streamable_http_app(transport_security=security, host="127.0.0.1")
    client = TestClient(app, base_url=f"http://127.0.0.1:{PORT}")
    client.cookies.set("decomp_live", SECRET)
    return client, net, manager


def test_gui_needs_the_secret_and_the_right_host(app):
    client, _, _ = app
    anon = TestClient(client.app, base_url=f"http://127.0.0.1:{PORT}")
    assert anon.get("/api/state").status_code == 401
    assert anon.get("/").status_code == 401
    r = anon.get(f"/?k={SECRET}", follow_redirects=False)
    assert r.status_code == 303 and "decomp_live" in r.headers["set-cookie"] and "samesite=strict" in r.headers["set-cookie"].lower()
    evil = TestClient(client.app, base_url="http://evil.example:6499")
    evil.cookies.set("decomp_live", SECRET)
    assert evil.get("/api/state").status_code == 403
    # writes need the custom header too (a cross-site form can't send it)
    assert client.post("/api/settings", json={"per_session": 3}).status_code == 403
    assert client.post("/api/settings", json={"per_session": 3}, headers={"X-Decomp": "1"}).status_code == 200
    # these tests script the agents themselves: no autopilot after the import
    assert client.post("/api/settings", json={"autopilot": False}, headers={"X-Decomp": "1"}).json()["autopilot"] is False


@needs_demo
def test_import_demo_and_follow_it_live(app):
    client, _net, _ = app
    h = {"X-Decomp": "1"}
    assert client.post("/api/import?confirmed=0", content=b"x" * 10, headers=h).status_code == 400
    job = client.post("/api/import?demo=1", content=b"", headers=h).json()["job"]
    for _ in range(200):
        j = client.get(f"/api/job?id={job}").json()
        if j["state"] != "running":
            break
        time.sleep(0.1)
    assert j["state"] == "done", j
    slug = j["result"]["slug"]
    st = client.get("/api/state").json()
    assert st["projects"][0]["slug"] == slug and any(a["id"] == "api" for a in st["agents"])
    full = client.get(f"/api/map?slug={slug}").json()
    assert len(full["rows"]) >= 95 and "name" in full["keys"]
    assert client.get(f"/api/map?slug={slug}&since={full['sig']}").json() == {"sig": full["sig"], "same": True}
    live = client.get(f"/api/live?slug={slug}").json()
    assert live["overview"]["functions"] >= 95 and live["events"][0]["kind"] == "import"
    detail = client.get(f"/api/function?slug={slug}&name=func_80000460").json()
    assert "glabel" in detail["asm"]


def test_settings_never_echo_the_api_key(app):
    client, _, _ = app
    out = client.post("/api/settings", json={"api": {"provider": "deepseek", "api_key": "sk-abcdef123456"}},
                      headers={"X-Decomp": "1"}).json()
    assert "sk-abcdef" not in json.dumps(out) and out["api"]["has_key"]
    assert "sk-abcdef" not in json.dumps(client.get("/api/state").json())


def test_parse_agent_output():
    claude = json.dumps({"type": "assistant", "message": {"content": [
        {"type": "text", "text": "Matched it."},
        {"type": "tool_use", "name": "mcp__decomp__compile_and_diff", "input": {"function": "f", "source": "a\nb"}}]}})
    assert agents.parse_line("claude", claude) == [("text", "Matched it."), ("tool", "compile_and_diff(f, 2 lines of C)")]
    codex = json.dumps({"type": "item.started", "item": {"type": "mcp_tool_call", "server": "decomp", "tool": "claim_function",
                                                        "arguments": {"strategy": "easiest"}}})
    assert agents.parse_line("codex", codex) == [("tool", "claim_function(easiest)")]
    opencode = json.dumps({"type": "text", "part": {"text": "done"}})
    assert agents.parse_line("opencode", opencode) == [("text", "done")]
    assert agents.parse_line("claude", "not json at all") == [("info", "not json at all")]


@needs_demo
def test_builtin_api_agent_matches_a_function(app, monkeypatch):
    """A scripted OpenAI-compatible model: claim, compile the right C, stop. The tool loop must do the rest."""
    _client, net, manager = app
    slug = net.store.one("SELECT slug FROM projects")["slug"]
    script = iter([
        {"tool_calls": [{"id": "1", "type": "function",
                         "function": {"name": "claim_function", "arguments": json.dumps({"function": "func_800007F4"})}}]},
        {"tool_calls": [{"id": "2", "type": "function", "function": {"name": "compile_and_diff", "arguments": json.dumps(
            {"function": "func_800007F4", "source": "s32 func_800007F4(s32 v) { return v < 0 ? -v : v; }"})}}]},
        {"content": "Matched."},
    ])
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        assert request.headers["authorization"] == "Bearer test-key" and body["tools"]
        msg = {"role": "assistant", "content": None} | next(script)
        return httpx.Response(200, json={"choices": [{"message": msg}]})

    real = httpx.Client
    monkeypatch.setattr(agents.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    s = agents.Session("api-t", "api", "Test", slug, "api-test", {"base_url": "http://mock/v1", "model": "m", "api_key": "test-key"})
    agent, _ = net.local_agent("api-test")
    assert manager._run_api(s, agent) is True
    assert net._function("func_800007F4", slug)["status"] == "matched"
    assert "byte-identical" in seen[-1]["messages"][-1]["content"]


def test_an_agent_nobody_signed_in_to_stops_and_says_so(tmp_path, monkeypatch):
    """Claude Code without a sign-in exits at once: say that (not "exited with code 1") and don't keep retrying."""
    manager = agents.Manager(None, tmp_path, "http://127.0.0.1:9/mcp")
    code = "print('Not logged in \\u00b7 Please run /login'); raise SystemExit(1)"
    monkeypatch.setattr(manager, "_command", lambda s, token, workdir: ([sys.executable, "-c", code], dict(os.environ), ""))
    s = agents.Session("claude-1", "claude", "Claude Code #1", "game", "claude-1", {})
    assert manager._run_cli(s, "token", tmp_path) is False
    assert s.signed_out and "isn't signed in" in s.error and "/login" in s.error


def test_an_agent_out_of_credit_stops_and_says_so(tmp_path, monkeypatch):
    """DeepSeek's "Insufficient Balance" (here through opencode): stop at once and say what to do. "Too many
    requests" is the provider's limit of requests at once: not a failure, the session waits and tries again."""
    manager = agents.Manager(None, tmp_path, "http://127.0.0.1:9/mcp")
    s = agents.Session("opencode-1", "opencode", "opencode #1", "game", "opencode-1", {})

    def says(text: str) -> None:
        code = f"print({text!r}); raise SystemExit(1)"
        monkeypatch.setattr(manager, "_command", lambda s, token, workdir: ([sys.executable, "-c", code], dict(os.environ), ""))

    says("AI_APICallError: Insufficient Balance (request_id: 3e759c3b)")
    with pytest.raises(agents.Fatal, match=r"out of credit .*Insufficient Balance.*top it up"):
        manager._run_cli(s, "token", tmp_path)
    says("AI_APICallError: Too many requests. Your current concurrency is 5, which exceeds your concurrency limit of 5")
    assert manager._run_cli(s, "token", tmp_path) is False and s.throttled


@needs_demo
def test_builtin_api_agent_out_of_credit(app, monkeypatch):
    _client, net, manager = app
    slug = net.store.one("SELECT slug FROM projects")["slug"]
    answers = iter([httpx.Response(429, json={"error": {"message": "Rate limit reached for requests"}}),
                    httpx.Response(402, json={"error": {"message": "Insufficient Balance"}})])
    real = httpx.Client
    monkeypatch.setattr(agents.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(lambda r: next(answers)), **kw))
    s = agents.Session("api-c", "api", "Test", slug, "api-credit", {"base_url": "http://mock/v1", "model": "m",
                                                                    "context_tokens": 32768})
    agent, _ = net.local_agent("api-credit")
    assert manager._run_api(s, agent) is False and s.throttled
    with pytest.raises(agents.Fatal, match="out of credit"):
        manager._run_api(s, agent)


def test_agent_spend_is_read_from_their_output():
    claude = agents.parse_line("claude", json.dumps({"type": "result", "total_cost_usd": 0.42, "num_turns": 9}))
    assert ("usage", json.dumps({"usd": 0.42})) in claude and any(k == "info" for k, _ in claude)
    codex = agents.parse_line("codex", json.dumps({"type": "turn.completed", "usage": {"input_tokens": 900, "output_tokens": 100}}))
    assert ("usage", json.dumps({"tokens": 1000})) in codex
    opencode = agents.parse_line("opencode", json.dumps({"type": "step_finish", "part": {"cost": 0.01}}))
    assert ("usage", json.dumps({"usd": 0.01})) in opencode


@needs_demo
def test_helpers_are_remembered_to_resume(app):
    _client, net, manager = app
    slug = net.store.one("SELECT slug FROM projects")["slug"]
    seen = []
    manager.persist = lambda running: seen.append([r["kind"] for r in running])
    (sid,) = manager.start("api", slug, 1, {"base_url": "http://127.0.0.1:9/v1", "model": "m"})
    assert seen[-1] == ["api"]
    manager.stop()  # the app quitting: nothing is forgotten, they resume next time
    assert seen[-1] == ["api"]
    manager.stop(sid)  # you stopping it: forgotten
    assert seen[-1] == []
    manager.remove(sid)


def test_an_older_app_still_running_after_an_upgrade_is_replaced(tmp_path):
    """After an upgrade the old version may still be running: `decomp` and `decomp mcp` stop it and start the new
    one, instead of talking to an app that doesn't know the new endpoints."""
    import http.server
    import threading

    from decompnet.app.cli import replace_older

    quit_called = threading.Event()

    class Old(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"ok": True, "app": "decomp-wtf", "version": "0.4.2"}).encode()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            quit_called.set()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"{}")
            threading.Thread(target=server.shutdown, daemon=True).start()

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Old)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    state = tmp_path / "server.json"
    state.write_text(json.dumps({"port": server.server_address[1], "secret": "s"}))
    assert replace_older(state, log=lambda *_: None) is None and quit_called.is_set()
    server.server_close()


def test_an_older_bridge_never_stops_a_newer_app(tmp_path, monkeypatch):
    """An agent set up with an older install's `decomp mcp` must use the newer app that's running, not replace it."""
    from decompnet.app import cli

    monkeypatch.setattr(cli, "_running_version", lambda port: "99.0.0")
    state = tmp_path / "server.json"
    state.write_text(json.dumps({"port": 1234, "secret": "s"}))
    assert cli.replace_older(state, log=lambda *_: None) == {"port": 1234, "secret": "s"}
    assert cli._version_key("0.10.0") > cli._version_key("0.9.4")


def test_a_job_always_ends_and_says_why(tmp_path):
    """Whatever goes wrong in an import, the job ends with words the user can act on and the log has the whole
    story: before, an error of a kind nobody caught left the GUI on "Analysing…" forever."""
    import subprocess

    from decompnet.app.server import Jobs

    jobs = Jobs(tmp_path / "logs" / "decomp.log")

    def wait(jid):
        for _ in range(200):
            if jobs.jobs[jid]["state"] != "running":
                return jobs.jobs[jid]
            time.sleep(0.01)
        raise AssertionError("the job never ended")

    def bug(log):
        log("reading the ROM")
        return {}["missing"]

    def slow(log):
        raise subprocess.TimeoutExpired(["/usr/bin/systemd-run", "--user", "--", "/x/luvdis", "disasm"], 1800)

    def failed(log):
        raise subprocess.CalledProcessError(2, ["ninja"], stderr=b"ld: undefined symbol foo")

    job = wait(jobs.start("import", bug))
    assert job["state"] == "error" and "KeyError" in job["error"] and "report" in job["error"]
    assert "Traceback" in job["trace"]
    assert "luvdis took longer than 30 minutes" in wait(jobs.start("import", slow))["error"]
    assert wait(jobs.start("build", failed))["error"] == "ninja failed (2): ld: undefined symbol foo"
    logged = (tmp_path / "logs" / "decomp.log").read_text()
    assert "reading the ROM" in logged and "KeyError" in logged and "Traceback" in logged


def test_the_log_can_be_read_from_the_gui(app):
    client, _, _ = app
    res = client.get("/api/log")
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/plain")
    anon = TestClient(client.app, base_url=f"http://127.0.0.1:{PORT}")
    assert anon.get("/api/log").status_code == 401


def test_a_project_that_cant_be_read_is_listed_with_the_reason(app, monkeypatch):
    """One odd project used to empty the whole sidebar (or quietly vanish from it)."""
    client, net, _ = app
    with net.store.tx() as db:
        db.execute("INSERT INTO projects(slug,name,description,arch,big_endian,root,config) VALUES(?,?,?,?,?,?,?)",
                   ("odd-game", "Odd Game", "", "mips", 1, "/nowhere", "{}"))
    real = net.overview

    def overview(slug, *a, **k):
        if slug == "odd-game":
            raise TypeError("'NoneType' object is not subscriptable")
        return real(slug, *a, **k)

    monkeypatch.setattr(net, "overview", overview)
    listed = {p["slug"]: p for p in client.get("/api/projects").json()}
    assert "TypeError" in listed["odd-game"]["broken"] and listed["odd-game"]["title"] == "Odd Game"
    assert any("broken" not in p for p in listed.values()) or len(listed) == 1
    assert client.get("/api/state").status_code == 200
    with net.store.tx() as db:
        db.execute("DELETE FROM projects WHERE slug='odd-game'")


@needs_demo
def test_the_api_agent_stays_within_a_small_local_context(app, monkeypatch):
    """A local llama.cpp model with a small context: the agent learns it from /props, trims older tool output to
    fit, and when the server still says the request is too long, trims harder and sends it again."""
    _client, net, manager = app
    slug = net.store.one("SELECT slug FROM projects")["slug"]
    names = [r["name"] for r in net.store.all("SELECT name FROM functions WHERE project_id=(SELECT id FROM projects "
                                                 "WHERE slug=?) ORDER BY n_insns DESC LIMIT 6", slug)]
    script = iter([{"tool_calls": [{"id": str(k), "type": "function", "function": {
        "name": "get_function", "arguments": json.dumps({"function": n})}}]} for k, n in enumerate(names)]
        + [{"content": "done looking"}])
    sizes, refused = [], []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/props":
            return httpx.Response(200, json={"default_generation_settings": {"n_ctx": 16384}})
        size = len(request.content)
        if size > 30000 and not refused:  # once: the server counts tokens its own way
            refused.append(size)
            return httpx.Response(400, json={"error": {"message": "the request exceeds the available context size"}})
        sizes.append(size)
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": None} | next(script)}]})

    real = httpx.Client
    monkeypatch.setattr(agents.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    s = agents.Session("api-c", "api", "Test", slug, "api-ctx", {"base_url": "http://127.0.0.1:8080/v1", "model": "m"})
    agent, _ = net.local_agent("api-ctx")
    assert manager._run_api(s, agent) is True
    assert len(sizes) == len(names) + 1 and max(sizes) < 16384 * 3  # all of it, each within the context
    assert refused  # and it got past a refusal


def test_fit_keeps_the_task_and_the_latest_exchange():
    msgs = [{"role": "system", "content": "rules " * 100}, {"role": "user", "content": "task " * 100}]
    for k in range(6):
        msgs += [{"role": "assistant", "content": f"thinking {k} " * 50},
                 {"role": "tool", "tool_call_id": str(k), "content": f"assembly {k} " * 400}]
    agents.fit(msgs, 3000)
    assert msgs[0]["content"] == "rules " * 100 and msgs[1]["content"] == "task " * 100
    assert msgs[-1]["content"] == "assembly 5 " * 400  # the latest result, whole
    assert "trimmed" in msgs[3]["content"]
