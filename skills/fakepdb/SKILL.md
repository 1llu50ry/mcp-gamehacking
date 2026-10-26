---
name: fakepdb
description: "FakePDB (mixaill) -- IDA Pro plugin that generates a Microsoft PDB from an IDA database so WinDbg, x64dbg, DIA SDK, and public symbol consumers can see IDA's reversed symbols. Also dumps info (JSON), finds byte signatures, imports offsets, and generates import libs. Vendored under tools/vendor/fakepdb."
metadata:
  type: tool-reference
  source: vendor/fakepdb
  topics: [fakepdb, ida-pro, pdb, symbols, windbg, x64dbg, signature, import-lib]
---

# FakePDB

IDA Pro plugin by Mikhail Paulyshka (github.com/mixaill/FakePDB, Apache-2.0). Lets you turn IDA's reversed symbols into a real `.pdb` file. Downstream tools (WinDbg, x64dbg, dnSpy, Visual Studio, Procmon) then see your IDA names as if they were real debug symbols.

## Capabilities (5 IDA actions)

- **Generate PDB** -- emits `<binary>.pdb` next to the IDB with every IDA function + global.
- **Generate PDB with function labels** -- same + inner labels.
- **Dump info (JSON)** -- functions/globals/exports to `<binary>.json`.
- **Find signature** -- IDA-style byte signature for the current cursor address.
- **Import offsets** -- re-apply an offset JSON from another build (useful on patches).
- **Generate import lib** -- produce a `.lib` for linking against the game's exports.

## Why bother

- WinDbg + public SymSrv flow still works; AC drivers resolved as if MS had shipped PDBs.
- x64dbg loads the fake PDB and shows your IDA names in the disasm pane.
- ret-sync + Ghidra parity: once the PDB is loaded in Ghidra, cross-tool work syncs.

## Install

Already vendored under `tools/vendor/fakepdb`:

```
tools/vendor/fakepdb/
├── fakepdb.py        # IDA plugin entry
└── fakepdb/
    ├── command_dumpinfo.py
    ├── command_findsignature.py
    ├── command_importoffsets.py
    ├── command_libgenerate.py
    ├── command_pdbgenerate.py
    ├── dumpinfo.py
    ├── native.py           # calls into bundled Win32 binary that writes the PDB
    ├── offsets_importer.py
    ├── signature_finder.py
    └── win32/              # fakepdb.exe (PDB emitter)
```

Install into IDA:
```powershell
Copy-Item tools\vendor\fakepdb\fakepdb.py "$env:IDAUSR\plugins\"
Copy-Item -Recurse tools\vendor\fakepdb\fakepdb "$env:IDAUSR\plugins\"
```

Then in IDA: `Edit > Plugins > FakePDB > Generate PDB`.

Headless from the CLI: `idat64 -A -S"<fakepdb/scripts/pdb_from_idb.py>" <binary>`.

## When to use

- RE'd an anti-cheat driver and want WinDbg to show your names next to crash dumps.
- Need to debug a game in x64dbg with IDA's naming.
- Working across tools (IDA for RE, Ghidra for diff, WinDbg for live KM).
- Share RE progress with a team member who prefers VS debugger.

## Related

Pairs with [[ida-pro-mcp]], [[superghidra-mcp]] (import the PDB into Ghidra), [[windbg-mcp]], [[x64dbg-mcp-server]]. See also our [[pdb70_identify]] tool for consuming generated PDBs.
