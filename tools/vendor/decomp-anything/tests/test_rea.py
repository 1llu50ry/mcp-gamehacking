"""The REA bridge and the RE console speak MCP over stdio to a fake REA that answers the way REA 6 does:
every result wrapped in an evidence record (the answer is its normalized_result), errors as JSON text."""

import json
import sys
import threading
import time
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from decompnet import rea
from decompnet.app import analysis
from decompnet.app.console import Console, ConsoleError
from decompnet.network import NetworkError


class SlowBatch:
    """A REA client whose batch_decompile blocks until the test lets it go, so two requests can overlap."""

    def __init__(self, inner):
        self.inner = inner
        self.calls = 0
        self.started = threading.Event()
        self.release = threading.Event()

    def call(self, tool, arguments=None, **kwargs):
        if tool == "batch_decompile":
            self.calls += 1
            self.started.set()
            assert self.release.wait(10)
        return self.inner.call(tool, arguments, **kwargs)


class CountingClient:
    """A REA client that records which tools the engine asks for."""

    def __init__(self, inner):
        self.inner = inner
        self.tools: list[str] = []

    def call(self, tool, arguments=None, **kwargs):
        self.tools.append(tool)
        return self.inner.call(tool, arguments, **kwargs)

    def count(self, tool: str) -> int:
        return self.tools.count(tool)


FAKE = r"""
import json, sys

TOOLS = [
    {"name": "open_binary", "title": "Open Binary", "description": "Open a target.",
     "inputSchema": {"type": "object", "properties": {"path": {"$ref": "#/$defs/p"}}, "required": ["path"],
                     "$defs": {"p": {"type": "string", "minLength": 1}}, "examples": [{"path": "/tmp/x"}]},
     "annotations": {"readOnlyHint": True}},
    {"name": "procedure_pseudo_code", "title": "Pseudocode", "description": "C.",
     "inputSchema": {"type": "object", "properties": {"procedure": {"type": "string"}}}, "annotations": {"readOnlyHint": True}},
    {"name": "analyze_function", "title": "Analyze", "description": "Dossier.",
     "inputSchema": {"type": "object", "properties": {"procedure": {"type": "string"}}}, "annotations": {"readOnlyHint": True}},
    {"name": "binary_overview", "title": "Overview", "description": "Counts.",
     "inputSchema": {"type": "object", "properties": {}}, "annotations": {"readOnlyHint": True}},
    {"name": "list_procedures", "title": "Procedures", "description": "All of them.",
     "inputSchema": {"type": "object", "properties": {}}, "annotations": {"readOnlyHint": True}},
    {"name": "list_segments", "title": "Segments", "description": "Memory map.",
     "inputSchema": {"type": "object", "properties": {}}, "annotations": {"readOnlyHint": True}},
    {"name": "read_bytes", "title": "Read", "description": "Bytes.",
     "inputSchema": {"type": "object", "properties": {"address": {"type": "string"}, "length": {"type": "integer"}}},
     "annotations": {"readOnlyHint": True}},
    {"name": "install_adb_package", "title": "Install", "description": "Installs an app on a device.",
     "inputSchema": {"type": "object", "properties": {}}, "annotations": {"readOnlyHint": False, "openWorldHint": True}},
]


def wrap(op, value):
    return {"structuredContent": {"evidence_id": "ev_1", "operation": op, "provider": {"name": "Ghidra"},
                                  "confidence": "observed", "limitations": ["a fake"], "raw_result": None,
                                  "normalized_result": value}}


for line in sys.stdin:
    msg = json.loads(line)
    if "id" not in msg:
        continue
    method = msg.get("method")
    if method == "initialize":
        result = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}},
                  "serverInfo": {"name": "fake-rea", "version": "0"}}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        name = msg["params"]["name"]
        args = msg["params"]["arguments"]
        if name == "open_binary":
            result = {"structuredContent": {"result": {"path": args["path"], "format": "elf", "architecture": "x86_64"}}}
        elif name == "procedure_pseudo_code":
            result = wrap(name, f"int sub_{args['procedure']}(void) {{ return 1; }}")
        elif name == "analyze_function":
            result = wrap(name, {"procedure": {"name": "f", "signature": "int f(void)"}, "native_value_flow": {"huge": 1},
                                 "callers": [{"address": "0x1020", "name": "caller", "classification": {"thunk": False}, "body": {}}]})
        elif name == "binary_overview":
            result = wrap(name, {"procedure_count": 2, "string_count": 3, "segment_count": 1})
        elif name == "list_procedures":
            result = wrap(name, [{"address": "0x1000", "value": "main"},
                                 {"address": "0x1020", "value": "helper"}])
        elif name == "list_segments":
            result = wrap(name, [{"name": ".text", "start": "0x1000", "end": "0x2000", "executable": True}])
        elif name == "read_bytes":
            result = wrap(name, {"address": args["address"], "length": args.get("length", 256),
                                 "hex": "90 90 c3"})
        elif name == "search_strings":
            result = wrap(name, [{"address": "0x1000", "value": "hello world"}])
        elif name == "search_procedures":
            result = wrap(name, [{"address": "0x1010", "value": "helper"}])
        elif name in ("procedure_callers", "procedure_callees", "procedure_references"):
            result = wrap(name, [{"address": "0x1020", "name": "caller"}])
        elif name == "batch_decompile":
            items = [{"address": address, "procedure": {"status": "resolved", "address": address, "name": None},
                      "status": "ok", "pseudocode": f"int sub_{address}(void) {{ return 7; }}"}
                     for address in args["addresses"]]
            result = wrap(name, {"items": items, "total": len(items), "succeeded": len(items), "failed": 0})
        elif name in ("get_call_graph", "trace_call_path", "trace_feature", "trace_native_values",
                      "search_bytes", "inspect_native_api"):
            result = wrap(name, {"tool": name, "arguments": args})
        elif name == "install_adb_package":
            result = wrap(name, {"installed": True})
        else:
            error = {"error": {"code": "target_unavailable", "message": "No app is open.",
                               "remediation": {"action": "Call open_binary with its local path."}}}
            result = {"isError": True, "content": [{"type": "text", "text": json.dumps(error)}]}
    else:
        result = {}
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}) + "\n")
    sys.stdout.flush()
"""


