# Vertical: CTF / exploit development

The `pwndbg-mcp` + `gef-mcp` + `angr-mcp` + `aflplusplus-mcp` + `honggfuzz-mcp` + `libafl-mcp` + `unicorn-mcp` + `qiling-mcp` + `retsync-mcp` backends cover the standard CTF toolbelt.

## Workflows

- **Binary pwn**: `analyze_binary` → `pe_debug_dir` / `elf_parse` for GOT/PLT → `pwndbg-mcp` / `gef-mcp` for live.
- **Reverse chall**: `superghidra-mcp` / `ida-pro-mcp` static → `angr-mcp` symbolic for input constraints.
- **Crypto chall**: `hash_identify` + `angr-mcp` for key recovery.
- **Fuzzing**: `aflplusplus-mcp` / `honggfuzz-mcp` / `winafl-mcp`.
- **Shellcode**: `signature_make` + `capstone-mcp` + `unicorn-mcp`.

## Skills to add

- `rop-chain-primer`
- `heap-exploit-families`
- `format-string-sheet`
- `kernel-pwn-primer`
- `syscalls-table-reference`
- `pwn-primitives-cheatsheet`
- `canary-stack-bypass`
