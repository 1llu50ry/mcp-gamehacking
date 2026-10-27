"""Disassembly, instruction diffing and decomp.me/asm-differ style scoring.

score == 0 means a byte-for-byte (relocation-normalized) match. Lower is better.
"""

from __future__ import annotations

import difflib
import math
import re
from collections import Counter
from dataclasses import dataclass

import capstone

from .elfobj import FunctionObj, mask_relocs

PENALTY_STACKDIFF = 1
PENALTY_REGALLOC = 5
PENALTY_OPERAND = 10
PENALTY_REORDER = 60
PENALTY_INSERTION = 100
PENALTY_DELETION = 100

_CS = {
    ("x86_64", False): (capstone.CS_ARCH_X86, capstone.CS_MODE_64),
    ("x86", False): (capstone.CS_ARCH_X86, capstone.CS_MODE_32),
    # MIPS64 decoding also covers MIPS I/II; N64 (MIPS III) and PS2 (R5900) code uses 64-bit instructions.
    ("mips", True): (capstone.CS_ARCH_MIPS, capstone.CS_MODE_MIPS64 | capstone.CS_MODE_BIG_ENDIAN),
    ("mips", False): (capstone.CS_ARCH_MIPS, capstone.CS_MODE_MIPS64 | capstone.CS_MODE_LITTLE_ENDIAN),
    ("ppc", True): (capstone.CS_ARCH_PPC, capstone.CS_MODE_32 | capstone.CS_MODE_BIG_ENDIAN),
    ("arm", False): (capstone.CS_ARCH_ARM, capstone.CS_MODE_ARM),
    ("thumb", False): (capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB),
}

_REG = re.compile(
    r"^\$?(r[a-z0-9]+|e[a-z]{2}|[a-d][lhx]|[sd]il?|[bs]pl?|[xyz]mm\d+|r\d+[dwb]?"  # x86
    r"|zero|at|v[01]|a[0-3]|t\d|s[0-8]|k[01]|gp|fp|ra|f\d+"  # mips
    r"|cr\d|lr|pc|ip|sb|sl|d\d+|s\d+)$"  # ppc / arm
)
_NUM = re.compile(r"^-?(0x[0-9a-f]+|\d+)$", re.IGNORECASE)
_STACK = re.compile(r"\b(rsp|rbp|esp|ebp|\$?sp|\$?fp|r1)\b")
_TOKEN = re.compile(r"[\w.$<>+@-]+|\S")


@dataclass
class Insn:
    offset: int
    mnemonic: str
    operands: str
    text: str  # normalized "mnemonic operands" with reloc targets symbolized


def percent_text(p: float | None) -> str:
    """A match percentage that never reads 100% before the function really matches: 99.96 is 99.9%, not 100.0%."""
    if p is None:
        return "?"
    if p >= 100:
        return "100%"
    return f"{math.floor(max(0.0, p) * 10) / 10:.1f}%"


def disassemble(fn: FunctionObj) -> list[Insn]:
    arch, mode = _CS[(fn.arch, fn.big_endian)]
    md = capstone.Cs(arch, mode)
    md.detail = True
    md.skipdata = True
    code = mask_relocs(fn.code, fn.relocs, fn.arch, fn.big_endian)
    mips_names = _mips_reloc_names(fn.relocs) if fn.arch == "mips" else {}
    out: list[Insn] = []
    for ins in md.disasm(code, 0):
        ops = ins.op_str
        rel = next((r for r in fn.relocs if ins.address <= r.offset < ins.address + ins.size), None)
        if rel is not None and rel.offset in mips_names:
            ops = _mips_symbolize(ops, mips_names[rel.offset])
        elif rel is not None:
            off = rel.addend
            if fn.arch == "x86_64" and rel.type in (2, 4) and fn.format != "coff":
                # PC-relative: addend = field_offset - (bytes from reloc field to end of insn)
                off += (ins.address + ins.size) - rel.offset
            target = f"<{rel.symbol}{f'{off:+#x}' if off else ''}>"
            ops = _symbolize(ins, ops, rel.offset - ins.address, target, fn.arch)
        elif ins.id and ins.group(capstone.CS_GRP_JUMP) and _NUM.match(ops.strip()):
            ops = f".L{int(ops, 16):x}"  # intra-function branch: keep it position-relative
        out.append(Insn(ins.address, ins.mnemonic, ops, f"{ins.mnemonic} {ops}".strip()))
    return out


def _sext16(v: int) -> int:
    return v - 0x10000 if v & 0x8000 else v


