"""Split an N64 ROM into functions and data with splat (MIT) and read back what it found.

splat's own create_config finds the boot entry point, the main code segment, .bss and the compiler;
`splat split` then disassembles every function (spimdisasm, MIT) with symbols for every address it
can pair up (%hi/%lo, jal targets). We parse that output into plain records the rest of the app uses.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import rabbitizer

from .n64 import RomError

_INSN = re.compile(r"^\s*/\* ([0-9A-F]+) ([0-9A-F]{8}) ([0-9A-F]{8}) \*/\s+(\S+)\s*(.*?)\s*$")
_LABEL = re.compile(r"^\s*(?:jlabel\s+)?(\.?L[0-9A-F]{8}):?\s*$")
_DATA = re.compile(r"^\s*/\* ([0-9A-F]+ )?([0-9A-F]{8})(?: [0-9A-F]+)? \*/\s+\.(\w+)\s*(.*?)\s*$")
_DLABEL = re.compile(r"^\s*dlabel\s+(\S+)")
_GLABEL = re.compile(r"^\s*glabel\s+(\S+)")


@dataclass
class AsmLine:
    rom: int
    vram: int
    word: int
    mnemonic: str
    operands: str


@dataclass
class RomFunction:
    name: str
    vram: int
    rom: int
    segment: str
    lines: list[AsmLine]
    asm_path: Path
    labels: set[int] = field(default_factory=set)

    @property
    def size(self) -> int:
        return 4 * len(self.lines)


def split_function(fn: RomFunction, at: int, new_name: str) -> tuple[RomFunction, RomFunction]:
    """Cut a function in two at address `at`. The disassembler can't always see where a function ends
    (one that never returns runs straight into the next), so agents can split what it merged."""
    if not fn.vram < at < fn.vram + fn.size or (at - fn.vram) % 4:
        raise ValueError(f"0x{at:08X} is not an instruction boundary inside {fn.name}")
    k = (at - fn.vram) // 4
    head = RomFunction(fn.name, fn.vram, fn.rom, fn.segment, fn.lines[:k], fn.asm_path, {a for a in fn.labels if a < at})
    _trim_padding(head.lines)
    tail = RomFunction(new_name, at, fn.lines[k].rom, fn.segment, fn.lines[k:], fn.asm_path, {a for a in fn.labels if a >= at})
    return head, tail


@dataclass
class DataSymbol:
    name: str
    vram: int
    rom: int | None  # None for .bss
    size: int
    kind: str  # data | string | jtbl | bss
    preview: str = ""


@dataclass
class Segment:
    name: str
    rom_start: int
    rom_end: int
    vram: int

    def contains(self, address: int, length: int = 1) -> bool:
        return self.vram <= address and address + length <= self.vram + (self.rom_end - self.rom_start)


@dataclass
class SplitResult:
    functions: list[RomFunction]
    data: list[DataSymbol]
    segments: list[Segment]
    named: dict[str, int]  # names splat gave addresses (entrypoint, main, ...)
    config_path: Path
    compiler: str
    log: str
    platform: str = "n64"
    gp: int = 0  # value of $gp for $gp-relative data (PlayStation), 0 if unused
    image: str = ""  # the flat image splat reads (the ROM itself, or one made from an ELF)


def segments_from_config(path: Path) -> list[Segment]:
    """Code segments (ROM range + load address) from a splat config."""
    import yaml

    cfg = yaml.safe_load(path.read_text(encoding="utf-8"))
    raw = cfg.get("segments", [])

    def start_of(seg):
        if isinstance(seg, list):
            return seg[0]
        return seg.get("start")

    out = []
    for i, seg in enumerate(raw):
        if not isinstance(seg, dict) or "vram" not in seg or seg.get("type") != "code":
            continue
        nxt = next((start_of(s) for s in raw[i + 1:] if start_of(s) is not None), None)
        if nxt is None:
            continue
        out.append(Segment(seg.get("name", f"{seg['start']:X}"), int(seg["start"]), int(nxt), int(seg["vram"])))
    return out


def code_ranges(path: Path) -> list[tuple[int, int, int]]:
    """(rom_start, rom_end, vram) of what splat's config disassembles as code: the code subsegments, not the data
    after them (create_config can file a whole segment's tail as data: GoldenEye's game code is in there)."""
    import yaml

    cfg = yaml.safe_load(path.read_text(encoding="utf-8"))
    out = []
    for seg in segments_from_config(path):
        raw = next((s for s in cfg.get("segments", []) if isinstance(s, dict) and s.get("start") == seg.rom_start
                    and s.get("type") == "code"), None)
        subs = [s for s in (raw or {}).get("subsegments") or [] if isinstance(s, list) and s]
        if not subs:
            out.append((seg.rom_start, seg.rom_end, seg.vram))
            continue
        for i, sub in enumerate(subs):
            if len(sub) > 1 and sub[1] in ("c", "asm", "hasm"):
                end = next((int(t[0]) for t in subs[i + 1:]), seg.rom_end)
                out.append((int(sub[0]), end, seg.vram + int(sub[0]) - seg.rom_start))
    return out


def named_symbols(workdir: Path) -> dict[str, int]:
    out = {}
    path = workdir / "symbol_addrs.txt"
    if path.exists():
        for m in re.finditer(r"^\s*([A-Za-z_]\w*)\s*=\s*(0x[0-9A-Fa-f]+)\s*;", path.read_text(encoding="utf-8"), re.MULTILINE):
            out[m.group(1)] = int(m.group(2), 16)
    return out


def _splat(args: list[str], cwd: Path) -> str:
    res = subprocess.run([sys.executable, "-m", "splat", *args], cwd=cwd, capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    out = (res.stdout + res.stderr).strip()
    if res.returncode != 0:
        lines = [ln.strip() for ln in out.splitlines() if ln.strip()]
        reason = next((ln for ln in reversed(lines) if re.match(r"\w*(Error|Exception)\b|error:", ln)), lines[-1] if lines else "")
        err = RomError(f"splat could not analyse this ROM: {reason[:300]}")
        err.details = out[-6000:]  # the whole story, for the log and a bug report
        raise err
    return out


def _patch_config(path: Path) -> tuple[str, str, int]:
    """Disassemble code segments as one C file per segment, so every function gets its own .s file,
    and keep empty functions as asm too (we want every function to be a target).
    Returns (compiler guess, platform, gp value)."""
    text = path.read_text(encoding="utf-8")
    compiler = (re.search(r"^\s*compiler:\s*(\w+)", text, re.MULTILINE) or [None, "KMC"])[1]
    platform = (re.search(r"^\s*platform:\s*(\w+)", text, re.MULTILINE) or [None, "n64"])[1]
    gp = re.search(r"^\s*gp_value:\s*(0x[0-9A-Fa-f]+)", text, re.MULTILINE)
    out, segment = [], None
    for line in text.splitlines():
        m = re.match(r"^\s*- name:\s*(\S+)", line)
        if m:
            segment = m.group(1)
        m = re.match(r"^(\s*- \[)(0x[0-9A-Fa-f]+), asm(?:, [^\]]*)?\]\s*(#.*)?$", line)
        if m and segment:
            line = f"{m.group(1)}{m.group(2)}, c, {segment}]"
        out.append(line)
    text = "\n".join(out) + "\n"
    extra = "  disassemble_all: True\n  auto_decompile_empty_functions: False\n"
    text = text.replace("options:\n", "options:\n" + extra, 1)
    path.write_text(text, encoding="utf-8")
    return compiler, platform, int(gp.group(1), 16) if gp else 0


def parse_function(path: Path, segment: str, big_endian: bool = True) -> RomFunction | None:
    """One function from a spimdisasm .s file. The 8-digit field is the instruction's bytes in file order."""
    order = "big" if big_endian else "little"
    name, lines, labels = None, [], set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        if name is None:
            m = _GLABEL.match(raw)
            if m:
                name = m.group(1)
            continue
        m = _INSN.match(raw)
        if m:
            rom, vram, word, mnem, ops = m.groups()
            lines.append(AsmLine(int(rom, 16), int(vram, 16), int.from_bytes(bytes.fromhex(word), order), mnem, ops))
            continue
        m = _LABEL.match(raw)
        if m:
            labels.add(int(m.group(1).lstrip(".L"), 16))
    if name is None or not lines:
        return None
    _trim_padding(lines)
    return RomFunction(name, lines[0].vram, lines[0].rom, segment, lines, path, labels)


