"""Feature tracing: REA's application graph becomes a named group of work items, with a brief and a report."""

import time

import pytest
from starlette.testclient import TestClient

from decompnet import rea
from decompnet.app import analysis
from decompnet.app.engine import RomNetwork
from decompnet.network import NetworkError

MAIN = "jag_node_" + "1" * 64
HANDLER = "jag_node_" + "2" * 64
ENDPOINT = "jag_node_" + "3" * 64


def trace():
    """The shape trace_application_feature returns, trimmed to what the app reads."""
    return {
        "trace_id": "jatr_" + "a" * 64,
        "source_evidence_id": "ev_app",
        "source_graph_id": "jag_" + "b" * 64,
        "seed": {"kind": "route", "value": "/api/update", "match": "exact", "case_sensitive": False},
        "direction": "both",
        "seed_matches": [{"node_id": MAIN, "kind": "route", "basis": "label", "field": "path"}],
        "graph": {
            "nodes": [
                {"node_id": MAIN, "kind": "javascript-module",
                 "identity": {"strategy": "canonical-path", "stability": "artifact-version",
                              "artifact_sha256": "c" * 64, "path": "src/main.js"},
                 "observations": [{"label": "src/main.js", "properties": {},
                                   "evidence": {"state": "observed", "authority": "ast-static-analysis"}}]},
                {"node_id": HANDLER, "kind": "ipc-handler",
                 "identity": {"strategy": "artifact-local-key", "stability": "artifact-version",
                              "artifact_sha256": "c" * 64, "namespace": "ipc-channel", "key": "check-update"},
                 "observations": [{"label": "ipc:check-update", "properties": {},
                                   "evidence": {"state": "observed", "authority": "ast-static-analysis"}}]},
                {"node_id": ENDPOINT, "kind": "endpoint",
                 "identity": {"strategy": "artifact-local-key", "stability": "artifact-version",
                              "artifact_sha256": "c" * 64, "namespace": "endpoint",
                              "key": "https://api.example/update"},
                 "observations": [{"label": "https://api.example/update", "properties": {},
                                   "evidence": {"state": "inferred", "authority": "static-relationship-inference"}}]},
            ],
            "edges": [
                {"edge_id": "jag_edge_1", "source_node_id": MAIN, "target_node_id": HANDLER,
                 "relation": "imports", "properties": {}},
                {"edge_id": "jag_edge_2", "source_node_id": HANDLER, "target_node_id": ENDPOINT,
                 "relation": "sends", "properties": {}},
                {"edge_id": "jag_edge_3", "source_node_id": HANDLER, "target_node_id": "jag_node_missing",
                 "relation": "calls", "properties": {}},
            ],
        },
        "paths": [{"path_id": "jatp_1", "start_node_id": MAIN, "end_node_id": ENDPOINT,
                   "end_kind": "endpoint", "node_ids": [MAIN, HANDLER, ENDPOINT],
                   "edge_ids": ["jag_edge_1", "jag_edge_2"], "authorities": ["ast-static-analysis"],
                   "contains_inference": False}],
        "summary": {"matched_seeds": 1, "traced_nodes": 3, "traced_edges": 2, "terminal_paths": 1,
                    "native_handoffs": 0, "observed_facts": 2, "inferred_facts": 1,
                    "unknown_facts": 0, "unavailable_facts": 0},
        "coverage": {"status": "complete-within-source", "source_graph_status": "complete",
                     "total_seed_matches": 1},
        "evidence_links": ["ev_app"],
        "limitations": ["static reachability is not runtime execution"],
    }


def test_graph_normalization_names_nodes_and_keeps_reached_edges():
    graph = analysis.feature_graph(trace())
    assert [(n["kind"], n["name"]) for n in graph["nodes"]] == [
        ("javascript-module", "src/main.js"),
        ("ipc-handler", "ipc:check-update"),
        ("endpoint", "https://api.example/update"),
    ]
    assert [(e["source"], e["target"], e["relation"]) for e in graph["edges"]] == [
        (MAIN, HANDLER, "imports"), (HANDLER, ENDPOINT, "sends")]  # the edge to an untraced node is dropped
    assert graph["truncated"] is False and graph["paths"] == 1
    assert analysis.reached_by(graph["edges"], graph["nodes"], HANDLER) == "src/main.js —imports→"
    assert analysis.reached_by(graph["edges"], graph["nodes"], ENDPOINT) == "ipc:check-update —sends→"


def test_a_trace_is_bounded():
    many = trace()
    many["graph"]["nodes"] = [many["graph"]["nodes"][0]] + [
        {"node_id": f"jag_node_{i:064x}", "kind": "javascript-module",
         "identity": {"strategy": "canonical-path", "artifact_sha256": "c" * 64, "path": f"src/m{i}.js"},
         "observations": [{"label": f"m{i}", "properties": {}}]} for i in range(20)]
    graph = analysis.feature_graph(many, max_nodes=4, max_edges=1)
    assert len(graph["nodes"]) == 4 and graph["truncated"] is True


