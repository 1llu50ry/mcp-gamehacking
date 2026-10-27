"""CHD disc images (rom/chd.py): read in place, a hunk at a time. Checked on a real PlayStation CHD where one is at
hand (the developer's own copy of Crash Bandicoot); the bit reader and Huffman tree everywhere."""

from pathlib import Path

import pytest

from decompnet.rom import chd, detect, psx

CRASH = Path.home() / "Downloads" / "Crash Bandicoot (USA).chd"


def test_bits_and_huffman():
    bits = chd._Bits(bytes([0b10110000, 0xFF]))
    assert bits.read(1) == 1 and bits.read(3) == 0b011 and bits.read(4) == 0 and bits.read(8) == 0xFF
    assert bits.read(8) == 0  # past the end: zeros


@pytest.mark.skipif(not CRASH.exists(), reason="needs a PlayStation CHD (the developer's own copy)")
def test_a_playstation_chd_reads_like_its_disc():
    with chd.Chd(CRASH) as disc:
        assert disc.codecs[:2] == [b"cdlz", b"cdzl"]
        image = psx._Disc(disc)
        assert image.size == 2448 and image.find("SYSTEM.CNF").startswith(b"BOOT")
    picked = detect.identify(CRASH)
    assert picked.platform == "psx" and picked.info["game_code"] == "SCUS-94900"