@pytest.fixture
def fake(tmp_path, monkeypatch):
    script = tmp_path / "fake_rea.py"
    script.write_text(FAKE)
    monkeypatch.setattr(rea, "CONFIG", tmp_path / "rea.json")
    return [sys.executable, str(script)]


def test_answers_are_unwrapped_and_errors_read(fake):
    with rea.Client(fake) as client:
        assert client.call("open_binary", {"path": "/tmp/game.exe"}) == \
            {"result": {"path": "/tmp/game.exe", "format": "elf", "architecture": "x86_64"}}
        assert client.call("procedure_pseudo_code", {"procedure": "0x1000"}).startswith("int sub_0x1000")
        assert client.call("procedure_pseudo_code", {"procedure": "0x1"}, envelope=True)["confidence"] == "observed"
        with pytest.raises(rea.ReaError, match=r"^No app is open\. Call open_binary"):
            client.call("xrefs", {})
        assert [t["name"] for t in client.tools()][:2] == ["open_binary", "procedure_pseudo_code"]


def test_only_allowlisted_tools_run_for_agents(fake):
    with rea.Client(fake) as client:
        with pytest.raises(rea.ReaError, match="allowlist"):
            client.call("install_adb_package", {})
        assert client.call("install_adb_package", {}, any_tool=True) == {"installed": True}