def test_seed_validation_matches_rea():
    assert analysis.feature_seed("string", "update")["match"] == "contains"
    assert analysis.feature_seed("route", "/api", None)["match"] == "exact"
    with pytest.raises(ValueError, match="seed kind"):
        analysis.feature_seed("nonsense", "x")
    with pytest.raises(ValueError, match="node-id"):
        analysis.feature_seed("node-id", MAIN, "contains")


class FakeClient:
    def __init__(self, target):
        self.target = target
        self.calls = []

    def call(self, tool, arguments=None, timeout=None, *, any_tool=False, envelope=False):
        self.calls.append(tool)
        if tool in ("binary_overview", "list_segments", "list_procedures"):
            return {}
        raise AssertionError(f"unexpected REA tool {tool}")


@pytest.fixture
def project(tmp_path, monkeypatch):
    app = tmp_path / "app"
    app.mkdir()
    (app / "main.js").write_text("console.log('update')")
    monkeypatch.setattr(rea, "open_analysis", lambda target, provider="": (
        FakeClient(target), {"result": {"path": target["path"], "format": "javascript", "kind": "application"}}))
    monkeypatch.setattr(rea, "trace_feature", lambda target, provider, seed, direction: {
        "evidence_id": "ev_trace", "operation": "trace_application_feature", "normalized_result": trace()})
    net = RomNetwork(tmp_path / "decomp.db", tmp_path / "home")
    slug = net.import_analysis(app, tool="analyze_javascript_application", confirmed=True, log=lambda *_: None)
    return net, slug


def test_an_asar_is_opened_by_the_javascript_inspector_first(tmp_path, monkeypatch):
    asar = tmp_path / "app.asar"
    asar.write_bytes(b"asar")

    def open_analysis(target, provider=""):
        if target["tool"] == "open_binary":
            raise rea.ReaError("open_binary would make this an archive, not an application")
        return FakeClient(target), {"result": {"path": target["path"], "format": "javascript", "kind": "application"}}

    monkeypatch.setattr(rea, "open_analysis", open_analysis)
    net = RomNetwork(tmp_path / "decomp.db", tmp_path / "home")
    slug = net.import_analysis(asar, confirmed=True, log=lambda *_: None)
    assert net.project_row(slug) is not None
    assert net.analysis_cfg(slug)[1]["target"]["tool"] == "analyze_javascript_application"


def test_importing_a_folder_opens_it_as_a_javascript_application(tmp_path, monkeypatch):
    from decompnet.app.server import build

    app = tmp_path / "Unpacked app"
    (app / "src").mkdir(parents=True)
    (app / "package.json").write_text('{"name": "demo"}')
    (app / "src" / "main.js").write_text("console.log('update')")
    monkeypatch.setattr(rea, "open_analysis", lambda target, provider="": (
        FakeClient(target), {"result": {"path": target["path"], "format": "javascript", "kind": "application"}}))
    home = tmp_path / "home"
    (home / ".decomp").mkdir(parents=True)
    net = RomNetwork(home / ".decomp" / "decomp.db", home)
    mcp, _manager, security = build(net, home / ".decomp", 6495, "s3cret")
    http = TestClient(mcp.streamable_http_app(transport_security=security, host="127.0.0.1"),
                      base_url="http://127.0.0.1:6495")
    http.cookies.set("decomp_live", "s3cret")
    started = http.post(f"/api/import?confirmed=1&path={app}", headers={"X-Decomp": "1"}).json()
    for _ in range(100):
        job = http.get(f"/api/job?id={started['job']}").json()
        if job["state"] != "running":
            break
        time.sleep(0.05)
    assert job["state"] == "done", job
    state = http.get(f"/api/project?slug={job['result']['slug']}").json()
    assert state["kind"] == "analysis" and state["analysis"]["features_traceable"] is True


def test_feature_becomes_work_items_and_briefs(project):
    net, slug = project
    result = net.add_feature(slug, "route", "/api/update", name="Update flow")
    assert (result["name"], result["node_count"], result["edge_count"], result["item_count"]) == (
        "Update flow", 3, 2, 3)
    assert result["work_items"] == {"created": 3, "linked": 0, "grouped": 0}
    assert net.overview(slug)["functions"] == 4  # the survey task plus three feature nodes
    assert net.features(slug)["traceable"] is True
    assert net.features(slug)["features"][0]["item_count"] == 3

    agent = net.authenticate(net.register_agent("analyst"))
    brief = net.claim(agent, slug, "ipc:check-update")
    assert "feature Update flow" in brief and "reached from: src/main.js —imports→" in brief
    assert "Static reachability is not proof" in brief

    detail = net.feature(slug, "Update flow")
    handler = next(n for n in detail["nodes"] if n["name"] == "ipc:check-update")
    assert handler["status"] == "open" and handler["work_item"] == "ipc:check-update"
    assert handler["reached_by"] == "src/main.js —imports→"

    net.complete_analysis(agent, slug, "ipc:check-update", "registers the update channel and posts to the API")
    report = net.analysis_summary(slug)["markdown"]
    assert "## Features" in report and "### Update flow" in report
    assert "registers the update channel" in report

    removed = net.remove_feature(slug, "Update flow")
    assert removed == {"removed": "Update flow", "work_items": 2}  # the analyzed one stays as a finding
    assert net.features(slug)["features"] == []
    assert net.overview(slug)["functions"] == 2