def _mips_reloc_names(relocs) -> dict[int, str]:
    """GNU-as style operands for MIPS relocations: %hi(sym+off), %lo(sym+off), plain symbols for jal/j.
    MIPS objects use REL relocations, so each HI16/LO16 pair carries the symbol offset split across the
    two instruction fields; recombine it so both halves show the real offset (e.g. a struct field)."""
    out: dict[int, str] = {}
    for k, r in enumerate(relocs):
        if r.type == 4:  # R_MIPS_26
            out[r.offset] = r.symbol
        elif r.type in (5, 6):  # R_MIPS_HI16 / R_MIPS_LO16
            if r.type == 5:
                pair = next((x for x in relocs[k + 1:] if x.type == 6 and x.symbol == r.symbol), None)
                hi, lo = r.addend, pair.addend if pair else 0
            else:
                pair = next((x for x in reversed(relocs[:k]) if x.type == 5 and x.symbol == r.symbol), None)
                hi, lo = (pair.addend if pair else 0), r.addend
            full = (hi << 16) + _sext16(lo) if max(hi, lo) <= 0xFFFF else r.addend
            off = f"+{full:#x}" if full > 0 else f"-{-full:#x}" if full < 0 else ""
            out[r.offset] = f"%{'hi' if r.type == 5 else 'lo'}({r.symbol}{off})"
        elif r.type == 7:  # R_MIPS_GPREL16
            out[r.offset] = f"%gp_rel({r.symbol})"
    return out


def _mips_symbolize(ops: str, name: str) -> str:
    mem = re.search(r"(-?0x[0-9a-f]+|-?\d+)?\((\$\w+)\)$", ops)
    if name.startswith("%") and mem:  # load/store: offset(base)
        return f"{ops[:mem.start()]}{name}({mem.group(2)})"
    nums = list(re.finditer(r"-?0x[0-9a-f]+|\b\d+\b", ops))
    if nums:
        return ops[: nums[-1].start()] + name + ops[nums[-1].end():]
    return f"{ops}, {name}" if ops else name


def _symbolize(ins, ops: str, rel_at: int, target: str, arch: str) -> str:
    """Put a relocation's symbol into the operand it actually patches (the field is zeroed)."""
    if arch in ("x86_64", "x86"):
        if ins.disp_size and ins.disp_offset == rel_at and "[" in ops:
            lb, rb = ops.index("["), ops.index("]")
            inner = re.sub(r"\s*[+-]\s*(0x[0-9a-f]+|\d+)$", "", ops[lb + 1 : rb])
            return f"{ops[:lb + 1]}{inner} + {target}{ops[rb:]}"
        if ins.imm_size and ins.imm_offset == rel_at:
            outside = re.sub(r"\[.*?\]", lambda m: " " * len(m.group()), ops)
            nums = list(re.finditer(r"-?0x[0-9a-f]+|\b\d+\b", outside))
            return ops[: nums[-1].start()] + target + ops[nums[-1].end() :] if nums else f"{ops} {target}"
    nums = list(re.finditer(r"-?0x[0-9a-f]+|\b\d+\b", ops))
    return ops[: nums[-1].start()] + target + ops[nums[-1].end() :] if nums else f"{ops} {target}".strip()


def asm_text(fn: FunctionObj) -> str:
    return "\n".join(f"{i.offset:5x}:  {i.text}" for i in disassemble(fn))


def _classify(a: Insn, b: Insn) -> tuple[int, str]:
    if a.text == b.text:
        return 0, " "
    ta, tb = _TOKEN.findall(a.operands), _TOKEN.findall(b.operands)
    if len(ta) == len(tb):
        diffs = [(x, y) for x, y in zip(ta, tb, strict=False) if x != y]
        if all(_REG.match(x) and _REG.match(y) for x, y in diffs):
            return PENALTY_REGALLOC, "r"
        if all(_NUM.match(x) and _NUM.match(y) for x, y in diffs) and _STACK.search(a.operands):
            return PENALTY_STACKDIFF, "s"
    return PENALTY_OPERAND, "i"


@dataclass
class DiffResult:
    score: int
    max_score: int
    rows: list[tuple[str, str, str]]  # (marker, target, candidate)
    bytes_match: bool

    @property
    def percent(self) -> float:
        if self.bytes_match:
            return 100.0
        return max(0.0, 100.0 * (1 - self.score / self.max_score)) if self.max_score else 0.0

    def render(self, context: int = 2, max_rows: int = 60) -> str:
        """Compact side-by-side diff: a count of each kind of mismatch, then only mismatches with a little context.
        Long runs of missing or extra instructions are shortened (a half-written function would otherwise spend
        every row on code that isn't there yet), so each compile costs the agent little context."""
        return render_rows(self.rows, context, max_rows)


MARKERS = {"<": "missing", ">": "extra", "|": "different", "o": "reordered", "r": "regalloc", "s": "stack",
           "i": "operand"}
LEGEND = ("markers: r=regalloc s=stack-offset i=operand |=different insn <=missing (target only) >=extra (yours only) "
          "o=reordered")