def test_settings_come_from_the_console_then_the_environment(monkeypatch, fake, tmp_path):
    monkeypatch.setenv("DECOMP_REA", " ".join(fake))
    assert rea.command() == fake and rea.settings()["source"] == "DECOMP_REA"
    saved = rea.save("npx -y rea-agents@6.7.0 mcp", {"GHIDRA_INSTALL_DIR": "/opt/ghidra", "API_TOKEN": "hush"}, "ghidra")
    assert saved["command"] == ["npx", "-y", "rea-agents@6.7.0", "mcp"] and saved["source"] == "saved"
    shown = rea.public()
    assert shown["env"] == {"GHIDRA_INSTALL_DIR": "/opt/ghidra", "API_TOKEN": "•••"}
    monkeypatch.setenv("DECOMP_REA", "off")
    assert rea.command() is None


def test_settings_use_rea_installed_from_the_tools_page(monkeypatch, fake, tmp_path):
    monkeypatch.delenv("DECOMP_REA", raising=False)
    monkeypatch.setattr(rea.shutil, "which", lambda *a, **k: None)  # no REA or npx on PATH
    monkeypatch.setattr(rea.toolchains, "installed", lambda tid, linux=None: {"id": tid} if tid == "rea" else None)
    launcher = tmp_path / "rea"
    monkeypatch.setattr(rea.toolchains, "binary", lambda tid: launcher)
    assert rea.command() == [str(launcher), "mcp"]
    assert rea.settings()["source"] == "installed"


def test_the_tools_page_installs_the_tested_release():
    assert rea.toolchains.get("rea").npm == rea.PACKAGE


def test_draft_uses_the_configured_bridge(monkeypatch, fake, tmp_path):
    monkeypatch.setenv("DECOMP_REA", " ".join(fake))
    monkeypatch.setenv("DECOMP_REA_DRAFTS", "1")
    rea._clients.clear()
    rea._opened.clear()
    rea._cache.clear()
    binary = tmp_path / "game.exe"
    binary.write_bytes(b"MZ" + b"\0" * 100)
    fn = {"vram": 0x1000}
    text = rea.draft(binary, fn, timeout=10)
    assert text and "return 1" in text
    assert rea.draft(binary, fn, timeout=10) == text  # from the cache
    rea.close_all()


def test_search_and_dossier(fake, monkeypatch, tmp_path):
    from decompnet.rom.symbols import Symbol, SymbolTable
    monkeypatch.setenv("DECOMP_REA", " ".join(fake))
    rea._clients.clear()
    rea._opened.clear()
    binary = tmp_path / "game.exe"
    binary.write_bytes(b"MZ" + b"\0" * 100)
    symbols = SymbolTable([Symbol("helper", 0x1010, 8, "func"), Symbol("caller", 0x1020, 8, "func")])
    found = rea.search(binary, "he", symbols, timeout=10)
    assert "hello world" in found and "helper" in found
    fn = {"vram": 0x1000}
    assert "int sub_0x1000" in rea.inspect(binary, fn, symbols, "pseudocode", timeout=10)
    assert "signature: int f(void)" in rea.inspect(binary, fn, symbols, "info", timeout=10)
    assert "callers: caller" in rea.inspect(binary, fn, symbols, "callers", timeout=10)
    rea.close_all()


def test_missing_bridge_is_not_an_error(monkeypatch):
    monkeypatch.setenv("DECOMP_REA", "off")
    assert rea.command() is None
    assert rea.draft(Path("/nonexistent.exe"), {"vram": 0x1000}, timeout=1) is None


def test_console_runs_any_tool_with_its_evidence(monkeypatch, fake):
    monkeypatch.setenv("DECOMP_REA", " ".join(fake))
    console = Console()
    try:
        assert {t["name"]: t["risky"] for t in console.tools()}["install_adb_package"]
        assert console.needs_confirm("open_binary") == []
        opened = console.call("open_binary", {"path": "/bin/true"})
        assert console.target == {"path": "/bin/true", "format": "elf", "architecture": "x86_64"}
        assert opened["result"]["result"]["format"] == "elf"
        res = console.call("analyze_function", {"procedure": "0x1000"})
        assert "native_value_flow" not in res["result"]  # never drawn: kept out of the page
        assert res["result"]["callers"] == [{"address": "0x1020", "name": "caller", "thunk": False}]
        assert res["meta"]["provider"] == "Ghidra" and res["meta"]["limitations"] == ["a fake"]
        with pytest.raises(ConsoleError, match="No app is open"):
            console.call("xrefs", {})
        with pytest.raises(ConsoleError, match="no tool"):
            console.needs_confirm("nope")
    finally:
        console.stop()