def _trim_padding(lines: list[AsmLine]) -> None:
    """Alignment padding between source files shows up as nops after the last function of a file.
    A nop in a delay slot belongs to the function; any nop after that is padding."""
    while len(lines) > 1 and lines[-1].word == 0 and not rabbitizer.Instruction(lines[-2].word).hasDelaySlot():
        lines.pop()


def _complete_delay_slot(fn: RomFunction, rom: bytes, big_endian: bool = True) -> None:
    """If the last instruction jumps, its delay slot is part of the function too. The code/data
    boundary guess can cut it off when the function is the last one before data."""
    last = fn.lines[-1]
    if not rabbitizer.Instruction(last.word).hasDelaySlot() or last.rom + 8 > len(rom):
        return
    word = int.from_bytes(rom[last.rom + 4:last.rom + 8], "big" if big_endian else "little")
    insn = rabbitizer.Instruction(word, last.vram + 4)
    fn.lines.append(AsmLine(last.rom + 4, last.vram + 4, word, insn.getOpcodeName(), insn.disassemble().split(None, 1)[1]
                            if " " in insn.disassemble().strip() else ""))


def parse_data(path: Path) -> list[DataSymbol]:
    """Data symbols from a spimdisasm data/rodata/bss file: name, address, size and a short preview."""
    syms: list[DataSymbol] = []
    current: DataSymbol | None = None
    end = 0

    def close():
        if current is not None:
            current.size = max(current.size, end - current.vram)
            syms.append(current)

    bss = path.name.endswith(".bss.s")
    for raw in path.read_text(encoding="utf-8").splitlines():
        m = _DLABEL.match(raw)
        if m:
            close()
            current, end = None, 0
            pending = m.group(1)
            current = DataSymbol(pending, 0, None, 0, "bss" if bss else "jtbl" if pending.startswith("jtbl_") else "data")
            continue
        m = _DATA.match(raw)
        if not m or current is None:
            continue
        rom, vram, directive, arg = m.groups()
        vram = int(vram, 16)
        if not current.vram:
            current.vram = vram
            current.rom = int(rom, 16) if rom else None
        if directive == "space":
            end = vram + int(arg, 0)
        elif directive == "asciz" or directive == "ascii":
            current.kind = "string"
            current.preview = current.preview or arg[:120]
            s = arg.strip('"').encode().decode("unicode_escape", errors="replace")
            end = vram + len(s) + (directive == "asciz")
        else:
            width = {"word": 4, "float": 4, "short": 2, "half": 2, "byte": 1, "double": 8, "dword": 8}.get(directive, 4)
            end = vram + width
    close()
    return [s for s in syms if s.vram]


