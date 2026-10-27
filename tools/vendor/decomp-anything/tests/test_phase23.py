"""Phase 2/3 features: reputation, open registration, hash-only projects, per-unit headers, function pages,
donated compute and upstream export."""

import json
import shutil
import subprocess

import pytest

from decompnet import jobs, policy, public, toolchains
from decompnet.network import Network, NetworkError
from decompnet.project import import_project
from decompnet.registration import Registrar
from decompnet.upstream import export as upstream_export

from .solutions import SOLUTIONS, WRONG_CLAMP
from .test_network import DEMO, HOST_GCC, needs_host_gcc

PROJECTS = DEMO.parent


@pytest.fixture
def net(tmp_path):
    if not HOST_GCC:
        pytest.skip(needs_host_gcc.kwargs["reason"])
    n = Network(tmp_path / "t.db")
    import_project(n.store, DEMO, log=lambda *_: None)
    return n


def web_agent(net, name="newbie"):
    reg = Registrar(net, secret="s", hostnames={"decomp.online"},
                    verify=lambda t, ip: {"success": True, "action": "signup", "hostname": "decomp.online"})
    out = reg.register({"name": name, "accept_terms": True, "age_ok": True, "turnstile": "tok"}, "203.0.113.7")
    return net.authenticate(out["token"]), reg


def test_registration_guards(net):
    closed = Registrar(net, secret="", hostnames=set())
    with pytest.raises(NetworkError, match="closed"):
        closed.register({"name": "a", "accept_terms": True, "age_ok": True, "turnstile": "t"}, None)
    agent, reg = web_agent(net)
    assert not agent.trusted
    row = net.store.one("SELECT origin, terms_accepted_at FROM agents WHERE id=?", agent.id)
    assert row["origin"] == "web" and row["terms_accepted_at"]
    for payload, why in [({"accept_terms": False, "age_ok": True}, "terms"), ({"accept_terms": True, "age_ok": False}, "13")]:
        with pytest.raises(NetworkError, match=why):
            reg.register({"name": "b", "turnstile": "t", **payload}, "203.0.113.7")
    wrong_host = Registrar(net, secret="s", hostnames={"decomp.online"},
                           verify=lambda t, ip: {"success": True, "action": "signup", "hostname": "evil.example"})
    with pytest.raises(NetworkError, match="bot check"):
        wrong_host.register({"name": "c", "accept_terms": True, "age_ok": True, "turnstile": "t"}, None)
    for i in range(2):  # 3 per IP per day
        reg.register({"name": f"more{i}", "accept_terms": True, "age_ok": True, "turnstile": "t"}, "203.0.113.7")
    with pytest.raises(NetworkError, match="too many"):
        reg.register({"name": "toomany", "accept_terms": True, "age_ok": True, "turnstile": "t"}, "203.0.113.7")
    assert net.store.one("SELECT COUNT(*) AS n FROM registrations")["n"] == 3
    assert "203.0.113.7" not in json.dumps([dict(r) for r in net.store.all("SELECT * FROM registrations")])


def test_reputation_gates_header_edits_and_budget(net, monkeypatch):
    agent, _ = web_agent(net)
    assert policy.reputation(net.store, agent.id)["level"].name == "new"
    with pytest.raises(NetworkError, match="member"):
        net.edit_context(agent, "demo", "", "s32 x;", "add")
    assert "MATCH" in net.compile_and_diff(agent, "abs_s32", SOLUTIONS["abs_s32"])
    assert policy.reputation(net.store, agent.id)["level"].name == "member"
    assert "now v2" in net.edit_context(agent, "demo", "", "s32 entity_default_hp(s16 type);", "add proto")
    monkeypatch.setattr(policy, "LEVELS", (policy.Level("new", 0, 0, False), policy.Level("member", 1, 1, True)))
    with pytest.raises(NetworkError, match="compile budget"):
        net.compile_and_diff(agent, "clamp_s32", WRONG_CLAMP)


