"""CHD disc images (MAME's "Compressed Hunks of Data", version 5): what many people keep their PlayStation discs as.

A CHD is the disc cut into hunks (here 8 CD frames of 2352 bytes + 96 of subcode each), every hunk compressed on
its own (LZMA, zlib; FLAC for audio), with a map saying where each hunk is and how it's stored (compressed with one
of four codecs, stored as is, or a copy of another hunk), itself Huffman-coded. `Chd` reads it like a file of the
uncompressed disc, decompressing only the hunks that are read: the app never needs the whole disc in memory.

Written from the format as libchdr (BSD-3-Clause) implements it. Only what the app needs: version 5, the CD codecs
(cdlz, cdzl; cdfl = audio, read as silence), and lzma, zlib for DVD images.
"""

from __future__ import annotations

import lzma
import struct
import zlib
from pathlib import Path

from .n64 import RomError

MAGIC = b"MComprHD"
CD_FRAME, CD_DATA, CD_SUB = 2448, 2352, 96
# map entry compression types
TYPE_0, TYPE_3, NONE, SELF, PARENT, RLE_SMALL, RLE_LARGE = 0, 3, 4, 5, 6, 7, 8
SELF_0, SELF_1, PARENT_SELF, PARENT_0, PARENT_1 = 9, 10, 11, 12, 13


def is_chd(head: bytes) -> bool:
    return head[:8] == MAGIC


class _Bits:
    """MSB-first bit reader; past the end it reads zeros."""

    def __init__(self, data: bytes):
        self.data, self.pos = data, 0  # pos in bits

    def peek(self, n: int) -> int:
        if n == 0:
            return 0
        byte, bit = divmod(self.pos, 8)
        chunk = int.from_bytes(self.data[byte:byte + 5].ljust(5, b"\0"), "big")
        return (chunk >> (40 - bit - n)) & ((1 << n) - 1)

    def read(self, n: int) -> int:
        v = self.peek(n)
        self.pos += n
        return v


class _Huffman:
    """libchdr's canonical Huffman decoder, with the tree imported in its RLE form (as the CHD map stores it)."""

    def __init__(self, bits: _Bits, numcodes: int = 16, maxbits: int = 8):
        self.maxbits = maxbits
        width = 5 if maxbits >= 16 else 4 if maxbits >= 8 else 3
        lengths: list[int] = []
        while len(lengths) < numcodes:
            n = bits.read(width)
            if n != 1:
                lengths.append(n)
                continue
            n = bits.read(width)
            if n == 1:
                lengths.append(1)
            else:
                lengths += [n] * (bits.read(width) + 3)
        if len(lengths) != numcodes:
            raise RomError("this CHD's map is damaged")
        histo = [0] * 33
        for n in lengths:
            histo[n] += 1
        start = 0
        for length in range(32, 0, -1):  # canonical codes, longest first
            nxt = (start + histo[length]) >> 1
            histo[length], start = start, nxt
        self.lookup = [0] * (1 << maxbits)
        for code, n in enumerate(lengths):
            if n:
                value = histo[n]
                histo[n] += 1
                shift = maxbits - n
                for i in range(value << shift, (value + 1) << shift):
                    self.lookup[i] = (code << 5) | n

    def decode(self, bits: _Bits) -> int:
        entry = self.lookup[bits.peek(self.maxbits)]
        bits.pos += entry & 0x1F
        return entry >> 5


