"""Fetch zlib 1.1.4 from zlib.net (pinned sha256) into original/, and build the shared headers
(context.h) for the two DecompNet projects made from it: zlib-deflate and zlib-inflate.

zlib's license allows use, alteration and redistribution (see LICENSE.zlib). The original source stays
on the coordinator to build the target objects; agents only see compiled code and context.h.
Run once before importing:  python3 -I projects/zlib-1.1.4/prepare.py
"""

import hashlib
import io
import pathlib
import re
import tarfile
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
URL = "https://zlib.net/fossils/zlib-1.1.4.tar.gz"
SHA256 = "9e3e973174f9910fd51539ef9ce94c86a3943d4f897fab8e9adf4b19e6a8291e"
CORE = ["adler32.c", "compress.c", "crc32.c", "deflate.c", "infblock.c", "infcodes.c", "inffast.c", "inflate.c",
        "inftrees.c", "infutil.c", "trees.c", "uncompr.c", "zutil.c"]
# zlib has two different `struct internal_state`s (compression vs decompression) and per-file macros and
# typedefs, so each source file (unit) gets its own header: the headers it includes plus its declarations.

def fetch() -> pathlib.Path:
    out = HERE / "original"
    if (out / "zlib.h").exists():
        return out
    data = urllib.request.urlopen(URL, timeout=60).read()
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise SystemExit("checksum mismatch: refusing to use this archive")
    out.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for m in tar.getmembers():
            name = pathlib.PurePosixPath(m.name).name
            if m.isfile() and (name.endswith((".c", ".h")) or name == "README"):
                (out / name).write_bytes(tar.extractfile(m).read())
    return out


def strip_comments(text: str) -> str:
    return re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group().count("\n"), text, flags=re.S)


def declarations_only(text: str) -> str:
    """Keep a C file's preprocessor lines, typedefs, structs and prototypes; drop function bodies and data
    initializers (data becomes `extern`). `local` (static) is dropped so a function compiled on its own can
    reference its neighbours by name. Relies on zlib's layout: function bodies open with `{` and close with
    `}` alone at column 0, and K&R parameter declarations are indented."""
    lines = strip_comments(text).split("\n")
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("#"):
            if not re.match(r'\s*#\s*include\s+"', line):
                out.append(line)
                while line.rstrip().endswith("\\") and i + 1 < len(lines):  # multi-line macro
                    i += 1
                    line = lines[i]
                    out.append(line)
            i += 1
            continue
        if stripped in ('extern "C" {', "}"):  # C++ linkage wrapper (inside #ifdef __cplusplus): not C
            i += 1
            continue
        if _is_function_header(lines, i):
            j = i + 1
            while lines[j].strip() != "{":
                j += 1
            k = j + 1
            while lines[k].rstrip() != "}":
                k += 1
            i = k + 1
            continue
        # a top-level declaration: gather until `;` with balanced braces
        chunk, depth, j = [], 0, i
        while j < len(lines):
            chunk.append(lines[j])
            depth += lines[j].count("{") - lines[j].count("}")
            if depth <= 0 and lines[j].rstrip().endswith(";"):
                break
            j += 1
        out.append(clean("\n".join(chunk)))
        i = j + 1
    return "\n".join(x for x in out if x and x.strip())


def _is_function_header(lines: list[str], i: int) -> bool:
    """A column-0 line with a parameter list that is followed (after K&R parameter lines) by `{` alone."""
    line = lines[i]
    if not line or line[0].isspace() or "(" not in line or line.rstrip().endswith(";"):
        return False
    if re.match(r"(typedef|struct|union|enum|extern|#)\b", line) or "=" in line.split("(")[0]:
        return False
    for t in lines[i + 1:i + 16]:
        t = t.strip()
        if t == "{":
            return True
        # K&R parameter declarations (`z_streamp z;`, sometimes unindented) or a wrapped parameter list
        if t and not (t.endswith((";", ",", ")")) or t.startswith("#")):
            return False
    return False


def _top_level_eq(d: str) -> int:
    depth = 0
    for i, ch in enumerate(d):
        depth += ch in "({["
        depth -= ch in ")}]"
        if ch == "=" and depth == 0:
            return i
    return -1


def clean(decl: str) -> str:
    d = decl.strip()
    if re.fullmatch(r"struct\s+\w+\s*\{\s*int\s+dummy;\s*\}\s*;", d):   # "for buggy compilers" placeholders
        return ""
    if re.match(r"(typedef\b|struct\s+\w+\s*\{|union\b|enum\b)", d):        # type definitions: verbatim
        return d
    eq = _top_level_eq(d)
    if eq >= 0 and not d.startswith("typedef"):                            # drop scalar/string initializers
        d = d[:eq].rstrip() + ";"
        if not d.startswith(("local ", "extern ")):
            d = "extern " + d
    if d.startswith("local "):
        d = d[len("local "):]
        if "(" not in d.split("=")[0] or re.search(r"\(\s*\*", d):     # data, not a prototype
            d = "extern " + d
    elif re.match(r"(const\s+)?\w[\w\s\*]*\[", d) and not d.startswith(("typedef", "extern")):
        d = "extern " + d
    return d


def prototype(head: str) -> str:
    """Nothing: zlib already declares every function before defining it (OF() prototypes)."""
    return ""


def expand(src: pathlib.Path, name: str, seen: set[str]) -> str:
    """Inline #include "..." files at the point they are included, as the preprocessor does, so macro
    state (e.g. zutil.h defining _Z_UTIL_H before including zlib.h) is exactly what the compiler saw."""
    out = []
    for line in (src / name).read_text(errors="replace").split("\n"):
        m = re.match(r'\s*#\s*include\s+"([^"]+)"', line)
        if m and (src / m.group(1)).exists():
            if m.group(1) not in seen:
                seen.add(m.group(1))
                out.append(f"/* ---- {m.group(1)} ---- */\n" + expand(src, m.group(1), seen))
            continue
        out.append(line)
    return "\n".join(out)


def header_text(src: pathlib.Path, h: str) -> str:
    return re.sub(r'^\s*#\s*include\s+"[^"]+"\s*$', "", (src / h).read_text(errors="replace"), flags=re.M)


def main() -> None:
    src = fetch()
    banner = ("/* zlib 1.1.4 built for N64 with GCC 2.7.2.\n"
              " * zlib (C) 1995-2002 Jean-loup Gailly and Mark Adler, zlib license (LICENSE.zlib).\n")
    # project-wide fallback: the public API
    (HERE / "include" / "context.h").write_text(banner + " * Public API only; each source file has its own header in units/. */\n"
                                               + "".join(f"\n/* ---- {h} ---- */\n{header_text(src, h)}" for h in ("zconf.h", "zlib.h")))
    for c in CORE:
        body = declarations_only(expand(src, c, set()))
        dest = HERE / "units" / f"{pathlib.Path(c).stem}.h"
        dest.write_text(banner + f" * Header for {c}: everything it includes, inlined, plus its own declarations"
                        " (no function bodies). */\n" + body + "\n")
    print(f"units/: {len(CORE)} headers")


if __name__ == "__main__":
    main()