def test_console_api_asks_before_tools_that_act(monkeypatch, fake, tmp_path):
    from decompnet.app.engine import RomNetwork
    from decompnet.app.server import build

    monkeypatch.setenv("DECOMP_REA", " ".join(fake))
    home = tmp_path / "home"
    (home / ".decomp").mkdir(parents=True)
    net = RomNetwork(home / ".decomp" / "decomp.db", home)
    mcp, _manager, security = build(net, home / ".decomp", 6498, "s3cret")
    client = TestClient(mcp.streamable_http_app(transport_security=security, host="127.0.0.1"),
                        base_url="http://127.0.0.1:6498")
    client.cookies.set("decomp_live", "s3cret")
    h = {"X-Decomp": "1"}
    assert client.get("/api/rea").json()["configured"] is True
    assert len(client.get("/api/rea/tools").json()) == 8
    assert client.post("/api/rea/call", json={"tool": "open_binary", "arguments": {"path": "/x"}}).status_code == 403
    r = client.post("/api/rea/call", json={"tool": "install_adb_package", "arguments": {}}, headers=h)
    assert r.status_code == 409 and r.json()["confirm"]
    job = client.post("/api/rea/call", json={"tool": "install_adb_package", "arguments": {}, "confirm": True},
                      headers=h).json()["job"]
    for _ in range(100):
        j = client.get(f"/api/job?id={job}").json()
        if j["state"] != "running":
            break
        time.sleep(0.05)
    assert j["state"] == "done" and j["result"]["result"] == {"installed": True}
    saved = client.post("/api/rea/settings", json={"command": " ".join(fake), "env": {"JAVA_HOME": "/jvm"},
                                                     "provider": "ghidra"}, headers=h).json()
    assert saved["settings"]["source"] == "saved" and saved["settings"]["env"] == {"JAVA_HOME": "/jvm"}
    assert json.loads((home / ".decomp" / "rea.json").read_text())["env"] == {"JAVA_HOME": "/jvm"}
    client.post("/api/rea/stop", json={}, headers=h)


def test_analysis_project_has_work_items_claims_and_findings(monkeypatch, fake, tmp_path):
    """Pick any binary: it becomes a normal project whose work items agents claim, read through REA and complete."""
    from decompnet.app.engine import RomNetwork

    client = rea.Client(fake)
    binary = tmp_path / "program.bin"
    binary.write_bytes(b"\x7fELF" + b"\0" * 64)
    opened = client.call("open_binary", {"path": str(binary)})
    monkeypatch.setattr(rea, "open_analysis", lambda target, provider="": (client, opened))
    try:
        net = RomNetwork(tmp_path / "analysis.sqlite", tmp_path / "home")
        agent = net.authenticate(net.register_agent("analyst"))
        slug = net.import_analysis(binary, confirmed=True, log=lambda *_: None)
        ov = net.overview(slug)
        assert ov["kind"] == "analysis" and ov["platform_name"] == "ELF" and ov["functions"] == 2
        text = net.claim(agent, slug)
        assert "CLAIMED" in text and ("main" in text or "helper" in text) and "int f(void)" in text
        claimed = net.store.one("SELECT f.name FROM claims c JOIN functions f ON f.id=c.function_id")["name"]
        assert net.complete_analysis(agent, slug, claimed, "reads a table and returns one entry") == (
            f"✅ {claimed} is analyzed and saved. Your finding is on it and in the project's notes. "
            "Call claim_function for the next item, or add_note about the target as a whole.")
        ov = net.overview(slug)
        assert ov["matched"] == 1 and ov["findings"] == 1
        assert net.add_analysis_task(None, slug, "Map the update protocol", "start at 0x1000") == "Map the update protocol"
        assert net.overview(slug)["functions"] == 3
        assert "hello world" in net.analysis_tool(slug, "search_strings", {"pattern": "hello"})
        with pytest.raises(NetworkError, match="isn't available to agents"):
            net.analysis_tool(slug, "open_binary", {})
        assert net.stats(slug)["agents"]
    finally:
        client.close()