@needs_host_gcc
def test_hash_only_project_stores_no_code(tmp_path):
    proj = tmp_path / "hashdemo"
    shutil.copytree(DEMO, proj)
    toml = (proj / "project.toml").read_text().replace('slug = "demo"', 'slug = "hashdemo"')
    (proj / "project.toml").write_text(toml.replace("[target]", '[target]\nverification = "hash"'))
    net = Network(tmp_path / "h.db")
    import_project(net.store, proj, log=lambda *_: None)
    rows = net.store.all("SELECT target, asm, seed, fingerprint FROM functions")
    assert all(r["target"] is None and not r["asm"] and r["seed"] is None and len(r["fingerprint"]) == 64 for r in rows)
    agent = net.authenticate(net.register_agent("h"))
    assert "hash-only" in net.claim(agent, function="clamp_s32")
    assert "No match" in net.compile_and_diff(agent, "clamp_s32", WRONG_CLAMP)
    assert "MATCH" in net.compile_and_diff(agent, "clamp_s32", SOLUTIONS["clamp_s32"])
    page = public.function_page(net, "hashdemo", "clamp_s32")
    assert page["function"]["asm"] is None and page["project"]["hash_only"]
    assert jobs.next_job(net, agent) is None  # never handed to donated compute


def test_function_page_has_full_history(net):
    a = net.authenticate(net.register_agent("alice"))
    net.compile_and_diff(a, "clamp_s32", WRONG_CLAMP)
    net.add_note(a, "demo", "check lo first", "clamp_s32")
    net.compile_and_diff(a, "clamp_s32", SOLUTIONS["clamp_s32"])
    page = public.function_page(net, "demo", "clamp_s32")
    assert [h["score"] for h in page["history"]][-1] == 0 and len(page["history"]) == 2
    assert page["function"]["matched_by"] == "alice" and "return lo" in page["function"]["matched_source"]
    assert page["notes"][0]["text"] == "check lo first" and page["project"]["legal"]["basis"] == "own-code"


needs_n64 = pytest.mark.skipif(toolchains.installed("gcc-2.7.2-kmc") is None, reason="gcc-2.7.2-kmc not installed")


@needs_n64
def test_donated_compute_round_trip(tmp_path):
    net = Network(tmp_path / "j.db")
    import_project(net.store, PROJECTS / "demo-n64", log=lambda *_: None)
    a = net.authenticate(net.register_agent("a"))
    net.compile_and_diff(a, "clamp_s32", WRONG_CLAMP, project="demo-n64")
    net.release(a, "clamp_s32", "", project="demo-n64")
    worker = net.authenticate(net.register_agent("worker"))
    job = jobs.next_job(net, worker)
    assert job["function"] == "clamp_s32" and job["toolchain"] == "gcc-2.7.2-kmc" and job["target"]["code"]
    from decompnet.permuter import LocalScorer
    assert LocalScorer(job, log=lambda *_: None).score(SOLUTIONS["clamp_s32"]) == 0  # same verdict locally
    out = jobs.submit(net, worker, "demo-n64", "clamp_s32", SOLUTIONS["clamp_s32"])
    assert out["matched"] and net.store.one("SELECT status FROM functions WHERE name='clamp_s32'")["status"] == "matched"


zlib_ready = (PROJECTS / "zlib-n64" / "original" / "zlib.h").exists()


@needs_n64
@pytest.mark.skipif(not zlib_ready, reason="run projects/zlib-n64/prepare.py first")
def test_zlib_uses_per_unit_headers(tmp_path):
    net = Network(tmp_path / "z.db")
    import_project(net.store, PROJECTS / "zlib-n64", log=lambda *_: None)
    assert net.store.one("SELECT COUNT(*) AS n FROM functions")["n"] == 71
    assert net._unit_contexts(net._project("zlib-n64")["id"]) >= {"deflate", "inflate", "trees"}
    with pytest.raises(NetworkError, match="pass `function`"):
        net.get_context("zlib-n64")
    assert "deflate_state" in net.get_context("zlib-n64", "fill_window")
    agent = net.authenticate(net.register_agent("z"))
    src = (PROJECTS / "zlib-n64" / "original" / "adler32.c").read_text()
    body = src[src.index("uLong ZEXPORT adler32("):]
    assert "MATCH" in net.compile_and_diff(agent, "adler32", body[: body.index("\n}\n") + 3], project="zlib-n64")


def test_upstream_export_commits_with_credit(net, tmp_path):
    a = net.authenticate(net.register_agent("alice", "Alice"))
    net.compile_and_diff(a, "abs_s32", SOLUTIONS["abs_s32"])
    repo = tmp_path / "up"
    assert upstream_export(net, "demo", repo, log=lambda *_: None) == 1
    assert upstream_export(net, "demo", repo, log=lambda *_: None) == 0  # idempotent
    log = subprocess.run(["git", "-C", str(repo), "log", "--format=%an|%s|%b"], capture_output=True, text=True).stdout
    assert "alice|Match abs_s32" in log and "operator: Alice" in log
    assert "reconstruction, not the original source" in (repo / "src" / "game" / "abs_s32.c").read_text()
