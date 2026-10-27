"""End to end over real HTTP: the same path Claude Code takes after `claude mcp add --transport http ...`."""

import socket
import threading
import time

import anyio
import httpx2
import pytest
import uvicorn
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from decompnet.network import Network
from decompnet.project import import_project
from decompnet.registration import Registrar
from decompnet.server import build_server

from .solutions import SOLUTIONS
from .test_network import DEMO, HOST_GCC, needs_host_gcc


@pytest.fixture
def server(tmp_path):
    if not HOST_GCC:
        pytest.skip(needs_host_gcc.kwargs["reason"])
    net = Network(tmp_path / "http.db")
    import_project(net.store, DEMO, log=lambda *_: None)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    registrar = Registrar(net, secret="test-secret", hostnames={"localhost"},
                          verify=lambda token, ip: {"success": token == "ok", "action": "signup", "hostname": "localhost"})
    app = build_server(net, public_url=url, open_registration=True, registrar=registrar).streamable_http_app(host="127.0.0.1")
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    while not srv.started:
        time.sleep(0.02)
    yield url, net
    srv.should_exit = True
    t.join(timeout=5)


def text(result) -> str:
    return "".join(c.text for c in result.content if getattr(c, "text", None))


async def call(url, token, tool, args):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    async with httpx2.AsyncClient(headers=headers, timeout=30) as http, \
            Client(streamable_http_client(f"{url}/mcp", http_client=http)) as client:
        return await client.call_tool(tool, args)


def test_agent_session_over_http(server):
    url, _net = server
    bad = httpx2.post(f"{url}/api/register", json={"name": "x", "accept_terms": True, "age_ok": True, "turnstile": "nope"})
    assert bad.status_code == 400 and "bot check" in bad.json()["error"]
    reg = httpx2.post(f"{url}/api/register", json={"name": "http-agent", "owner": "tester", "accept_terms": True,
                                                   "age_ok": True, "turnstile": "ok"}).json()
    token = reg["token"]
    assert "claude mcp add --scope user --transport http decomp " in reg["claude_code"] and reg["level"] == "new"

    async def session():
        async with httpx2.AsyncClient(headers={"Authorization": f"Bearer {token}"}, timeout=30) as http, \
                Client(streamable_http_client(f"{url}/mcp", http_client=http)) as client:
            tools = {t.name for t in (await client.list_tools()).tools}
            assert {"claim_function", "compile_and_diff", "edit_context", "rename_symbol"} <= tools
            prompts = {p.name for p in (await client.list_prompts()).prompts}
            assert "work" in prompts

            assert "demo" in text(await client.call_tool("list_projects", {}))
            claimed = text(await client.call_tool("claim_function", {}))
            assert "CLAIMED: demo/abs_s32" in claimed
            assert "Entity" in text(await client.call_tool("get_context", {}))
            res = await client.call_tool("compile_and_diff",
                                         {"function": "abs_s32", "source": SOLUTIONS["abs_s32"]})
            assert "MATCH" in text(res), text(res)
            assert "http-agent" in text(await client.call_tool("network_status", {}))

    anyio.run(session)
    status = httpx2.get(f"{url}/api/status").json()
    assert status["projects"][0]["matched"] == 1 and status["registration_open"] is True
    page = httpx2.get(f"{url}/api/function", params={"project": "demo", "name": "abs_s32"}).json()
    assert page["function"]["status"] == "matched" and page["function"]["matched_by"] == "http-agent"
    assert page["history"][-1]["score"] == 0
    home = httpx2.get(f"{url}/")
    assert home.status_code == 302 and home.headers["location"] == f"{url}/"
    me = httpx2.get(f"{url}/api/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me == {"agent": "http-agent", "level": "member", "matches": 1}
    assert httpx2.get(f"{url}/api/me", headers={"Authorization": "Bearer dn_bad"}).status_code == 401
    assert reg["install"].endswith(f"/network.sh | bash -s -- {token}")


def test_tools_require_a_valid_token(server):
    url, _ = server
    res = anyio.run(call, url, "dn_bogus", "claim_function", {})
    assert res.is_error and "invalid API token" in text(res)
    res = anyio.run(call, url, None, "list_projects", {})
    assert res.is_error and "missing API token" in text(res)
