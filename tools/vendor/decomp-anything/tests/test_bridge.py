"""`decomp mcp`: the agent the user talks to, connected over stdio. It starts the app when it isn't running, gets
its own identity, and can import the user's game (only after they confirm it's their own copy), follow progress
and work on functions, with everything visible in the app."""

import asyncio
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ROM = ROOT / "projects" / "demo-rom" / "build" / "demo-quest-64.z64"

pytestmark = pytest.mark.skipif(not ROM.exists(), reason="needs the demo ROM (projects/demo-rom)")


def test_bridge_imports_and_works(tmp_path):
    from mcp import Client, StdioServerParameters

    env = {**os.environ, "DECOMP_HOME": str(tmp_path), "DECOMP_AGENT_NAME": "test-chat", "BROWSER": "true"}

    async def run() -> dict:
        params = StdioServerParameters(command=sys.executable, args=["-m", "decompnet.app.cli", "mcp"], env=env)
        out = {}
        async with Client(params, read_timeout_seconds=300) as c:
            out["instructions"] = c.instructions or ""
            out["tools"] = {t.name for t in (await c.list_tools()).tools}

            async def call(name, **args):
                r = await c.call_tool(name, args)
                return r.is_error, "\n".join(getattr(x, "text", "") for x in r.content)

            out["refused"] = await call("import_game", path=str(ROM))
            out["imported"] = await call("import_game", path=str(ROM), own_copy=True)
            out["projects"] = await call("list_projects")
            out["claim"] = await call("claim_function", function="func_800007F4")
            out["compile"] = await call("compile_and_diff", function="func_800007F4",
                                        source="s32 func_800007F4(s32 v) { return v < 0 ? -v : v; }")
            out["progress"] = await call("progress")

        # a helper session decomp.wtf started, whose agent only loads the user's own MCP servers (Antigravity CLI):
        # the same bridge works as the session's agent, with a helper's tools and no new identity
        from decompnet.app.engine import RomNetwork

        net = RomNetwork(tmp_path / ".decomp" / "decomp.db", tmp_path)
        _, token = net.local_agent("antigravity-1")
        before = net.store.one("SELECT COUNT(*) AS n FROM agents")["n"]
        helper = StdioServerParameters(command=sys.executable, args=["-m", "decompnet.app.cli", "mcp"],
                                       env={**env, "DECOMP_AGENT_NAME": "antigravity", "DECOMP_SESSION_TOKEN": token})
        async with Client(helper, read_timeout_seconds=300) as c:
            out["helper_instructions"] = c.instructions or ""
            out["helper_tools"] = {t.name for t in (await c.list_tools()).tools}
            r = await c.call_tool("claim_function", {})
            out["helper_claim"] = r.is_error, "\n".join(getattr(x, "text", "") for x in r.content)
        out["agents_added"] = net.store.one("SELECT COUNT(*) AS n FROM agents")["n"] - before
        out["helper_holds"] = net.store.one("SELECT COUNT(*) AS n FROM claims c JOIN agents a ON a.id=c.agent_id "
                                            "WHERE a.name='antigravity-1'")["n"]
        return out

    try:
        out = asyncio.run(run())
    finally:
        subprocess.run([sys.executable, "-m", "decompnet.app.cli", "stop"], env=env, capture_output=True)
    assert "import_game" in out["instructions"] and {"import_game", "open_gui", "start_agents", "claim_function"} <= out["tools"]
    assert out["refused"][0] and "own legally obtained copy" in out["refused"][1]
    assert not out["imported"][0] and "Imported as demo-quest-64" in out["imported"][1]
    assert "demo-quest-64" in out["projects"][1]
    compiled = out["compile"][1]
    assert "MATCH" in compiled or "already matched" in compiled  # the autopilot may have been first
    assert "functions" in out["progress"][1]
    assert "claim_function" in out["helper_tools"] and not {"import_game", "start_agents", "open_gui"} & out["helper_tools"]
    assert "import_game" not in out["helper_instructions"]  # the helper's instructions, not the chat agent's
    assert not out["helper_claim"][0] and out["helper_holds"] == 1 and out["agents_added"] == 0