def test_analysis_agents_get_native_graph_batch_and_byte_search(monkeypatch, fake, tmp_path):
    """The native tracing, batch and byte-search tools are on the analysis allowlist and reach the open target."""
    from decompnet.app.engine import RomNetwork

    client = rea.Client(fake)
    binary = tmp_path / "program.bin"
    binary.write_bytes(b"\x7fELF" + b"\0" * 64)
    opened = client.call("open_binary", {"path": str(binary)})
    monkeypatch.setattr(rea, "open_analysis", lambda target, provider="": (client, opened))
    try:
        net = RomNetwork(tmp_path / "analysis.sqlite", tmp_path / "home")
        slug = net.import_analysis(binary, confirmed=True, log=lambda *_: None)
        calls = (("batch_decompile", {"addresses": ["0x1000", "0x1020"]}),
                 ("get_call_graph", {"address": "0x1000", "direction": "forward"}),
                 ("trace_call_path", {"start": "0x1000", "goal": "0x1020"}),
                 ("trace_feature", {"query": "hello"}),
                 ("trace_native_values", {"procedure": "0x1000"}),
                 ("search_bytes", {"pattern": "90 90"}),
                 ("inspect_native_api", {"procedure": "0x1000"}))
        for name, arguments in calls:
            assert name in rea.ANALYSIS_ALLOWED
            assert net.analysis_tool(slug, name, arguments).strip()
    finally:
        client.close()


def test_batch_dossier_keeps_pseudocode_and_says_what_failed():
    value = {"items": [
        {"address": "0x1000", "procedure": {"status": "resolved", "address": "0x1000", "name": "main"},
         "status": "ok", "pseudocode": "int main(void) { return 0; }"},
        {"address": "0x1020", "procedure": {"status": "unknown", "error": {"message": "no function there"}},
         "status": "error", "error": {"message": "no function there"}},
    ], "total": 2, "succeeded": 1, "failed": 1}
    text = analysis.batch_dossier(value)
    assert "### main at 0x1000" in text and "int main(void) { return 0; }" in text
    assert "### 0x1020: REA couldn't decompile it: no function there" in text


def test_survey_and_task_briefs_start_from_a_batch_decompile(monkeypatch, fake, tmp_path):
    """A work item with no address of its own gets pseudocode up front, not only a queue entry."""
    from decompnet.app.engine import RomNetwork

    client = rea.Client(fake)
    binary = tmp_path / "program.elf"
    binary.write_bytes(b"\x7fELF" + b"\0" * 64)
    opened = client.call("open_binary", {"path": str(binary)})
    monkeypatch.setattr(rea, "open_analysis", lambda target, provider="": (client, opened))
    try:
        net = RomNetwork(tmp_path / "analysis.sqlite", tmp_path / "home")
        agent = net.authenticate(net.register_agent("analyst"))
        slug = net.import_analysis(binary, confirmed=True, log=lambda *_: None)
        assert net.analysis_cfg(slug)[1]["target"]["tool"] == "open_binary"
        task = net.add_analysis_task(None, slug, "Map startup", "start at 0x1000 and 0x1020")
        assert net.function_detail(slug, task)["prefill"] is None  # nothing cached yet: viewing does not decompile
        text = net.claim(agent, slug, task)
        assert "Functions named in the task" in text
        assert "int sub_0x1000" in text and "int sub_0x1020" in text
        detail = net.function_detail(slug, task)
        assert detail["prefill"]["heading"] == "Functions named in the task"
        assert detail["prefill"]["items"][0]["code"].startswith("int sub_0x1000")
        assert net.function_detail(slug, "main")["prefill"] is None  # a procedure has its own dossier
        net.complete_analysis(agent, slug, task, "startup decompiled from 0x1000 and 0x1020")

        # The survey item is what an importer makes when no procedure inventory exists; it gets the target's
        # entry points and largest functions instead of a brief full of addresses, asking REA again when the
        # import stored no procedures either.
        proj = net.project_row(slug)
        with net.store.tx() as db:
            db.execute("DELETE FROM functions WHERE project_id=? AND vram>0", (proj["id"],))
            db.execute("INSERT INTO functions(project_id,name,size,n_insns,unit,vram,meta,status) VALUES(?,?,?,?,?,?,?,?)",
                       (proj["id"], "survey", 0, 0, "", 0, json.dumps({"kind": "survey", "address": 0}), "open"))
        survey = net.claim(agent, slug, "survey")
        assert "Starting functions" in survey and "int sub_0x1000" in survey
        assert net.function_detail(slug, "survey")["prefill"]["items"][0]["code"].startswith("int sub_")
    finally:
        client.close()