def render_rows(rows: list[tuple[str, str, str]], context: int = 2, max_rows: int = 60, run: int = 6,
                legend: str = LEGEND) -> str:
    counts = Counter(m for m, _, _ in rows if m != " ")
    summary = ", ".join(f"{n} {MARKERS.get(m, m)}" for m, n in counts.most_common())
    width = min(max((len(t) for _, t, _ in rows), default=10) + 2, 44)
    show = set()
    for i, (m, _, _) in enumerate(rows):
        if m != " ":
            show.update(range(max(0, i - context), min(len(rows), i + context + 1)))
    lines = [f"   {'TARGET':<{width}}| YOURS"]
    order = sorted(show)
    prev, k = -1, 0
    while k < len(order):
        i = order[k]
        if i != prev + 1:
            lines.append("   ...")
        m = rows[i][0]
        j = i
        while m in "<>" and j + 1 < len(rows) and rows[j + 1][0] == m:
            j += 1
        if j - i + 1 > run:  # a long run of one kind: its start and end, and how much is in between
            for a in (i, i + 1):
                lines.append(f" {m} {rows[a][1][:width - 1]:<{width}}| {rows[a][2]}")
            lines.append(f"   ... {j - i - 2} more {MARKERS[m]} ({'target only' if m == '<' else 'yours only'}) ...")
            lines.append(f" {m} {rows[j][1][:width - 1]:<{width}}| {rows[j][2]}")
            prev = j
            while k < len(order) and order[k] <= j:
                k += 1
        else:
            m, t, c = rows[i]
            lines.append(f" {m} {t[:width - 1]:<{width}}| {c}")
            prev = i
            k += 1
        if len(lines) >= max_rows and k < len(order):
            lines.append(f"   ... ({len(rows) - prev - 1} more rows not shown: fix these first)")
            break
    else:
        if prev != len(rows) - 1:
            lines.append("   ...")
    return (f"{summary}\n" if summary else "") + legend + "\n" + "\n".join(lines)


_SPLAT_PREFIX = re.compile(r"^/\*\s*[0-9A-Fa-f]+\s+[0-9A-Fa-f]{8}\s+[0-9A-Fa-f]{8}\s*\*/\s*")


def compact_asm(text: str) -> str:
    """splat's listing without the per-line `/* offset address bytes */` comment and alignment padding: about half
    the size, so an agent's context holds more of the work. Labels (.L80012345) still carry the addresses."""
    out = []
    for line in text.splitlines():
        m = _SPLAT_PREFIX.match(line)
        if m:
            op, _, args = line[m.end():].strip().partition(" ")
            line = f"  {op} {args.strip()}" if args.strip() else f"  {op}"
            line = re.sub(r",\s+", ", ", line)
        out.append(line)
    return "\n".join(out)


def diff(target: FunctionObj, candidate: FunctionObj) -> DiffResult:
    t_ins, c_ins = disassemble(target), disassemble(candidate)
    max_score = max(1, len(t_ins)) * PENALTY_INSERTION
    bytes_match = target.fingerprint() == candidate.fingerprint()

    sm = difflib.SequenceMatcher(a=[i.mnemonic for i in t_ins], b=[i.mnemonic for i in c_ins], autojunk=False)
    rows: list[tuple[str, str, str]] = []
    score = 0
    missing: Counter[str] = Counter()
    extra: Counter[str] = Counter()
    for op, a0, a1, b0, b1 in sm.get_opcodes():
        if op == "equal":
            for a, b in zip(t_ins[a0:a1], c_ins[b0:b1], strict=False):
                pen, mark = _classify(a, b)
                score += pen
                rows.append((mark, a.text, b.text))
            continue
        ta, cb = t_ins[a0:a1], c_ins[b0:b1]
        for k in range(max(len(ta), len(cb))):
            a = ta[k] if k < len(ta) else None
            b = cb[k] if k < len(cb) else None
            if a and b:
                rows.append(("|", a.text, b.text))
                missing[a.text] += 1
                extra[b.text] += 1
            elif a:
                rows.append(("<", a.text, ""))
                missing[a.text] += 1
            else:
                rows.append((">", "", b.text))
                extra[b.text] += 1
    # instructions that are merely in the wrong place are cheaper than real insert/delete
    reordered = sum((missing & extra).values())
    score += reordered * PENALTY_REORDER
    score += (sum(missing.values()) - reordered) * PENALTY_DELETION
    score += (sum(extra.values()) - reordered) * PENALTY_INSERTION
    if reordered:
        moved = missing & extra
        rows = [("o" if m in "|<>" and ((t and moved[t]) or (c and moved[c])) else m, t, c) for m, t, c in rows]

    if score == 0 and not bytes_match:
        score = 1  # textually identical but encodings/relocs differ (e.g. branch form, addend)
    if bytes_match:
        score = 0
    return DiffResult(score=score, max_score=max_score, rows=rows, bytes_match=bytes_match)