class Chd:
    """A CHD v5 image, read as the disc it holds (seek/read/tell, like a file)."""

    def __init__(self, path: Path | str):
        self.f = open(path, "rb")  # noqa: SIM115 the Chd owns this handle for its life: close() closes it
        head = self.f.read(124)
        if not is_chd(head):
            raise RomError("this isn't a CHD image")
        version = struct.unpack(">I", head[12:16])[0]
        if version != 5:
            raise RomError(f"this CHD is version {version}: convert it with `chdman copy` (version 5), or use the .bin/.cue")
        self.codecs = [head[16 + 4 * i:20 + 4 * i] for i in range(4)]
        self.logical = struct.unpack(">Q", head[32:40])[0]
        map_offset = struct.unpack(">Q", head[40:48])[0]
        self.hunkbytes, self.unitbytes = struct.unpack(">II", head[56:64])
        if any(head[84 + 20:84 + 40]):  # parent SHA-1: it only holds what differs from another image
            raise RomError("this CHD needs its parent image (a delta of another CHD): use a standalone one")
        self.hunks = -(-self.logical // self.hunkbytes)
        self.map = self._read_map(map_offset) if any(self.codecs) else None
        self.pos = 0
        self._cache: dict[int, bytes] = {}

    def _read_map(self, offset: int) -> list[tuple[int, int, int]]:
        """(type, length, offset) per hunk."""
        self.f.seek(offset)
        hdr = self.f.read(16)
        mapbytes = struct.unpack(">I", hdr[0:4])[0]
        first = int.from_bytes(hdr[4:10], "big")
        lengthbits, selfbits, parentbits = hdr[12], hdr[13], hdr[14]
        bits = _Bits(self.f.read(mapbytes))
        huff = _Huffman(bits)
        types, last, rep = [], 0, 0
        for _ in range(self.hunks):
            if rep:
                types.append(last)
                rep -= 1
                continue
            v = huff.decode(bits)
            if v == RLE_SMALL:  # this hunk and `rep` more are like the last one
                rep = 2 + huff.decode(bits)
                types.append(last)
            elif v == RLE_LARGE:
                rep = 2 + 16 + (huff.decode(bits) << 4)
                rep += huff.decode(bits)
                types.append(last)
            else:
                last = v
                types.append(v)
        out, cur, last_self, last_parent = [], first, 0, 0
        for n, t in enumerate(types):
            length, off = 0, cur
            if t <= TYPE_3:
                length = bits.read(lengthbits)
                cur += length
                bits.read(16)  # crc
            elif t == NONE:
                length = self.hunkbytes
                cur += length
                bits.read(16)
            elif t == SELF:
                last_self = off = bits.read(selfbits)
            elif t == PARENT:
                last_parent = off = bits.read(parentbits)
            elif t in (SELF_0, SELF_1):
                last_self += t == SELF_1
                t, off = SELF, last_self
            elif t == PARENT_SELF:
                t, off = PARENT, n * self.hunkbytes // self.unitbytes
                last_parent = off
            elif t in (PARENT_0, PARENT_1):
                if t == PARENT_1:
                    last_parent += self.hunkbytes // self.unitbytes
                t, off = PARENT, last_parent
            out.append((t, length, off))
        return out

    # ------------------------------------------------------------------ hunks

    def hunk(self, n: int) -> bytes:
        if n in self._cache:
            return self._cache[n]
        data = self._hunk(n, 0)
        if len(self._cache) > 64:
            self._cache.pop(next(iter(self._cache)))
        self._cache[n] = data
        return data

    def _hunk(self, n: int, depth: int) -> bytes:
        if self.map is None:  # uncompressed image
            self.f.seek(n * self.hunkbytes)
            return self.f.read(self.hunkbytes).ljust(self.hunkbytes, b"\0")
        t, length, off = self.map[n]
        if t == SELF:
            if depth > 8 or off == n:
                raise RomError("this CHD's map is damaged")
            return self.hunk(off) if off in self._cache else self._hunk(off, depth + 1)
        if t == PARENT:
            raise RomError("this CHD needs its parent image")
        self.f.seek(off)
        raw = self.f.read(length)
        if t == NONE:
            return raw
        return self._decode(self.codecs[t], raw)

    def _decode(self, codec: bytes, src: bytes) -> bytes:
        size = self.hunkbytes
        if codec == b"zlib":
            return zlib.decompress(src, -15).ljust(size, b"\0")
        if codec == b"lzma":
            return _lzma(src, size)
        if codec in (b"cdlz", b"cdzl", b"cdfl"):
            frames = size // CD_FRAME
            n_len = 2 if size < 65536 else 3
            ecc = (frames + 7) // 8
            base_len = int.from_bytes(src[ecc:ecc + n_len], "big")
            start = ecc + n_len
            if codec == b"cdlz":
                data = _lzma(src[start:start + base_len], frames * CD_DATA)
            elif codec == b"cdzl":
                data = zlib.decompress(src[start:start + base_len], -15).ljust(frames * CD_DATA, b"\0")
            else:  # FLAC: CD audio, which nothing here reads
                data = bytes(frames * CD_DATA)
            try:
                sub = zlib.decompress(src[start + base_len:], -15).ljust(frames * CD_SUB, b"\0")
            except zlib.error:
                sub = bytes(frames * CD_SUB)
            out = bytearray()
            for i in range(frames):
                out += data[i * CD_DATA:(i + 1) * CD_DATA] + sub[i * CD_SUB:(i + 1) * CD_SUB]
            return bytes(out)
        raise RomError(f"this CHD uses the {codec.decode('ascii', 'replace')} codec, which decomp.wtf can't read "
                       "yet: convert it with `chdman extractcd` to .bin/.cue")

    # ------------------------------------------------------------------ file-like

    def seek(self, pos: int, whence: int = 0) -> int:
        self.pos = pos if whence == 0 else self.pos + pos if whence == 1 else self.logical + pos
        return self.pos

    def tell(self) -> int:
        return self.pos

    def read(self, n: int = -1) -> bytes:
        if n < 0:
            n = self.logical - self.pos
        out = bytearray()
        while n > 0 and self.pos < self.logical:
            h, at = divmod(self.pos, self.hunkbytes)
            chunk = self.hunk(h)[at:at + n]
            out += chunk
            self.pos += len(chunk)
            n -= len(chunk)
        return bytes(out)

    def close(self) -> None:
        self.f.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def _lzma(src: bytes, size: int) -> bytes:
    """CHD's LZMA: raw LZMA1 (lc 3, lp 0, pb 2), no end marker, decoded to the hunk's size."""
    dec = lzma.LZMADecompressor(lzma.FORMAT_RAW, filters=[{"id": lzma.FILTER_LZMA1, "lc": 3, "lp": 0, "pb": 2,
                                                            "dict_size": 1 << 24}])
    return dec.decompress(src, max_length=size).ljust(size, b"\0")