def _gp_from_entry(image: bytes, entry: int, segments: list[Segment]) -> int:
    """$gp as the program's start-up code sets it (`lui $gp, hi` + `addiu $gp, $gp, lo`)."""
    import rabbitizer

    seg = next((s for s in segments if s.contains(entry, 4)), None)
    if seg is None:
        return 0
    at = seg.rom_start + entry - seg.vram
    hi = None
    for i in range(0, 0x400, 4):
        word = int.from_bytes(image[at + i:at + i + 4], "little")
        ins = rabbitizer.Instruction(word, entry + i)
        name = ins.getOpcodeName()
        if name == "lui" and ins.rt.value == 28:
            hi = (word & 0xFFFF) << 16
        elif hi is not None and name in ("addiu", "daddiu") and ins.rt.value == 28 and ins.rs.value == 28:
            return (hi + ((word & 0xFFFF) ^ 0x8000) - 0x8000) & 0xFFFFFFFF
        elif hi is not None and name == "ori" and ins.rt.value == 28 and ins.rs.value == 28:
            return hi | (word & 0xFFFF)
    return 0


def _add_code_segments(config: Path, workdir: Path, image: str, log=print) -> str:
    """An N64 game's code outside the main segment (n64code.py), added to splat's config as code segments of their
    own. Compressed code (Rare's, Yaz0) is unpacked first and appended to a working copy of the ROM, which splat then
    reads instead (and an export rebuilds). Returns the image splat reads."""
    import hashlib

    import yaml

    from .n64code import find_segments, unpack_code

    original = image
    rom = (workdir / image).read_bytes()
    packed = unpack_code(rom)
    if packed:
        work = bytearray(rom)
        for _, data in packed:  # each after a gap, so pieces of different blocks never run together
            work += bytes(-len(work) % 0x10 + 0x2000)
            work += data
        work += bytes(-len(work) % 0x10)
        image = f"{Path(image).stem}.unpacked{Path(image).suffix}"
        (workdir / image).write_bytes(work)
        rom = bytes(work)
        kib = sum(len(d) for _, d in packed) // 1024
        log(f"unpacked {len(packed)} compressed code block{'s' if len(packed) != 1 else ''} ({kib} KiB)")
    taken = code_ranges(config)
    found = find_segments(rom, taken) if taken else []
    if not found:
        return original
    cfg = yaml.safe_load(config.read_text(encoding="utf-8"))
    if packed:
        cfg.setdefault("options", {})["target_path"] = image
        cfg["sha1"] = hashlib.sha1(rom).hexdigest()

    def start_of(seg):
        return seg[0] if isinstance(seg, list) else seg.get("start")

    starts = {st for st, _, _ in found}
    segs = [s for s in cfg["segments"] if not (isinstance(s, dict) and s.get("type") == "bin" and start_of(s) in starts)
            and not isinstance(s, list)]  # the end marker comes back at the image's end
    for st, en, vram in found:
        name = f"code_{vram:08X}"
        segs.append({"name": name, "type": "code", "start": st, "vram": vram, "subsegments": [[st, "c", name]]})
        if en < len(rom) and not any(start_of(s) == en for s in segs if not isinstance(s, list)):
            segs.append({"type": "bin", "start": en})
    segs.sort(key=lambda s: start_of(s) if start_of(s) is not None else -1)
    segs.append([len(rom)])
    cfg["segments"] = segs
    config.write_text(yaml.safe_dump(cfg, sort_keys=False, default_flow_style=None), encoding="utf-8")
    kib = sum(en - st for st, en, _ in found) // 1024
    log(f"found {len(found)} more code segment{'s' if len(found) != 1 else ''} the game loads later ({kib} KiB)")
    return image


