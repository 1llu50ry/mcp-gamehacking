"""Names for addresses in a ROM project.

Every address splat found has an automatic name that carries its address (func_80001234,
D_80012340, jtbl_...). Users and agents rename them as they learn what things are; the table
maps every name, automatic or chosen, back to its address. Matching works on addresses, so a
rename never breaks a match.
"""

from __future__ import annotations

import bisect
import re
from dataclasses import dataclass

# Automatic names spell their address: splat/spimdisasm (func_, D_...), luvdis and pret (sub_, gUnknown_), IDA style.
AUTO_NAME = re.compile(r"^(?:func|D|B|jtbl|L|RO|STR|FLT|DBL|bss|data|sub|gUnknown|unk|off|dword|word|byte|loc)_([0-9A-Fa-f]{8})$")
IDENT = re.compile(r"^[A-Za-z_]\w*$")


@dataclass
class Symbol:
    name: str
    address: int
    size: int = 0
    kind: str = "data"  # func | data | string | jtbl | bss
    preview: str = ""  # for strings and data rows in the GUI


class SymbolTable:
    def __init__(self, symbols: list[Symbol] | None = None):
        self.by_name: dict[str, Symbol] = {}
        self.by_addr: dict[int, Symbol] = {}
        self._starts: list[int] = []
        for s in symbols or []:
            self.add(s, reindex=False)
        self._reindex()

    def _reindex(self) -> None:
        self._starts = sorted(self.by_addr)

    def add(self, sym: Symbol, reindex: bool = True) -> None:
        # Keep every name: Windows images routinely give one address an exported name, a symbol-table
        # name and a linker alias (__data_start__), and all of them have to resolve.
        self.by_name[sym.name] = sym
        old = self.by_addr.get(sym.address)
        # One address, several names: keep the most useful as the display name (g_counter over the linker's
        # __data_start__, a function over an alias) while every alias still resolves.
        def rank(s):
            return (not s.name.startswith("__"), s.kind == "func", len(s.name))
        if old is None or rank(sym) > rank(old):
            self.by_addr[sym.address] = sym
        if reindex:
            self._reindex()

    def rename(self, old: str, new: str) -> Symbol:
        sym = self.by_name.pop(old)
        sym.name = new
        self.by_name[new] = sym
        return sym

    def resolve(self, name: str) -> int | None:
        """Address for a name: a known symbol, or an automatic name like D_80012340."""
        sym = self.by_name.get(name)
        if sym is not None:
            return sym.address
        m = AUTO_NAME.match(name)
        return int(m.group(1), 16) if m else None

    def name_at(self, address: int) -> tuple[str, int]:
        """(name, offset) for an address: an exact symbol, the symbol that contains it, or an automatic name."""
        sym = self.by_addr.get(address)
        if sym is not None:
            return sym.name, 0
        i = bisect.bisect_right(self._starts, address) - 1
        if i >= 0:
            start = self._starts[i]
            sym = self.by_addr[start]
            if address < start + sym.size:
                return sym.name, address - start
        return f"D_{address:08X}", 0

    def next_after(self, address: int) -> int | None:
        """The first symbol's address above `address` (where the ROM's next datum starts, as splat labels it)."""
        i = bisect.bisect_right(self._starts, address)
        return self._starts[i] if i < len(self._starts) else None

    def label(self, address: int) -> str:
        name, off = self.name_at(address)
        return f"{name}+0x{off:X}" if off else name
