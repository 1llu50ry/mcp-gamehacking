"""Check the ROM, extract the targets, write build.ninja and objdiff.json."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

from decompnet import toolchains

ROOT = Path(__file__).resolve().parent
SHA1 = json.loads((ROOT / ".decomp.wtf.json").read_text())["game"]["sha1"]
UNITS = ["game"]


def main() -> int:
    rom = ROOT / "baserom.z64"
    if not rom.exists() or hashlib.sha1(rom.read_bytes()).hexdigest() != SHA1:
        sys.exit("baserom.z64 is missing or isn't Demo Quest 64")
    tc = toolchains.get("gcc-2.7.2-kmc")
    tc_dir = toolchains.require(tc.id)
    cc = [a.replace("{tc}", str(tc_dir)) for a in tc.cc] + tc.flags
    (ROOT / "build" / "expected").mkdir(parents=True, exist_ok=True)
    for unit in UNITS:  # "extract" the targets
        subprocess.run([*cc, "-I", str(ROOT / "include"), str(ROOT / "tools" / "reference" / f"{unit}.c"),
                        "-o", str(ROOT / "build" / "expected" / f"{unit}.o")], check=True, capture_output=True)
    ninja = ["rule cc", f"  command = {' '.join(cc)} -Iinclude $in -o $out", "  description = cc $in", ""]
    for unit in UNITS:
        ninja.append(f"build build/src/{unit}.o: cc src/{unit}.c | include/game.h")
    ninja.append("")
    (ROOT / "build.ninja").write_text("\n".join(ninja))
    (ROOT / "objdiff.json").write_text(json.dumps({
        "custom_make": "ninja",
        "build_base": True,
        "units": [{"name": unit, "target_path": f"build/expected/{unit}.o", "base_path": f"build/src/{unit}.o",
                   "metadata": {"source_path": f"src/{unit}.c", "complete": False},
                   "scratch": {"platform": "n64", "compiler": "gcc2.7.2kmc", "c_flags": " ".join(tc.flags)}}
                  for unit in UNITS],
    }, indent=2))
    print("configured: run ninja")
    return 0


if __name__ == "__main__":
    sys.exit(main())