def _add_overlays(config: Path, workdir: Path, image: str, found: list[tuple[str, bytes, int, int]], log=print) -> str:
    """PlayStation overlays (overlays.py): each appended to a working copy of the program's image, as a code segment
    of its own at the address it's loaded at. Returns the image splat reads."""
    import hashlib

    import yaml

    data = bytearray((workdir / image).read_bytes())
    cfg = yaml.safe_load(config.read_text(encoding="utf-8"))
    segs = [s for s in cfg["segments"] if not isinstance(s, list)]
    for name, code, vram, code_at in found:
        data += bytes(-len(data) % 0x10 + 0x10)
        start = len(data)
        data += code
        subs = [[start, "data", f"ovl_{name}_header"]] if code_at else []  # what comes before its code: a header
        segs.append({"name": f"ovl_{name}", "type": "code", "start": start, "vram": vram,
                     "subsegments": [*subs, [start + code_at, "c", f"ovl_{name}"]]})
    data += bytes(-len(data) % 0x10)
    segs.append([len(data)])
    out = f"{Path(image).stem}.overlays{Path(image).suffix}"
    (workdir / out).write_bytes(data)
    cfg["segments"] = segs
    cfg.setdefault("options", {})["target_path"] = out
    cfg["sha1"] = hashlib.sha1(bytes(data)).hexdigest()
    config.write_text(yaml.safe_dump(cfg, sort_keys=False, default_flow_style=None), encoding="utf-8")
    log(f"added {len(found)} overlay{'s' if len(found) != 1 else ''} ({sum(len(o[1]) for o in found) // 1024} KiB of code)")
    return out