def test_batch_prefill_is_cached_per_project(monkeypatch, fake, tmp_path):
    """Viewing the same survey or task again reuses its batch; another project decompiles its own."""
    from decompnet.app.engine import RomNetwork

    client = rea.Client(fake)
    proxy = CountingClient(client)

    def open_target(target, provider=""):
        return client, client.call("open_binary", {"path": target["path"]})

    monkeypatch.setattr(rea, "open_analysis", open_target)
    monkeypatch.setattr(rea, "analysis_client", lambda target, provider="": proxy)
    try:
        net = RomNetwork(tmp_path / "cache.sqlite", tmp_path / "home")
        agent = net.authenticate(net.register_agent("analyst"))
        first = tmp_path / "one.elf"
        first.write_bytes(b"\x7fELF" + b"\0" * 64)
        slug = net.import_analysis(first, confirmed=True, log=lambda *_: None)
        task = net.add_analysis_task(None, slug, "Map startup", "start at 0x1000")
        assert net.function_detail(slug, task)["prefill"] is None
        assert proxy.count("batch_decompile") == 0
        assert "int sub_0x1000" in net.claim(agent, slug, task)
        assert proxy.count("batch_decompile") == 1
        assert "int sub_0x1000" in net.get_function(task, slug)
        assert proxy.count("batch_decompile") == 1  # a re-view is served from the project's cache
        stored = json.loads(net.store.one("SELECT config FROM projects WHERE slug=?", slug)["config"])
        assert stored["prefill"]
        net.complete_analysis(agent, slug, task, "startup decompiled from 0x1000")

        restarted = RomNetwork(tmp_path / "cache.sqlite", tmp_path / "home")
        assert "int sub_0x1000" in restarted.get_function(task, slug)
        assert restarted.function_detail(slug, task)["prefill"]["items"][0]["code"].startswith("int sub_0x1000")
        assert proxy.count("batch_decompile") == 1  # the batch is stored with the project, not only in memory

        second = tmp_path / "two.elf"
        second.write_bytes(b"\x7fELF" + b"\0" * 64)
        other = net.import_analysis(second, confirmed=True, log=lambda *_: None)
        task2 = net.add_analysis_task(None, other, "Map startup", "start at 0x1000")
        assert "int sub_0x1000" in net.claim(agent, other, task2)
        assert proxy.count("batch_decompile") == 2  # another project's cache entry is separate
    finally:
        client.close()


