"""Keep heavy tools from taking the user's computer down.

decomp.wtf runs other people's tools on big inputs: project builds, decomp-toolkit's analysis, Ghidra. A runaway
one can eat all memory and swap until the system's out-of-memory killer takes the whole desktop session with it.
On Linux each heavy command runs in its own systemd scope with a memory cap and no swap, so only that command
is stopped.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from functools import lru_cache


def _total_memory() -> int:
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (ValueError, OSError, AttributeError):
        return 8 << 30


def default_cap() -> int:
    """Half the machine's memory, between 2 and 8 GB."""
    return max(2 << 30, min(8 << 30, _total_memory() // 2))


@lru_cache(maxsize=1)
def _systemd_run() -> str | None:
    exe = shutil.which("systemd-run")
    if not exe or not os.environ.get("XDG_RUNTIME_DIR"):
        return None
    try:  # the user manager has to be reachable (not the case in some containers or SSH sessions)
        ok = subprocess.run([exe, "--user", "--scope", "--quiet", "-p", "MemoryMax=64M", "--", "true"],
                            capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        ok = False
    return exe if ok else None


def capped(argv: list[str], memory: int | None = None) -> list[str]:
    """`argv`, wrapped so it's stopped when it uses more than `memory` bytes (default: default_cap())."""
    exe = _systemd_run()
    if exe is None:
        return list(argv)
    mb = (memory or default_cap()) >> 20
    return [exe, "--user", "--scope", "--quiet", "-p", f"MemoryMax={mb}M", "-p", "MemorySwapMax=0", "--", *argv]


def killed_for_memory(returncode: int) -> bool:
    return returncode in (137, -9)
