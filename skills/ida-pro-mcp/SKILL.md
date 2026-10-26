---
name: ida-pro-mcp
description: "ida-pro-mcp -- lightweight MCP server for IDA Pro 8.3+ / 9 ('vibe reversing'). Agents call tools over MCP: disasm, decompile, xrefs, rename, type, bookmark, batch analyze, find, patch, patch_asm, make_signature, infer_types, idb_open/save/close/list, func_profile, callgraph, trace_data_flow, survey_binary. Deprecated in favor of the official Hex-Rays IDA MCP server."
metadata:
  type: tool-reference
  source: better-options/ida-pro-mcp-main
  topics: [mcp, ida-pro, hex-rays, reverse-engineering, agents]
---

# IDA Pro MCP

Simple MCP server that lets any MCP-capable agent drive IDA Pro 8.3+ / 9 ("vibe reversing"). IDA Free is NOT supported. Hex-Rays shipped an official server after this; the author recommends switching to it, but ida-pro-mcp remains instructive and still works.

## Supported Clients

Amazon Q Developer CLI, Augment Code, Claude, Claude Code, Cline, Codex, Copilot CLI, Crush, Cursor, Gemini CLI, Kilo Code -- any MCP-capable agent.

## Tool Surface (highlights)

- **Decompile / disasm**: `decompile`, `disasm`, `force_recompile`.
- **Lookup**: `find`, `find_bytes`, `find_regex`, `search_text`, `search_structs`, `lookup_funcs`.
- **Metadata query**: `entity_query`, `func_query`, `insn_query`, `imports_query`, `type_query`, `xref_query`, `xrefs_to`, `xrefs_to_field`.
- **Rename / annotate**: `rename`, `set_comments`, `append_comments`, `set_type`, `declare_type`, `declare_stack`, `delete_stack`, `set_op_type`, `define_func`, `define_code`, `undefine`.
- **Byte-level**: `get_bytes`, `patch`, `patch_asm`, `make_data`, `get_global_value`, `get_int`, `put_int`, `int_convert`, `get_string`, `read_struct`.
- **Signatures**: `make_signature`, `make_signature_for_function`, `make_signature_for_range`, `find_xref_signatures`.
- **Session management**: `idb_open`, `idb_save`, `idb_close`, `idb_list`, `server_health`.
- **Analysis**: `analyze_function`, `analyze_component`, `analyze_batch`, `survey_binary`, `func_profile`, `basic_blocks`, `callees`, `callgraph`, `stack_frame`, `trace_data_flow`.
- **Types**: `type_apply_batch`, `type_inspect`, `infer_types`, `enum_upsert`.
- **Exports**: `export_funcs`, `list_funcs`, `list_globals`, `imports`.

## Why

- Lets an agent navigate an IDB without a human in Hex-Rays.
- Scripts that would normally need IDAPython boilerplate collapse to natural-language asks.
- Pair with any clients MCP catalog -- no vendor-locked API.

## When to Use

- Any task where IDA's decompiler quality (Hex-Rays) beats Ghidra's.
- When FLIRT libraries, TIL type libs, or IDA plugins (Il2CppInspector, PluginSearcher) are already set up.
- When your mental model is IDAPython-shaped (segments, structs, enums, bookmarks).

## Related

Pairs with [[superghidra-mcp]] for Ghidra workflows, [[rea-reverse-engineer-anything]] for cross-tool orchestration (REA will dispatch to IDA or Hopper or Ghidra as appropriate), and [[x64dbg-mcp-server]] for dynamic analysis. Preferred by the `ida-specialist` agent.