def test_one_work_item_per_file_and_external_modules_are_not_work(project, monkeypatch):
    net, slug = project
    graph = trace()
    graph["graph"]["nodes"].append({
        "node_id": "jag_node_" + "4" * 64, "kind": "javascript-asset",
        "identity": {"strategy": "content-digest", "sha256": "d" * 64},
        "observations": [{"label": "src/main.js", "properties": {},
                           "evidence": {"state": "observed", "authority": "ast-static-analysis"}}]})
    graph["graph"]["nodes"].append({
        "node_id": "jag_node_" + "5" * 64, "kind": "javascript-module",
        "identity": {"strategy": "artifact-local-key", "artifact_sha256": "d" * 64,
                     "namespace": "unresolved-require", "key": "fs"},
        "observations": [{"label": "fs", "properties": {}, "evidence": {"state": "inferred"}}]})
    monkeypatch.setattr(rea, "trace_feature", lambda *a: {
        "operation": "trace_application_feature", "normalized_result": graph})

    result = net.add_feature(slug, "string", "update", name="Update flow")
    items = [n.get("work_item") for n in result["nodes"] if n.get("work_item")]
    assert items.count("src/main.js") == 2  # the module and the asset point at one work item
    assert result["work_items"] == {"created": 3, "linked": 0, "grouped": 1}
    assert "fs" not in {n["name"] for n in result["nodes"] if n.get("work_item")}


def test_feature_tracing_needs_a_javascript_target(tmp_path, monkeypatch):
    binary = tmp_path / "program.bin"
    binary.write_bytes(b"\x7fELF" + b"\0" * 64)
    monkeypatch.setattr(rea, "open_analysis", lambda target, provider="": (
        FakeClient(target), {"result": {"path": target["path"], "format": "elf", "kind": "executable"}}))
    net = RomNetwork(tmp_path / "decomp.db", tmp_path / "home")
    slug = net.import_analysis(binary, confirmed=True, log=lambda *_: None)
    with pytest.raises(NetworkError, match="JavaScript or Electron application project"):
        net.add_feature(slug, "module", "src/main.js")


def test_a_trace_that_reaches_nothing_is_not_a_feature(project, monkeypatch):
    net, slug = project
    empty = trace() | {"seed_matches": [], "graph": {"nodes": [], "edges": []},
                       "coverage": {"status": "no-match"}}
    monkeypatch.setattr(rea, "trace_feature", lambda *a: {"evidence_id": "ev_trace", "normalized_result": empty})
    with pytest.raises(NetworkError, match="traced route '/missing' to nothing"):
        net.add_feature(slug, "route", "/missing")
    assert net.features(slug)["features"] == []


def test_the_console_api_traces_lists_and_removes_a_feature(project, monkeypatch):
    from decompnet.app.server import build

    net, slug = project
    home = net.workspace
    (home / ".decomp").mkdir(parents=True, exist_ok=True)
    mcp, _manager, security = build(net, home / ".decomp", 6496, "s3cret")
    http = TestClient(mcp.streamable_http_app(transport_security=security, host="127.0.0.1"),
                      base_url="http://127.0.0.1:6496")
    http.cookies.set("decomp_live", "s3cret")
    headers = {"X-Decomp": "1"}

    started = http.post("/api/analysis/feature/add", headers=headers, json={
        "slug": slug, "kind": "route", "value": "/api/update", "name": "Update flow"}).json()
    for _ in range(100):
        job = http.get(f"/api/job?id={started['job']}").json()
        if job["state"] != "running":
            break
        time.sleep(0.05)
    assert job["state"] == "done", job
    assert job["result"]["node_count"] == 3

    listed = http.get(f"/api/analysis/features?slug={slug}").json()
    assert listed["traceable"] is True and listed["features"][0]["name"] == "Update flow"
    detail = http.get(f"/api/analysis/feature?slug={slug}&name=Update+flow").json()
    assert detail["edge_count"] == 2 and detail["nodes"][0]["work_item"]

    removed = http.post("/api/analysis/feature/remove", headers=headers,
                        json={"slug": slug, "name": "Update flow"}).json()
    assert removed["work_items"] == 3
