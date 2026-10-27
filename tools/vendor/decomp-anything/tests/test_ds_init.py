"""ds-decomp's analysis of a DS game (`dsd init`), as the import runs it."""

import pytest

from decompnet.forks import scratch_dsd
from decompnet.forks.project import ForkError


def test_a_call_to_code_dsd_found_no_function_for_is_analysed_again(tmp_path, monkeypatch):
    """Sonic & SEGA All-Stars Racing calls 0x0206135C, which dsd's analysis didn't take for a function ("Local
    function call ... leads to no function"): the analysis runs again with dsd's option for such calls."""
    runs = []

    def run(cmd, cwd, what):
        runs.append(cmd)
        if "--allow-unknown-function-calls" not in cmd:
            raise ForkError("analysing the game failed:\n[ERROR] Local function call from 0x0204f346 in ARM9 main to "
                            "0x0206135c leads to no function")
    monkeypatch.setattr(scratch_dsd, "_run", run)
    (tmp_path / "config" / "cs3e").mkdir(parents=True)  # what the failed run left
    said = []
    scratch_dsd._init("dsd", tmp_path, "cs3e", said.append)
    assert len(runs) == 2 and runs[1] == [*runs[0], "--allow-unknown-function-calls"]
    assert not (tmp_path / "config" / "cs3e").exists() and "ds-decomp didn't find" in said[0]

    monkeypatch.setattr(scratch_dsd, "_run", lambda *a: (_ for _ in ()).throw(ForkError("analysing the game failed: other")))
    with pytest.raises(ForkError, match="other"):  # anything else still stops the import
        scratch_dsd._init("dsd", tmp_path, "cs3e", said.append)
