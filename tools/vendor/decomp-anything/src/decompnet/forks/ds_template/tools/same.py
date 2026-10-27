#!/usr/bin/env python3
"""python tools/same.py BUILT ORIGINAL STAMP: fail unless the rebuilt ROM is your copy, byte for byte; then write STAMP.
python tools/same.py --touch STAMP: just write STAMP (after a check that passed).

A copy that was trimmed (the unused end of the cartridge cut off, as many dumps are) or padded further counts as the
same when everything before the padding matches. When the ROM differs, this says where: which header fields, the ARM9
or ARM7 program, an overlay, the file tables, which files, or only where the files sit in the ROM.
"""
import contextlib
import hashlib
import struct
import sys

HEADER_FIELDS = [  # (start, end, what): the parts of the DS header that say something
    (0x00, 0x0C, "title"), (0x0C, 0x10, "game code"), (0x10, 0x12, "maker code"), (0x14, 0x15, "capacity"),
    (0x1E, 0x1F, "ROM version"), (0x20, 0x30, "ARM9 program's place and size"), (0x30, 0x40, "ARM7 program's place and size"),
    (0x40, 0x48, "file name table's place"), (0x48, 0x50, "file allocation table's place"),
    (0x50, 0x58, "ARM9 overlay table's place"), (0x58, 0x60, "ARM7 overlay table's place"),
    (0x68, 0x6C, "banner's place"), (0x6C, 0x6E, "secure area checksum"), (0x80, 0x84, "used ROM size"),
    (0x84, 0x88, "header size"), (0x15C, 0x15E, "logo checksum"), (0x15E, 0x160, "header checksum"),
]
BANNER_SIZES = {1: 0x840, 2: 0x940, 3: 0xA40, 0x103: 0x23C0}


def padding_only(longer: bytes, shorter: bytes) -> bool:
    """`longer` is `shorter` followed by nothing but one repeated padding byte."""
    tail = longer[len(shorter):]
    return longer[:len(shorter)] == shorter and tail.count(tail[:1]) == len(tail)


class Rom:
    def __init__(self, data: bytes):
        self.data = data
        u32 = lambda o: struct.unpack_from("<I", data, o)[0]  # noqa: E731
        self.arm9 = (u32(0x20), u32(0x2C), u32(0x28))  # offset, size, RAM address
        self.arm7 = (u32(0x30), u32(0x3C), u32(0x38))
        self.fnt, self.fat = (u32(0x40), u32(0x44)), (u32(0x48), u32(0x4C))
        self.ovt9, self.ovt7 = (u32(0x50), u32(0x54)), (u32(0x58), u32(0x5C))
        self.banner = u32(0x68)
        fat = data[self.fat[0]:self.fat[0] + self.fat[1]]
        self.files = [struct.unpack_from("<II", fat, i) for i in range(0, len(fat) - 7, 8)]

    def part(self, offset: int, size: int) -> bytes:
        return self.data[offset:offset + size]

    def banner_bytes(self) -> bytes:
        if not self.banner:
            return b""
        version = struct.unpack_from("<H", self.data, self.banner)[0] if self.banner + 2 <= len(self.data) else 0
        return self.part(self.banner, BANNER_SIZES.get(version, 0x840))

    def names(self) -> dict[int, str]:
        """File id -> its path (from the file name table), and overlays by their number."""
        out: dict[int, str] = {}
        for table, arm in ((self.ovt9, "ARM9"), (self.ovt7, "ARM7")):
            raw = self.part(*table)
            for i in range(0, len(raw) - 31, 32):
                ov_id, file_id = struct.unpack_from("<I", raw, i)[0], struct.unpack_from("<I", raw, i + 0x18)[0]
                out[file_id] = f"{arm} overlay {ov_id}"
        base, size = self.fnt
        seen = set()

        def walk(dir_id: int, path: str) -> None:
            if dir_id in seen or len(seen) > 4096:
                return
            seen.add(dir_id)
            sub, first = struct.unpack_from("<IH", self.data, base + (dir_id & 0xFFF) * 8)
            p, fid = base + sub, first
            while p < base + size:
                kind = self.data[p]
                p += 1
                if kind == 0:
                    break
                name = self.data[p:p + (kind & 0x7F)].decode("latin-1")
                p += kind & 0x7F
                if kind & 0x80:
                    child = struct.unpack_from("<H", self.data, p)[0]
                    p += 2
                    walk(child, f"{path}{name}/")
                else:
                    out.setdefault(fid, path + name)
                    fid += 1
        with contextlib.suppress(struct.error, IndexError):
            walk(0xF000, "")
        return out


