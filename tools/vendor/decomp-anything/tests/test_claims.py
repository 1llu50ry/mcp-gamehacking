"""Which function an agent gets next in a fork: what nobody gave up on, small first, and among functions of about
the same size the one in the file closest to done. A crowd of agents must not spend its time passing the hardest
leftovers around (Mario Party 6: 16 agents, one match, on 326 big functions released again and again)."""

import json

from decompnet.app.engine import RomNetwork


def test_fresh_small_functions_first_and_files_close_to_done_among_equals(tmp_path):
    net = RomNetwork(tmp_path / "app.db", tmp_path)
    with net.store.tx() as db:
        pid = db.execute("INSERT INTO projects(slug,name,description,arch,big_endian,root,config) VALUES(?,?,?,?,?,?,?)",
                         ("game", "Game", "", "ppc", 1, str(tmp_path), json.dumps({"kind": "rom"}))).lastrowid
        rows = [("leftover", "a", 12, 3), ("big_fresh", "b", 400, 0), ("small_in_big_file", "c", 20, 0),
                ("small_in_done_file", "d", 22, 0), ("tiny", "c", 4, 0)]
        rows += [(f"other_{i}", "c", 300, 0) for i in range(5)]  # file c has lots left; file d only one
        for name, unit, n, abandons in rows:
            db.execute("INSERT INTO functions(project_id,name,size,n_insns,status,unit,abandons) VALUES(?,?,?,?,?,?,?)",
                       (pid, name, n * 4, n, "open", unit, abandons))
    order = []
    for k in range(len(rows)):
        agent, _ = net.local_agent(f"a{k}")
        order.append(net.claim_row(agent, "game", None, "finish")["name"])
    # 4 and 22 instructions are about the same size: the file with one function left goes first
    assert order[:3] == ["small_in_done_file", "tiny", "small_in_big_file"], order
    assert order[-1] == "leftover" and order.index("big_fresh") < order.index("leftover"), order


def test_a_function_just_released_waits_before_the_next_agent_gets_it(tmp_path, monkeypatch):
    """Issue #19: a released function goes to the back of the queue for every agent for a while; it comes when
    nothing else is left, or at once when asked for by name. Near-misses come given up on least first."""
    from decompnet import network

    net = RomNetwork(tmp_path / "app.db", tmp_path)
    with net.store.tx() as db:
        pid = db.execute("INSERT INTO projects(slug,name,description,arch,big_endian,root,config) VALUES(?,?,?,?,?,?,?)",
                         ("game", "Game", "", "ppc", 1, str(tmp_path), json.dumps({"kind": "rom"}))).lastrowid
        # "small" has twins: one release alone doesn't move it down (twins come first until given up on twice)
        for name, n, score, abandons, boost in [("small", 4, None, 0, 3), ("next", 8, None, 0, 0),
                                                ("stuck", 50, 4, 3, 0), ("near", 50, 30, 1, 0)]:
            db.execute("INSERT INTO functions(project_id,name,size,n_insns,status,unit,best_score,abandons,boost) "
                       "VALUES(?,?,?,?,?,?,?,?,?)", (pid, name, n * 4, n, "open", "a", score, abandons, boost))
    a, _ = net.local_agent("a")
    b, _ = net.local_agent("b")
    assert net.claim_row(a, "game", None, "easiest")["name"] == "small"
    net.release(a, "small", "", "game")
    assert net.claim_row(b, "game", None, "easiest")["name"] == "next"  # not the one a just gave up on
    net.release(b, "next", "", "game")
    c, _ = net.local_agent("c")
    assert net.claim_row(c, "game", None, "closest")["name"] == "near"  # given up on once beats three times
    d, _ = net.local_agent("d")
    assert net.claim_row(d, "game", None, "easiest")["name"] == "stuck"  # what wasn't just released
    e, _ = net.local_agent("e")
    assert net.claim_row(e, "game", None, "easiest")["name"] == "small"  # nothing else: the cooling one after all
    f, _ = net.local_agent("f")
    assert net.claim_row(f, "game", "next")["name"] == "next"  # by name: at once
    monkeypatch.setattr(network, "RELEASE_COOLDOWN", 0)
    for g in (e, f):
        net.release(g, net.store.one("SELECT f.name FROM claims c JOIN functions f ON f.id=c.function_id "
                                     "WHERE c.agent_id=?", g.id)["name"], "", "game")
    h, _ = net.local_agent("h")
    assert net.claim_row(h, "game", None, "easiest")["name"] == "small"  # the wait is over: the usual order
