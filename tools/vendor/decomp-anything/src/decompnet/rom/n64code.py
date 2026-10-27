"""Code an N64 game loads later: segments outside the main one that splat's create_config finds.

splat finds the boot code and the main code segment. Many games keep more code elsewhere in the ROM and load it at
run time to an address of its own: Super Mario 64's engine (0x80378800) and Mario's head on the title screen
("goddard", 0x8016F000) are a third of its code. Nothing in the ROM says where such code goes, but the code itself
does: its calls (jal) are absolute addresses, and they land on its own functions' starts. So:

1. find stretches of the ROM that look like MIPS code (functions returning with `jr $ra`, stack frames made with
   `addiu $sp, $sp, -N`);
2. for each, the load address that makes most of its calls land on stack-frame starts in it;
3. its first function: the lowest address anything calls in it (the main code calls into it too), its end: the
   last return.

Segments whose addresses overlap code already known (overlays sharing one address) are left out: function
addresses stay unique in a project.

Code can also be compressed in the ROM (unpack_code): Rare's games keep theirs as deflate streams after a 0x1172 or
0x1173 marker (Perfect Dark: 0x1173 and the unpacked size, then the stream), Nintendo's in Yaz0 (Ocarina of Time's,
Majora's Mask's). Such code is unpacked and appended to a working copy of the ROM, where the same search finds it.
"""

from __future__ import annotations

import collections
import struct
import zlib

JR_RA = 0x03E00008
BLOCK = 0x400
# where code can run: KSEG0 (RAM), or mapped through the TLB (GoldenEye's game code runs at 0x7F000000). A jal keeps
# the top four bits of the address it's at, so the region decides what its targets are.
REGIONS = ((0x80000000, 0x81000000), (0x70000000, 0x80000000))


def _frame(word: int) -> bool:
    return (word & 0xFFFF8000) == 0x27BD8000  # addiu $sp, $sp, -N


def _jal_targets(words: tuple[int, ...], region: int = 0x80000000) -> list[int]:
    return [((w & 0x03FFFFFF) << 2) | (region & 0xF0000000) for w in words if (w >> 26) == 3]


def _code_like(words: tuple[int, ...]) -> bool:
    """A return or a stack frame: either is rare in anything but code (a large function can go a while without the
    other)."""
    return any(w == JR_RA or _frame(w) for w in words)


def find_segments(rom: bytes, taken: list[tuple[int, int, int]]) -> list[tuple[int, int, int]]:
    """(rom_start, rom_end, vram) of code segments outside `taken` (rom_start, rom_end, vram of the known ones)."""
    size = len(rom) & ~3
    known_code = [(s, e) for s, e, _ in taken]
    calls: list[int] = []  # every call the known code makes outside itself: some go into the code found here
    known_vram = [(v, v + e - s) for s, e, v in taken]
    for s, e in known_code:
        calls += [t for t in _jal_targets(struct.unpack(f">{(e - s) // 4}I", rom[s:e - (e - s) % 4]))
                  if not any(a <= t < b for a, b in known_vram)]
    gaps, pos = [], 0x1000
    for s, e in sorted(known_code):
        if s > pos:
            gaps.append((pos, s))
        pos = max(pos, e)
    if pos < size:
        gaps.append((pos, size))

    candidates = []  # (start, end, vram, how sure): every stretch placed first, the surest kept first
    stretches = []  # every stretch of code, for the second pass
    for g_lo, g_hi in gaps:
        regions, cur = [], None
        for off in range(g_lo, g_hi - 0x20, BLOCK):
            end = min(off + BLOCK, g_hi) & ~3
            if _code_like(struct.unpack(f">{(end - off) // 4}I", rom[off:end])):
                if cur and off <= cur[1] + 2 * BLOCK:  # a quiet stretch inside a segment is fine
                    cur[1] = end
                else:
                    cur = [off, end]
                    regions.append(cur)
        floor = g_lo
        for lo, hi in regions:
            stretches.append((lo, hi, floor))
            seg = _place(rom, lo, hi, floor, calls, known_vram)
            if seg:
                candidates.append(seg)
                floor = seg[1]
    found = []
    used_vram = [(v, v + (e - s)) for s, e, v in taken]

    def accept(start: int, end: int, vram: int) -> bool:
        if any(a < vram + (end - start) and vram < b for a, b in used_vram) or \
                any(a < end and start < b for a, b, _ in found):
            return False
        found.append((start, end, vram))
        used_vram.append((vram, vram + end - start))
        return True

    for start, end, vram, _ in sorted(candidates, key=lambda c: -c[3]):  # a weak guess never blocks a sure one
        accept(start, end, vram)
    # Second pass: a stretch too small (or too quiet) to place by itself usually calls functions of a stretch placed
    # already, in the same segment: try the mappings found (address minus ROM offset), counting calls that land on
    # a function start anywhere in the image.
    mappings = collections.Counter(v - s for s, _, v in found)
    frame_at = {i * 4 for i, w in enumerate(struct.unpack(f">{size // 4}I", rom[:size])) if _frame(w)}
    for lo, hi, _ in stretches:
        if any(a <= lo < b or a < hi <= b for a, b, _ in found):
            continue
        words = struct.unpack(f">{(hi - lo) // 4}I", rom[lo:hi])
        best = None
        for mapping in mappings:
            own = _jal_targets(words, mapping + lo)
            hits = sum(1 for t in own if (t - mapping) in frame_at)
            if hits >= 3 and (best is None or hits > best[0]):
                best = (hits, mapping)
        if best is None:
            continue
        mapping = best[1]
        frames = [i * 4 for i, w in enumerate(words) if _frame(w)]
        returns = [i * 4 for i, w in enumerate(words) if w == JR_RA]
        if not frames or not returns:
            continue
        start = lo + frames[0]
        end = min((lo + returns[-1] + 8 + 0xF) & ~0xF, len(rom))
        accept(start, end, start + mapping)
    return sorted(found)


