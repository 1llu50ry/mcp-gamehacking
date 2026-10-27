---
name: decompile
description: Reverse-engineer software the user owns with decomp.anything. Decompile games or programs into matching C or C++, or open any other binary, app, page or firmware as an REA analysis project. Use when the user asks to decompile, decomp, reverse engineer, port or mod a game or program, or to inspect what a binary does.
---

# Reverse-engineering with decomp.anything

decomp.anything runs on the user's computer. For matchable targets it gives you the original compiler, a judge that
compares your C with the binary byte for byte, machine drafts, helper agents and a live view. Anything else opens as
an **analysis project**: REA turns its procedures into work items, and agents record findings on the same dashboard.
Its tools come from the `decomp` MCP server.

1. **decomp.anything installed?** If the `decomp` tools are unavailable, ask the user whether to install it (free,
   open source, local). From GitHub:
   `curl -fsSL https://raw.githubusercontent.com/giveen/decomp.anything/main/install/install.sh | bash` on Linux, or
   `irm https://raw.githubusercontent.com/giveen/decomp.anything/main/install/install.ps1 | iex` in PowerShell. Then
   restart this session so the tools load.
2. **The target.** Work only with the user's own copy. Never download games or point to download sites. Ask the user
   to confirm the file is theirs or that they are authorized to analyze it, then import or open it. If it is already
   there, `list_projects()` and `open_project()`.
3. **Show it.** `open_gui()` opens the live view: the work map, every agent's work, diffs and progress.
4. **Work.**
   - **Matching project:** `claim_function()` gives you a function with its assembly, notes and a machine draft;
     `compile_and_diff(function, source)` until the score is 0. Read `guide("workflow")` first. Share what you learn
     with `edit_context`, `rename_symbol` and `add_note`. Stuck after ~20 compiles: `release_function` with notes.
   - **Analysis project:** `claim_function()` gives you a procedure or task; go deeper with `rea_tool`, write findings
     with `add_note`, and finish with `complete_function(function, summary)`.
5. **Scale up.** `start_agents(count)` adds helper agents; `progress()` shows everyone's work.
6. **Deliver.** In a matching project, `export_project()` writes a normal decomp project that rebuilds the game byte
   for byte: the base for ports and mods. Analysis projects keep their findings on the work items and notes.

Report progress as functions or work items matched/analyzed. The target belongs to its rights holder: never publish
it or its code.
