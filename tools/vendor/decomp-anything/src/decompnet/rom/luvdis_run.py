"""Runs luvdis (in its own environment: `python luvdis_run.py disasm ...`) with a fix to its emulation of the stack.

luvdis models the stack as a list indexed by the number of words pushed. Code that pops more than it pushed (a
function entered past its own push, or a guess that isn't a function) takes that index below zero, and the next push
then writes outside the list: "IndexError: list assignment index out of range" ended the whole disassembly of
Spyro: Attack of the Rhynocs. A push there now stores nothing, as a load from there already reads "unknown".

Standard library only: this runs in luvdis's environment, not decomp.wtf's.
"""

import importlib.util
import sys

PUSH = """                        if self.sp >= len(self.stack):
                            self.stack.append(value)
                        else:
                            self.stack[self.sp] = value
"""
SAFE_PUSH = """                        if self.sp >= len(self.stack):
                            self.stack.append(value)
                        elif self.sp >= 0:
                            self.stack[self.sp] = value
"""


def main() -> int:
    spec = importlib.util.find_spec("luvdis.analyze")
    with open(spec.origin, encoding="utf-8") as f:
        source = f.read()
    module = importlib.util.module_from_spec(spec)
    sys.modules["luvdis.analyze"] = module
    exec(compile(source.replace(PUSH, SAFE_PUSH, 1), spec.origin, "exec"), module.__dict__)
    from luvdis.__main__ import main as luvdis

    return luvdis(prog_name="luvdis")


if __name__ == "__main__":
    sys.exit(main())