def test_on_demand_prefill_builds_for_the_page(monkeypatch, fake, tmp_path):
    """The drawer's button builds the batch through the API job and the page then shows it."""
    from decompnet.app.engine import RomNetwork
    from decompnet.app.server import build

    client = rea.Client(fake)

    def open_target(target, provider=""):
        return client, client.call("open_binary", {"path": target["path"]})

    monkeypatch.setattr(rea, "open_analysis", open_target)
    home = tmp_path / "home"
    (home / ".decomp").mkdir(parents=True)
    net = RomNetwork(home / ".decomp" / "decomp.db", home)
    mcp, _manager, security = build(net, home / ".decomp", 6495, "s3cret")
    http = TestClient(mcp.streamable_http_app(transport_security=security, host="127.0.0.1"),
                      base_url="http://127.0.0.1:6495")
    http.cookies.set("decomp_live", "s3cret")
    try:
        binary = tmp_path / "program.elf"
        binary.write_bytes(b"\x7fELF" + b"\0" * 64)
        slug = net.import_analysis(binary, confirmed=True, log=lambda *_: None)
        task = net.add_analysis_task(None, slug, "Map startup", "start at 0x1000")
        assert http.get(f"/api/function?slug={slug}&name={task}").json()["prefillable"] is True
        started = http.post("/api/analysis/prefill", json={"slug": slug, "name": task},
                            headers={"X-Decomp": "1"}).json()
        for _ in range(100):
            job = http.get(f"/api/job?id={started['job']}").json()
            if job["state"] != "running":
                break
            time.sleep(0.05)
        assert job["state"] == "done", job
        assert job["result"]["prefill"]["items"][0]["code"].startswith("int sub_0x1000")
        # the job's log is the drawer's progress: it names the item, the batch and what REA returned
        assert any("decompiling starting functions" in line for line in job["log"]), job["log"]
        assert any("0x1000" in line for line in job["log"]), job["log"]
        assert any("decompiled 1 starting function" in line for line in job["log"]), job["log"]
        detail = http.get(f"/api/function?slug={slug}&name={task}").json()
        assert detail["prefill"]["items"][0]["code"].startswith("int sub_0x1000")
        with pytest.raises(NetworkError, match="survey item and tasks"):
            net.analysis_prefill(slug, "main")
    finally:
        client.close()


def test_an_import_prefills_the_survey_in_the_background(monkeypatch, fake, tmp_path):
    """A native import that leaves a survey item builds its starting functions on its own, before the page opens."""
    from decompnet.app.engine import RomNetwork
    from decompnet.app.server import build

    client = rea.Client(fake)

    def open_target(target, provider=""):
        return client, client.call("open_binary", {"path": target["path"]})

    monkeypatch.setattr(rea, "open_analysis", open_target)
    # the import sees no procedure inventory (so it makes the survey item); the prefill's later look does
    real_procedures, calls = analysis.procedures, []

    def no_inventory(value, segments):
        calls.append(1)
        return [] if len(calls) == 1 else real_procedures(value, segments)

    monkeypatch.setattr(analysis, "procedures", no_inventory)
    home = tmp_path / "home"
    (home / ".decomp").mkdir(parents=True)
    net = RomNetwork(home / ".decomp" / "decomp.db", home)
    mcp, _manager, security = build(net, home / ".decomp", 6496, "s3cret")
    http = TestClient(mcp.streamable_http_app(transport_security=security, host="127.0.0.1"),
                      base_url="http://127.0.0.1:6496")
    http.cookies.set("decomp_live", "s3cret")
    try:
        binary = tmp_path / "mystery.dat"
        binary.write_bytes(b"not a rom" + b"\0" * 64)
        started = http.post(f"/api/import?confirmed=1&path={binary}", headers={"X-Decomp": "1"}).json()
        for _ in range(200):
            job = http.get(f"/api/job?id={started['job']}").json()
            if job["state"] != "running":
                break
            time.sleep(0.05)
        assert job["state"] == "done", job
        slug = job["result"]["slug"]
        detail = {}
        for _ in range(200):  # the prefill is its own background job: wait for it to land in the project
            detail = http.get(f"/api/function?slug={slug}&name=survey").json()
            if detail.get("prefill"):
                break
            time.sleep(0.05)
        assert detail["prefill"]["items"][0]["code"].startswith("int sub_0x1000"), detail
    finally:
        client.close()


