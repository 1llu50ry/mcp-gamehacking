# Demo Quest 64 decomp (test project)

A tiny matching-decompilation project in the shape community projects use, for decomp.wtf's fork mode and its tests.
It decompiles Demo Quest 64, the CC0 demo ROM that ships with decomp.wtf.

1. Put the ROM at `baserom.z64`.
2. `python configure.py` checks it, extracts the target objects into `build/expected/` and writes `build.ninja` and
   `objdiff.json`.
3. `ninja` builds `src/` into `build/src/`; `objdiff-cli report generate` measures progress.

Some functions in `src/game.c` are matched, one is wrong and the rest are still to do.
(Unlike a real project, the targets are "extracted" by building the reference source in `tools/reference/`.)