def split_rom(workdir: Path, rom_name: str = "rom.z64", log=print,
              overlays: list[tuple[str, bytes, int, int]] | None = None) -> SplitResult:
    """Run splat on workdir/rom_name and return every function and data symbol it found. `overlays`: code from
    other files of a PlayStation disc, each with the address it's loaded at."""
    import yaml

    log("finding the code segments")
    args = ["create_config", rom_name]
    if (workdir / rom_name).read_bytes()[:4] == b"\x7fELF":  # splat flattens ELF programs with objcopy
        from .. import toolchains

        toolchains.ensure("binutils-mips", log=lambda *_: None)
        objcopy = toolchains.binary("binutils-mips").parent / "mips-ps2-decompals-objcopy"
        args[1:1] = ["--objcopy", str(objcopy)]
    out = _splat(args, workdir)
    configs = sorted(p for p in workdir.glob("*.yaml"))
    if not configs:
        raise RomError("splat did not produce a config for this ROM")
    config = configs[0]
    image = (yaml.safe_load(config.read_text(encoding="utf-8")).get("options") or {}).get("target_path") or rom_name
    compiler, platform, gp = _patch_config(config)
    big_endian = platform == "n64"
    if platform == "n64":
        image = _add_code_segments(config, workdir, image, log)
    elif overlays:
        image = _add_overlays(config, workdir, image, overlays, log)
    log("disassembling every function")
    out += "\n" + _splat(["split", config.name], workdir)

    functions = []
    for path in sorted((workdir / "asm" / "nonmatchings").glob("*/*.s")):
        fn = parse_function(path, path.parent.name, big_endian)
        if fn is not None:
            functions.append(fn)
    for path in sorted((workdir / "asm" / "nonmatchings").glob("*/*/*.s")):  # per-file subfolders
        fn = parse_function(path, path.parent.parent.name, big_endian)
        if fn is not None:
            functions.append(fn)
    seen: dict[str, int] = {}  # name -> where it is in the image
    unique = []
    rom = (workdir / image).read_bytes()
    for fn in sorted(functions, key=lambda f: f.vram):
        if fn.name in seen:  # overlays loaded at the same address: the same name in another overlay
            if seen[fn.name] == fn.rom:
                continue
            fn.name = f"{fn.segment}_{fn.name}"
            if fn.name in seen:
                continue
        seen[fn.name] = fn.rom
        _complete_delay_slot(fn, rom, big_endian)
        unique.append(fn)
    data = []
    for path in sorted((workdir / "asm" / "data").glob("**/*.s")):
        data += parse_data(path)
    if not unique:
        raise RomError("splat found no functions; the code may be compressed or use an unusual boot layout")
    segments = segments_from_config(config)
    if platform == "ps2" and not gp:
        program = (workdir / rom_name).read_bytes()
        gp = _gp_from_entry(rom, int.from_bytes(program[24:28], "little"), segments)
    log(f"found {len(unique)} functions and {len(data)} data symbols")
    return SplitResult(unique, data, segments, named_symbols(workdir), config, compiler, out, platform, gp, image)
