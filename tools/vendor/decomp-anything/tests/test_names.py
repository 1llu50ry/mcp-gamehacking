"""Agents call functions by the names they read: in assembly, in a source file, in another tool's output. A fork
stores a name that repeats across its files as symbol@unit; every tool must still find the function the agent
means, or ask which one when it can't tell."""

import json

import pytest

from decompnet.app import tools
from decompnet.app.engine import RomNetwork
from decompnet.network import NetworkError


@pytest.fixture
def net(tmp_path):
    net = RomNetwork(tmp_path / "app.db", tmp_path)
    with net.store.tx() as db:
        pid = db.execute("INSERT INTO projects(slug,name,description,arch,big_endian,root,config) VALUES(?,?,?,?,?,?,?)",
                         ("game", "Game", "", "ppc", 1, str(tmp_path), json.dumps({"kind": "rom"}))).lastrowid
        for name, unit, status, meta in [
                ("fn_1_16F0@mdsingdll/REL/mdsingdll/mdsing", "mdsingdll/REL/mdsingdll/mdsing", "open", {"symbol": "fn_1_16F0"}),
                ("fn_1_16F0@m656DLL/REL/m656DLL/matrix", "m656DLL/REL/m656DLL/matrix", "open", {"symbol": "fn_1_16F0"}),
                ("fn_1_16F0@m615DLL/auto_00_text", "m615DLL/auto_00_text", "nosource", {"symbol": "fn_1_16F0"}),
                ("fn_1_8CE4@m605DLL/auto_text", "m605DLL/auto_text", "nosource", {"symbol": "fn_1_8CE4"}),
                ("fn_1_8CE4@mdsingdll/REL/mdsingdll/mdsing", "mdsingdll/REL/mdsingdll/mdsing", "open", {"symbol": "fn_1_8CE4"}),
                ("fn_1_17958", "mdsingdll/REL/mdsingdll/mdsing", "open", {"symbol": "fn_1_17958"}),
                ("Update__6PlayerFv", "game/player", "open", {"symbol": "Update__6PlayerFv",
                                                              "demangled": "Player::Update(void)"})]:
            db.execute("INSERT INTO functions(project_id,name,size,n_insns,status,unit,meta) VALUES(?,?,?,?,?,?,?)",
                       (pid, name, 40, 10, status, unit, json.dumps(meta)))
    return net


def test_names_as_agents_write_them(net):
    def find(n):
        return net._function(n, "game")["name"]
    assert find("fn_1_17958@mdsingdll/REL/mdsingdll/mdsing") == "fn_1_17958"  # @unit on a name that doesn't repeat
    assert find("fn_1_8CE4") == "fn_1_8CE4@mdsingdll/REL/mdsingdll/mdsing"  # the other one has no source file
    assert find("fn_1_16F0@mdsing") == "fn_1_16F0@mdsingdll/REL/mdsingdll/mdsing"
    assert find("`fn_1_17958()`") == "fn_1_17958"
    assert find("Player::Update") == "Update__6PlayerFv"
    with pytest.raises(NetworkError) as e:
        find("fn_1_16F0")
    assert "fn_1_16F0@mdsingdll/REL/mdsingdll/mdsing" in str(e.value) and "matrix" in str(e.value)
    with pytest.raises(NetworkError):
        find("fn_1_99999")


def test_a_plain_name_means_the_function_the_agent_works_on(net):
    agent, _ = net.local_agent("agent-1")
    full = "fn_1_16F0@mdsingdll/REL/mdsingdll/mdsing"
    assert net.claim_row(agent, "game", full)["name"] == full
    # claiming it again by its full name (units have slashes) renews the claim instead of refusing
    assert net.claim_row(agent, "game", full)["name"] == full
    assert tools._named(net, agent, "game", {"function": "fn_1_16F0"})["function"] == full
    assert net.resolve_function(agent, "game", "fn_1_8CE4") == "fn_1_8CE4@mdsingdll/REL/mdsingdll/mdsing"
    other, _ = net.local_agent("agent-2")
    with pytest.raises(NetworkError):
        net.resolve_function(other, "game", "fn_1_16F0")
