"""Find functions that look alike: same instructions in a similar order.

The idea behind coddog, which decomp communities use to spot copy-pasted code, shared inlined helpers and
template instantiations. A matched look-alike is the best starting point there is: its C often needs only
small changes. Comparison is on mnemonic sequences (operands differ between copies), pre-filtered by length
and instruction mix so that ranking a whole game stays fast.
"""

from __future__ import annotations

import math
from collections import Counter
from difflib import SequenceMatcher

MAX_OPS = 800  # compare at most this many instructions of very large functions


def mips_mnemonics(code: bytes, big_endian: bool = True, vram: int = 0) -> list[str]:
    import rabbitizer

    order = "big" if big_endian else "little"
    out = []
    for i in range(0, len(code) - 3, 4):
        word = int.from_bytes(code[i:i + 4], order)
        out.append(rabbitizer.Instruction(word, vram + i).getOpcodeName())
    return out


def thumb_mnemonics(code: bytes, vram: int = 0) -> list[str]:
    import capstone

    md = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)
    md.skipdata = True
    return [ins.mnemonic for ins in md.disasm(code, vram)]


def mnemonics(lines: list[str]) -> list[str]:
    """Mnemonics from formatted instructions ("lwz r3, 0x10(r31)" -> "lwz")."""
    return [ln.split(None, 1)[0].lower() for ln in lines if ln.strip()]


def _cosine(a: Counter, b: Counter) -> float:
    dot = sum(v * b.get(k, 0) for k, v in a.items())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def score(a: list[str], b: list[str]) -> float:
    """0..1, 1 = the same instruction sequence."""
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a[:MAX_OPS], b[:MAX_OPS], autojunk=False).ratio()


def rank(target: list[str], candidates: dict[str, list[str]], top: int = 5, floor: float = 0.6) -> list[tuple[str, float]]:
    """The `top` candidates most similar to `target`, best first, at least `floor` similar."""
    if len(target) < 4:  # tiny functions all look alike
        return []
    th = Counter(target)
    rough = []
    for name, ops in candidates.items():
        if not ops or not (0.6 <= len(ops) / len(target) <= 1 / 0.6):
            continue
        c = _cosine(th, Counter(ops))
        if c >= floor:
            rough.append((c, name))
    rough.sort(reverse=True)
    exact = [(name, score(target, candidates[name])) for _, name in rough[:150]]
    exact = [(n, s) for n, s in exact if s >= floor]
    exact.sort(key=lambda x: -x[1])
    return exact[:top]
