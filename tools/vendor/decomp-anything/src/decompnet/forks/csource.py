"""Find and replace one function in a C or C++ source file.

Handles real definitions (including K&R and C++ `Class::method` forms) and the stubs decomp projects use for
functions that aren't decompiled yet: `INCLUDE_ASM(...)`, `GLOBAL_ASM(...)` / `#pragma GLOBAL_ASM(...)`.
"""

from __future__ import annotations

import re

_COMMENT_OR_STRING = re.compile(r'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', re.DOTALL)


def _blank(text: str) -> str:
    """Same length, with comments and strings blanked, so braces inside them don't count."""
    return _COMMENT_OR_STRING.sub(lambda m: re.sub(r"[^\n]", " ", m.group()), text)


def _stub(text: str, name: str) -> tuple[int, int] | None:
    pat = re.compile(rf"^[ \t]*(?:#\s*pragma\s+)?(?:INCLUDE_ASM|GLOBAL_ASM|INCLUDE_RODATA_FN)\s*\("
                     rf"(?:[^;\n]*[\"/,\s]){re.escape(name)}(?:\.s)?[\"\s]*\)\s*;?[ \t]*\n?", re.MULTILINE)
    m = pat.search(text)
    return (m.start(), m.end()) if m else None


def is_stub(code: str) -> bool:
    """True for an asm stub (INCLUDE_ASM / GLOBAL_ASM line) rather than a C definition."""
    return bool(re.match(r"\s*(?:#\s*pragma\s+)?(?:INCLUDE_ASM|GLOBAL_ASM|INCLUDE_RODATA_FN)\s*\(", code))


def find(text: str, name: str) -> tuple[int, int] | None:
    """(start, end) of the definition of `name`, or of its asm stub; None when absent."""
    clean = _blank(text)
    simple = name.split("::")[-1]
    if "::" in name:  # Class::method: match it exactly
        pat = re.compile(rf"(?<![\w:~]){re.escape(name)}\s*\(")
    else:  # plain name: also match a definition written as Class::name
        pat = re.compile(rf"(?<![\w:~])(?:[\w~<>]+::)*{re.escape(name)}\s*\(")
    for m in pat.finditer(clean):
        # walk to the end of the parameter list
        depth, i = 0, m.end() - 1
        while i < len(clean):
            c = clean[i]
            depth += (c == "(") - (c == ")")
            i += 1
            if depth == 0:
                break
        # a definition continues with optional qualifiers (const, throw()) or K&R parameter declarations, then '{'
        j = i
        while j < len(clean) and clean[j].isspace():
            j += 1
        if j < len(clean) and clean[j] == ";":
            continue  # a prototype or a call
        while j < len(clean) and clean[j] != "{":
            nxt = clean.find(";", j)
            brace = clean.find("{", j)
            if brace == -1:
                j = len(clean)
                break
            if nxt == -1 or brace < nxt:
                j = brace
                break
            if any(c in clean[j:nxt] for c in "(){}="):
                j = len(clean)
                break
            j = nxt + 1  # one K&R parameter declaration
        if j >= len(clean) or clean[j] != "{":
            continue
        line_start = clean.rfind("\n", 0, m.start()) + 1
        if clean[line_start:m.start()].strip().startswith(("#", "return", "if", "else")):
            continue
        # include the return type / storage class on preceding lines that belong to this declaration
        start = line_start
        prev_end = start - 1
        while prev_end > 0:
            prev_start = clean.rfind("\n", 0, prev_end) + 1
            prev = clean[prev_start:prev_end].strip()
            if prev and not prev.endswith((";", "}", "{", ")")) and not prev.startswith("#") and re.fullmatch(r"[\w\s\*&:<>,]+", prev):
                start = prev_start
                prev_end = prev_start - 1
            else:
                break
        depth, k = 0, j
        while k < len(clean):
            depth += (clean[k] == "{") - (clean[k] == "}")
            k += 1
            if depth == 0:
                break
        if k < len(text) and text[k] == "\n":
            k += 1
        return start, k
    return _stub(text, simple)


def get(text: str, name: str) -> str | None:
    span = find(text, name)
    return text[span[0]:span[1]] if span else None


def replace(text: str, name: str, code: str) -> str:
    """Put `code` in place of the function (or its stub); append it when the function isn't there yet."""
    code = code.strip("\n") + "\n"
    span = find(text, name)
    if span is None:
        return text.rstrip("\n") + "\n\n" + code
    return text[:span[0]] + code + text[span[1]:]
