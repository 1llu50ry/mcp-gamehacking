"""Machine-generated starting points: run m2c on a function's target code to give the first agent
a C draft instead of bare assembly.

m2c (GPL-3.0) is installed as a separate pinned tool (`decompnet toolchain install m2c`) and run as a
program, never imported. It reads GNU-as syntax, which we rebuild from the target object: capstone
disassembly with relocations shown as %hi/%lo/symbols and branch targets turned into labels.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

from . import scoring, toolchains
from .elfobj import FunctionObj

# m2c target triple per toolchain (platform-compiler-language).
M2C_TARGETS = {
    "gcc-2.7.2-kmc": "mips-gcc-c",
    "ee-gcc-2.96": "mipsee-gcc-c",
    "ido-7.1": "mips-ido-c",
    "ido-5.3": "mips-ido-c",
    "gcc-2.7.2-psx": "mipsel-gcc-c",
    "gcc-2.8.1-psx": "mipsel-gcc-c",
    "agbcc": "gba-gcc-c",
}
# What m2c's --valid-syntax output needs to compile: its unknown types and macros, defined the simplest way that
# keeps the code's meaning (written for decomp.wtf; the names are m2c's interface).
M2C_MACROS = """\
#ifndef M2C_DEFINES
#define M2C_DEFINES
typedef s32 M2C_UNK;
typedef s8 M2C_UNK8;
typedef s16 M2C_UNK16;
typedef s32 M2C_UNK32;
#define M2C_FIELD(expr, type_ptr, offset) (*(type_ptr)((s8 *)(expr) + (offset)))
#define M2C_BITWISE(type, expr) ((type)(expr))
#define M2C_ERROR(desc) (0)
#define M2C_CARRY 0
#define M2C_OVERFLOW(a) (0)
#endif
"""
_BRANCH = re.compile(r"^(b|beq|bne|beqz|bnez|bgtz|blez|bltz|bgez|bltzal|bgezal|beql|bnel|beqzl|bnezl|bgtzl|blezl|"
                     r"bltzl|bgezl|bc1t|bc1f|bc1tl|bc1fl|j)$")


def available() -> bool:
    return toolchains.installed("m2c") is not None


def gnu_asm(fn: FunctionObj) -> str:
    """The function as a GNU as source file m2c understands."""
    insns = scoring.disassemble(fn)
    targets: set[int] = set()
    body = []
    for ins in insns:
        ops = ins.operands
        parts = [p.strip() for p in ops.split(",")] if ops else []
        if _BRANCH.match(ins.mnemonic) and parts and re.fullmatch(r"0x[0-9a-f]+|\d+", parts[-1]):
            target = int(parts[-1], 0)
            targets.add(target)
            parts[-1] = f".L{fn.name}_{target:X}"
            ops = ", ".join(parts)
        body.append((ins.offset, f"{ins.mnemonic} {ops}".rstrip()))
    lines = [".set noat", ".set noreorder", ".set gp=64", "", f"glabel {fn.name}"]
    for off, text in body:
        if off in targets:
            lines.append(f".L{fn.name}_{off:X}:")
        lines.append(f"/* {off:06X} */ {text}")
    return "\n".join(lines) + "\n"


def _context_for_m2c(header: str) -> str:
    # m2c parses the context with pycparser and does not run a preprocessor.
    return "\n".join(line for line in header.splitlines() if not line.lstrip().startswith("#"))


def generate(fn: FunctionObj, toolchain_id: str | None, context_header: str = "", timeout: float = 20) -> str | None:
    """C draft for one function, or None when m2c or the target is unavailable or m2c fails."""
    return generate_from_asm(gnu_asm(fn), fn.name, toolchain_id, context_header, timeout=timeout)


def generate_from_asm(asm_text: str, name: str, toolchain_id: str | None, context_header: str = "",
                      data_asm: str | None = None, timeout: float = 20, valid: bool = False) -> str | None:
    """C draft from GNU/splat-style assembly text (plus optional data, for jump tables and strings). `valid`:
    m2c's compilable form (unknown types and expressions as M2C_ macros, see M2C_MACROS), for trying drafts as is."""
    target = M2C_TARGETS.get(toolchain_id or "")
    if not target:
        return None
    return run_m2c(asm_text, name, target, context_header, data_asm, timeout, valid)


def run_m2c(asm_text: str, name: str, target: str, context_header: str = "", data_asm: str | None = None,
            timeout: float = 20, valid: bool = False) -> str | None:
    """Run m2c for one function with an explicit target triple (e.g. ppc-mwcc-c++)."""
    if not available():
        return None
    if target.startswith("gba"):  # luvdis / pret style: function macro, pre-UAL load mnemonics
        asm_text = re.sub(r"^\s*(?:non_word_aligned_)?thumb_func_start\s+(\w+)", r"glabel \1", asm_text, flags=re.MULTILINE)
        asm_text = re.sub(r"^\s*arm_func_start\s+(\w+)", r"glabel \1", asm_text, flags=re.MULTILINE)
        asm_text = re.sub(r"\bld(s[hb])\b", r"ldr\1", asm_text)
    m2c = toolchains.venv_bin(toolchains.path("m2c") / "venv", "m2c")
    with tempfile.TemporaryDirectory(prefix="decompnet-m2c-") as tmp:
        asm = Path(tmp) / f"{name}.s"
        asm.write_text(asm_text, encoding="utf-8")
        argv = [str(m2c), *(["--valid-syntax"] if valid else []), "-t", target, "-f", name, str(asm)]
        if data_asm:
            (Path(tmp) / "data.s").write_text(data_asm, encoding="utf-8")
            argv.append(str(Path(tmp) / "data.s"))
        if context_header.strip():
            ctx = Path(tmp) / "context.c"
            ctx.write_text(_context_for_m2c(context_header), encoding="utf-8")
            argv[1:1] = ["--context", str(ctx)]
        try:
            res = subprocess.run(argv, capture_output=True, text=True, timeout=timeout,
                                 encoding="utf-8", errors="replace")
        except subprocess.TimeoutExpired:
            return None
        if res.returncode != 0 and "--context" in argv:  # an unparsable context must not cost us the seed
            i = argv.index("--context")
            res = subprocess.run(argv[:i] + argv[i + 2:], capture_output=True, text=True, timeout=timeout,
                                 encoding="utf-8", errors="replace")
        out = res.stdout.strip()
        return out if res.returncode == 0 and out else None
