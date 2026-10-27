"""Runtime coverage files: addresses/names with optional hit counts."""

from decompnet import tracefile


def test_text_addresses_and_counts():
    t = tracefile.parse("0x401000\n401010 5\n0x401020, 7\n# comment\n")
    assert [(h.address, h.count) for h in t.hits] == [(0x401000, 1), (0x401010, 5), (0x401020, 7)]


def test_csv_header_and_bare_rows():
    t = tracefile.parse("address,count\n0x401000,3\n0x401010,9\n")
    assert [(h.address, h.count) for h in t.hits] == [(0x401000, 3), (0x401010, 9)]
    bare = tracefile.parse("0x401000,2\n0x401010,4\n", "bare.csv")
    assert [(h.address, h.count) for h in bare.hits] == [(0x401000, 2), (0x401010, 4)]


def test_json_shapes_and_function_names():
    assert tracefile.parse('[{"pc": "0x401000", "hits": 4}, {"function": "player_update", "count": 2}]').hits[0].count == 4
    assert tracefile.parse('{"add": 9, "0x401000": 2}').hits[0].name == "add"
    assert tracefile.parse('["0x401000", "0x401010"]').hits[1].address == 0x401010


def test_unrelated_lines_are_skipped():
    t = tracefile.parse("not a trace\nrandom prose here\n0x401000 1\n")
    assert len(t.hits) == 1 and t.skipped >= 1