def _place(rom: bytes, lo: int, hi: int, floor: int, calls: list[int],
           known: list[tuple[int, int]] = (), regions=REGIONS) -> tuple[int, int, int, int] | None:
    """(start, end, vram, calls that landed on a function start) for one stretch of code, or None."""
    words = struct.unpack(f">{(hi - lo) // 4}I", rom[lo:hi])
    frames = [i * 4 for i, w in enumerate(words) if _frame(w)]
    returns = [i * 4 for i, w in enumerate(words) if w == JR_RA]
    if len(frames) < 8 or len(returns) < 8:
        return None
    best: tuple[int, int, set[int]] | None = None  # (hits, base, the calls' targets)
    for lo_addr, hi_addr in regions:
        own = set(_jal_targets(words, lo_addr))
        votes: collections.Counter = collections.Counter()
        for t in own:
            for f in frames:
                base = t - f
                if lo_addr <= base < hi_addr and base % 4 == 0:
                    votes[base] += 1
        if votes:
            base, hits = votes.most_common(1)[0]
            if best is None or hits > best[0]:
                best = (hits, base, own)
    if best is None:
        return None
    hits, base, own = best  # the address ROM `lo` is loaded at
    if hits < max(8, len(frames) // 10):
        return None
    # the first function: the lowest address called in it (from itself or the known code). Every function returns,
    # so code before `lo` is at most a little: a stray "call" from data words can't drag the start further back.
    back = max(floor, lo - 2 * BLOCK) - lo
    called = [t - base for t in own | set(calls) if back <= t - base < hi - lo
              and not any(a <= t < b for a, b in known)]  # a call into known code says nothing about this one
    first = min([frames[0], *called])
    start = lo + first
    end = lo + returns[-1] + 8  # the last return and its delay slot
    end = min((end + 0xF) & ~0xF, len(rom))
    return (start, end, base + first, hits)


# ---------------------------------------------------------------------------------------------- compressed code

def _looks_like_code(data: bytes) -> bool:
    words = struct.unpack(f">{len(data) // 4}I", data[:len(data) // 4 * 4])
    return sum(w == JR_RA for w in words) >= 16 and sum(_frame(w) for w in words) >= 16


def _rare(rom: bytes, at: int) -> tuple[bytes, int] | None:
    """Rare's packing at `at`: 0x1172/0x1173, maybe the unpacked size (3 bytes), then a raw deflate stream.
    Returns (unpacked, packed length)."""
    for skip in (5, 2):
        d = zlib.decompressobj(-15)
        try:
            out = d.decompress(rom[at + skip:at + skip + 0x800000], 0x1000000)
        except zlib.error:
            continue
        if not d.eof or len(out) < 0x1000:
            continue
        if skip == 5 and int.from_bytes(rom[at + 2:at + 5], "big") != len(out):
            continue
        return out, skip + len(rom[at + skip:at + skip + 0x800000]) - len(d.unused_data)
    return None


def yaz0(data: bytes) -> bytes:
    """Nintendo's Yaz0: "Yaz0", the unpacked size, 8 reserved bytes, then groups of a flag byte and 8 items
    (a literal byte, or a back-reference of 2 or 3 bytes)."""
    size = int.from_bytes(data[4:8], "big")
    out = bytearray()
    src = 16
    while len(out) < size and src < len(data):
        flags = data[src]
        src += 1
        for bit in range(7, -1, -1):
            if len(out) >= size or src >= len(data):
                break
            if flags >> bit & 1:
                out.append(data[src])
                src += 1
                continue
            b1, b2 = data[src], data[src + 1]
            src += 2
            dist = ((b1 & 0x0F) << 8 | b2) + 1
            n = b1 >> 4
            if n == 0:
                n = data[src] + 0x12
                src += 1
            else:
                n += 2
            for _ in range(n):
                out.append(out[-dist])
    return bytes(out)


def _next_marker(rom: bytes, start: int) -> int:
    hits = [h for h in (rom.find(b"\x11\x72", start), rom.find(b"\x11\x73", start)) if h >= 0]
    return min(hits) if hits else -1


def unpack_code(rom: bytes) -> list[tuple[int, bytes]]:
    """(rom offset, unpacked bytes) of every compressed block in the ROM that holds code. Perfect Dark packs its game
    code as 4 KiB pages (loaded one at a time through the TLB), one after another: those are joined into one block
    before looking for code in it (one page alone can hold too little to tell)."""
    found = []
    at = _next_marker(rom, 0)
    while at >= 0:
        hit = _rare(rom, at)
        if not hit:
            at = _next_marker(rom, at + 1)
            continue
        parts, end = [hit[0]], at + hit[1]
        while len(parts[-1]) == 0x1000:  # a page: the next one may follow (after a little padding)
            nxt = _next_marker(rom, end)
            if nxt < 0 or nxt - end > 16 or not (page := _rare(rom, nxt)):
                break
            parts.append(page[0])
            end = nxt + page[1]
        blob = b"".join(parts)
        if _looks_like_code(blob):
            found.append((at, blob))
        at = _next_marker(rom, end)
    at = rom.find(b"Yaz0")
    while at >= 0:
        size = int.from_bytes(rom[at + 4:at + 8], "big")
        if 0x1000 <= size <= 0x400000 and not any(rom[at + 8:at + 16]):
            try:
                out = yaz0(rom[at:at + size * 2 + 0x100])
            except IndexError:
                out = b""
            if len(out) == size and _looks_like_code(out):
                found.append((at, out))
        at = rom.find(b"Yaz0", at + 4)
    return sorted(found)