def test_prefill_requests_for_the_same_batch_share_one_decompile(monkeypatch, fake, tmp_path):
    """The import's background job and a drawer click wait for each other instead of decompiling the batch twice."""
    from decompnet.app.engine import RomNetwork

    client = rea.Client(fake)
    slow = SlowBatch(client)

    def open_target(target, provider=""):
        return client, client.call("open_binary", {"path": target["path"]})

    monkeypatch.setattr(rea, "open_analysis", open_target)
    monkeypatch.setattr(rea, "analysis_client", lambda target, provider="": slow)
    try:
        net = RomNetwork(tmp_path / "decomp.db", tmp_path / "home")
        binary = tmp_path / "program.elf"
        binary.write_bytes(b"\x7fELF" + b"\0" * 64)
        slug = net.import_analysis(binary, confirmed=True, log=lambda *_: None)
        task = net.add_analysis_task(None, slug, "Map startup", "start at 0x1000")
        out, waiting = {}, threading.Event()

        def run(tag, log):
            out[tag] = net.analysis_prefill(slug, task, log=log)

        first = threading.Thread(target=run, args=("auto", lambda *_: None))
        first.start()
        assert slow.started.wait(10)

        def click_log(line):
            if "waiting for another request" in line:
                waiting.set()

        second = threading.Thread(target=run, args=("click", click_log))
        second.start()
        assert waiting.wait(10)  # the click waited for the running batch instead of starting its own
        assert slow.calls == 1
        slow.release.set()
        first.join(10)
        second.join(10)
        assert slow.calls == 1
        assert out["auto"]["items"][0]["code"].startswith("int sub_0x1000")
        assert out["click"]["items"] == out["auto"]["items"]
    finally:
        client.close()


def test_picking_an_unsupported_binary_opens_a_normal_project(monkeypatch, fake, tmp_path):
    """The standard import (drop or path) falls back to REA instead of rejecting a file it can't split as a game."""
    from decompnet.app.engine import RomNetwork
    from decompnet.app.server import build

    client = rea.Client(fake)
    binary = tmp_path / "mystery.bin"
    binary.write_bytes(b"not a rom" + b"\0" * 64)
    opened = client.call("open_binary", {"path": str(binary)})
    monkeypatch.setattr(rea, "open_analysis", lambda target, provider="": (client, opened))
    home = tmp_path / "home"
    (home / ".decomp").mkdir(parents=True)
    net = RomNetwork(home / ".decomp" / "decomp.db", home)
    mcp, _manager, security = build(net, home / ".decomp", 6497, "s3cret")
    http = TestClient(mcp.streamable_http_app(transport_security=security, host="127.0.0.1"),
                      base_url="http://127.0.0.1:6497")
    http.cookies.set("decomp_live", "s3cret")
    try:
        started = http.post(f"/api/import?confirmed=1&path={binary}", headers={"X-Decomp": "1"}).json()
        for _ in range(100):
            job = http.get(f"/api/job?id={started['job']}").json()
            if job["state"] != "running":
                break
            time.sleep(0.05)
        assert job["state"] == "done", job
        slug = job["result"]["slug"]
        state = http.get(f"/api/project?slug={slug}").json()
        assert state["kind"] == "analysis" and state["functions"] == 2 and state["platform_name"] == "ELF"
        assert http.get(f"/api/map?slug={slug}").json()["rows"]
    finally:
        client.close()


def test_analysis_agents_get_the_reading_and_finding_tools():
    from decompnet.app import tools
    names = set(tools.tool_names(analysis=True))
    assert {"project_info", "claim_function", "get_function", "complete_function", "rea_tool", "add_note"} <= names
    assert "compile_and_diff" not in names and "edit_context" not in names and "edit_file" not in names


def test_builtin_agent_schemas_for_analysis():
    from decompnet.app.agents import api_tool_schemas
    names = {t["function"]["name"] for t in api_tool_schemas(analysis=True)}
    assert {"complete_function", "rea_tool", "claim_function"} <= names
    assert "compile_and_diff" not in names and "edit_context" not in names
