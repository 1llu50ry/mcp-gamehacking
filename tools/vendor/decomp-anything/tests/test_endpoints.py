"""Issue #13: several saved API endpoints (one per inference machine), each with its own address, model, key,
context size and limit of sessions at once; sessions spread across the ones picked; a key only goes to its own
endpoint."""

import json
from types import SimpleNamespace

import pytest

from decompnet.app import agents
from decompnet.app.server import Settings, _session_options, _spread


def test_the_one_saved_api_becomes_the_first_endpoint(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"api": {"provider": "deepseek", "model": "deepseek-chat",
                                        "base_url": "https://api.deepseek.com/v1", "api_key": "sk-secret1234"}}))
    s = Settings(path)
    (e,) = s.endpoints()
    assert e["id"] == "e1" and e["name"] == "DeepSeek" and e["api_key"] == "sk-secret1234"
    pub = s.public()
    assert "sk-secret" not in json.dumps(pub) and pub["endpoints"][0]["has_key"] and pub["api"]["model"] == "deepseek-chat"
    assert Settings(tmp_path / "none.json").endpoints() == []


def test_endpoints_are_added_changed_and_removed(tmp_path):
    s = Settings(tmp_path / "settings.json")
    a = s.save_endpoint({"provider": "llamacpp", "base_url": "http://192.168.1.20:8080/v1", "model": "qwen",
                         "context_tokens": "32768", "max_sessions": "1"})
    b = s.save_endpoint({"provider": "custom", "base_url": "http://gpu-box:8000/v1", "model": "glm", "api_key": "tok-b"})
    assert (a["id"], a["name"], a["context_tokens"], a["max_sessions"]) == ("e1", "192.168.1.20:8080", 32768, 1)
    assert (b["id"], b["name"], b["api_key"]) == ("e2", "gpu-box:8000", "tok-b")
    s.save_endpoint({"id": "e2", "name": "Big box", "api_key": "••••••••ok-b"})  # the masked key comes back unchanged
    assert s.endpoint("e2")["name"] == "Big box" and s.endpoint("e2")["api_key"] == "tok-b"
    s.save_endpoint({"id": "e2", "clear_key": True})
    assert "api_key" not in s.endpoint("e2")
    with pytest.raises(ValueError):
        s.save_endpoint({"id": "e1", "context_tokens": "lots"})
    with pytest.raises(ValueError):  # a new one that doesn't validate isn't half made
        s.save_endpoint({"model": "x", "max_sessions": "two"})
    assert len(s.endpoints()) == 2
    s.remove_endpoint("e1")
    assert [e["id"] for e in s.endpoints()] == ["e2"]
    assert s.save_endpoint({"model": "m"})["id"] == "e3"  # never reused: a resumed session can't change machines


def fake_manager(*running: tuple[str, str]):
    sessions = {f"api-{i}": SimpleNamespace(kind="api", options={"endpoint": eid}, state=state, stop=SimpleNamespace(is_set=lambda: False))
                for i, (eid, state) in enumerate(running)}
    return SimpleNamespace(sessions=sessions)


def test_sessions_spread_across_the_endpoints_within_their_limits(tmp_path):
    s = Settings(tmp_path / "settings.json")
    s.save_endpoint({"provider": "custom", "name": "small", "base_url": "http://10.0.0.2:8080/v1", "model": "a", "max_sessions": 1})
    s.save_endpoint({"provider": "custom", "name": "big", "base_url": "http://10.0.0.3:8080/v1", "model": "b", "api_key": "kb"})
    plan = _spread(s, fake_manager(), ["e1", "e2"], 4, {})
    assert [(e["name"], n) for e, n in plan] == [("small", 1), ("big", 3)]
    plan = _spread(s, fake_manager(("e1", "working")), ["e1", "e2"], 2, {})  # small is busy already
    assert [(e["name"], n) for e, n in plan] == [("big", 2)]
    with pytest.raises(ValueError, match="already runs"):
        _spread(s, fake_manager(("e1", "working")), ["e1"], 1, {})
    with pytest.raises(ValueError, match="isn't saved"):
        _spread(s, fake_manager(), ["e9"], 1, {})
    opts = _session_options(plan[0][0])
    assert opts["endpoint"] == "e2" and opts["api_key"] == "kb" and opts["provider_name"] == "big"


def test_a_saved_key_never_goes_to_an_address_typed_in(tmp_path):
    s = Settings(tmp_path / "settings.json")
    s.save_endpoint({"provider": "deepseek", "api_key": "sk-deepseek"})
    ((entry, n),) = _spread(s, fake_manager(), [], 2, {})
    assert n == 2 and entry["api_key"] == "sk-deepseek"  # an older GUI's start: the first endpoint, as saved
    ((entry, _),) = _spread(s, fake_manager(), [], 1, {"provider": "custom", "base_url": "http://elsewhere.example/v1"})
    assert entry["base_url"] == "http://elsewhere.example/v1" and "api_key" not in entry
    with pytest.raises(ValueError, match="add an API endpoint"):
        _spread(Settings(tmp_path / "empty.json"), fake_manager(), [], 1, {"provider": "custom"})


def test_sessions_are_numbered_per_endpoint(tmp_path, monkeypatch):
    monkeypatch.setattr(agents.Manager, "_run", lambda self, s: None)
    monkeypatch.setattr(agents.Manager, "_prepare", lambda self, slug: None)
    m = agents.Manager(SimpleNamespace(), tmp_path, "http://127.0.0.1:1/mcp")
    m.start("api", "p", 2, {"provider_name": "gpu-box", "endpoint": "e1"})
    m.start("api", "p", 1, {"provider_name": "laptop", "endpoint": "e2"})
    m.start("api", "p", 1, {"provider_name": "gpu-box", "endpoint": "e1"})
    assert sorted(s.label for s in m.sessions.values()) == ["gpu-box #1", "gpu-box #2", "gpu-box #3", "laptop #1"]
    assert all("api_key" not in r["options"] for r in m.running())


@pytest.mark.parametrize("base, local", [
    ("http://127.0.0.1:8080/v1", True), ("http://192.168.1.4:11434/v1", True), ("http://10.1.2.3/v1", True),
    ("http://172.20.0.5:8000/v1", True), ("http://100.101.102.103:8080/v1", True), ("http://[fd00::12]:8080/v1", True),
    ("http://gpu-box:8080/v1", True), ("http://inference.lan/v1", True), ("http://host.docker.internal:1234/v1", True),
    ("http://localhost:1234/v1", True), ("https://api.deepseek.com/v1", False), ("http://172.32.0.1/v1", False),
    ("https://8.8.8.8/v1", False)])
def test_local_servers_are_recognised_by_address_or_name(base, local):
    assert agents.is_local(base, resolve=False) is local
