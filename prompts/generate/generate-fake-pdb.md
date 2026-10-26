---
name: generate-fake-pdb
description: Generate a fake Microsoft PDB from an IDA database using FakePDB (vendored)
arguments:
  - name: binary
    description: Path to the target binary (.exe/.dll/.sys)
    required: true
  - name: with_labels
    description: Include inner function labels in the PDB
    required: false
---

# Generate Fake PDB

Turn your IDA reversed symbols into a Microsoft PDB so WinDbg, x64dbg, dnSpy, VS debugger, and Procmon all see your names.

## Steps

1. `fakepdb_install` -- copies the vendored plugin into IDAUSR/plugins (one-shot).
2. Open the IDB in IDA (so the names + types are current) OR run headless (step 3).
3. `fakepdb_run binary=<path> mode=pdb` (or `pdb-labels` for inner labels, `dumpinfo` for JSON, `lib` for an import library).
4. Resulting `<binary>.pdb` sits next to the IDB. Point WinDbg's symbol path at the directory and `.reload /f`.

## Downstream

- **WinDbg**: `.sympath+ <dir>` + `.reload /f <binary>` -- shows your IDA names.
- **x64dbg**: symbol auto-loads from the binary's directory.
- **Ghidra**: `File > Load PDB File` (requires PDB-aware build).
- **ret-sync**: cursor syncs between IDA and the live debugger.

## Related Skills

- [[fakepdb]]
- [[ida-pro-mcp]]
- [[windbg-mcp]]
- [[x64dbg-mcp-server]]
- [[pdb70_identify]] (parse the output)