def first_difference(a: bytes, b: bytes) -> int:
    n = min(len(a), len(b))
    lo = 0
    step = 1 << 16
    while lo < n and a[lo:lo + step] == b[lo:lo + step]:
        lo += step
    return next((i for i in range(lo, min(n, lo + step)) if a[i] != b[i]), n)


def explain(built: bytes, original: bytes) -> list[str]:
    """What differs between the rebuilt ROM and the original, part by part (as the original's own header places them)."""
    try:
        b, o = Rom(built), Rom(original)
    except struct.error:
        return ["one of the two isn't a complete DS ROM"]
    out = []
    fields = [what for start, end, what in HEADER_FIELDS if built[start:end] != original[start:end]]
    if fields:
        out.append("header: " + ", ".join(fields))
    for name, bp, op, ram in (("the ARM9 program", b.arm9, o.arm9, True), ("the ARM7 program", b.arm7, o.arm7, True)):
        x, y = b.part(*bp[:2]), o.part(*op[:2])
        if x != y:
            at = first_difference(x, y)
            where = f" (RAM 0x{op[2] + at:08X})" if ram else ""
            size = f", {len(x):#x} bytes instead of {len(y):#x}" if len(x) != len(y) else ""
            out.append(f"{name} differs from offset {at:#x}{where}{size}")
    for name, bp, op in (("the ARM9 overlay table", b.ovt9, o.ovt9), ("the ARM7 overlay table", b.ovt7, o.ovt7),
                         ("the file name table", b.fnt, o.fnt)):
        if b.part(*bp) != o.part(*op):
            out.append(f"{name} differs")
    if b.banner_bytes() != o.banner_bytes():
        out.append("the banner (icon and title) differs")
    names = o.names()
    changed = []
    for i, ((bs, be), (os_, oe)) in enumerate(zip(b.files, o.files, strict=False)):
        if built[bs:be] != original[os_:oe]:
            changed.append(names.get(i, f"file #{i}"))
    if len(b.files) != len(o.files):
        out.append(f"{len(b.files)} files instead of {len(o.files)}")
    if changed:
        out.append(f"{len(changed)} {'files differ' if len(changed) != 1 else 'file differs'}: " + ", ".join(changed[:8])
                   + (", ..." if len(changed) > 8 else ""))
    moved = sum(1 for (bs, _), (os_, _) in zip(b.files, o.files, strict=False) if bs != os_)
    if not out and moved:
        out.append(f"every program and file is the same; only where {moved} file{'s' if moved != 1 else ''} sit in "
                   "the ROM differs (alignment or padding between files)")
    elif moved:
        out.append(f"{moved} file{'s' if moved != 1 else ''} sit at other places in the ROM")
    if not out:
        sizes = f"; {len(built):#x} bytes instead of {len(original):#x}" if len(built) != len(original) else ""
        out.append(f"only the padding between the parts differs (from offset {first_difference(built, original):#x}"
                   f"{sizes}): every program and file is the same")
    return out


def main(argv: list[str]) -> int:
    if argv[0] == "--touch":
        with open(argv[-1], "w", encoding="utf-8") as f:
            f.write("ok\n")
        return 0
    built_path, original_path, stamp = argv[:3]
    with open(built_path, "rb") as bf, open(original_path, "rb") as of:
        built, original = bf.read(), of.read()
    if built == original:
        with open(stamp, "w", encoding="utf-8") as f:
            f.write("ok\n")
        return 0
    if padding_only(built, original) or padding_only(original, built):
        trimmed = len(original) < len(built)
        with open(stamp, "w", encoding="utf-8") as f:
            f.write("ok: identical up to the padding at the end\n")
        print(f"note: {built_path} is your copy byte for byte up to its end; your copy "
              f"{'was trimmed (the unused end of the cartridge was cut off)' if trimmed else 'has more padding at its end'}"
              f": {len(original):#x} bytes, this {len(built):#x}")
        return 0
    sha = lambda d: hashlib.sha1(d).hexdigest()  # noqa: E731
    print(f"{built_path} differs from your copy {original_path} (sha1 {sha(built)} vs {sha(original)}):", file=sys.stderr)
    for line in explain(built, original):
        print(f"  - {line}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
