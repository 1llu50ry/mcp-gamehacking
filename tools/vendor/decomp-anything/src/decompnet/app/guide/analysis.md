# Analysis projects

An analysis project is any target REA can open — a native binary, an APK, a .NET assembly, a JavaScript app, a
firmware image, an archive — turned into the same project dashboard as a game. There is no compiler and no match
score. Each work item is a procedure, a regular file inside an archive, or a task the user added. An agent's job is
to understand it and leave a precise finding.

An archive project is one level of that: `claim_function()` gives you a file, `read_artifact_entry` reads it in place,
and `complete_function` records the finding. The user can analyze a binary or nested archive from **Contents** as a
linked child project; child findings are rolled into the parent's `SUMMARY.md`. Do not extract the whole archive or
open a child yourself: read the claimed entry within its limits.

## The loop

1. `claim_function()` gives you the next work item. For a procedure you get REA's dossier: signature, pseudocode,
   assembly, callers and referenced strings/names. For an archive file you get its path, size, type and the
   `read_artifact_entry` hint. The `survey` item gets the target overview, memory map and pseudocode for a few
   starting functions (entry points, then the largest). A native task whose brief names addresses gets those
   functions decompiled in one batch, so you can start from code instead of searching for it.
2. Read the dossier before calling more tools. It often answers the question on its own.
3. Go deeper with `rea_tool(tool, arguments)`. Useful tools:
   - `search_strings {"pattern": "..."}` and `search_procedures {"pattern": "..."}`: find things by name or text.
   - `analyze_function {"procedure": "0x401000"}`: a full dossier for any procedure.
   - `xrefs {"address": "0x..."}`: who references an address.
   - `procedure_callers` / `procedure_callees {"procedure": "..."}`: the local call graph.
   - `list_segments {}` and `read_bytes {"address": "0x...", "length": 64}`: memory layout and raw bytes.
   - `inspect_native_api {"procedure": "..."}`: imported Windows/Linux APIs and their arguments.
   - `trace_feature {"query": "..."}`: every string and procedure matching a literal, with their xrefs.
   - `trace_call_path {"start": "0x401000", "goal": "0x402000"}`: the shortest direct-call path; omit `goal`
     for everything reachable from `start`.
   - `get_call_graph {"address": "0x401000", "direction": "forward"}`: the whole callee (`forward`) or caller
     (`backward`) graph around one function.
   - `trace_native_values {"procedure": "0x401000"}`: bounded def-use, constants and call bindings in a function.
   - `batch_decompile {"addresses": ["0x401000", "0x401080"]}`: pseudocode for several procedures in one call.
   - `search_bytes {"pattern": "48 8b ?? 05"}`: masked byte search in initialized memory (Ghidra only).

   The trace and graph tools are for native targets. A JavaScript or Electron project uses **Trace a feature**
   in the project instead, which walks the application graph.
4. Write while you work: `add_note(text, function)` for anything the next agent should know.
5. Finish with `complete_function(function, summary)`. The summary is required: what the item does, its inputs and
   outputs, what it calls, the data it touches, and anything surprising. It is saved on the item and in the project's
   notes. When you reconstructed its code too, save it first with `write_source(function, source)`.
6. If the item is too large or needs a decision you can't make, `release_function(function, notes)` with what you
   tried and what is left.

## Tasks

The user can add a task without an address (for example "map the network protocol" or "find the update check"). A
task comes with the user's brief; follow it and finish with a summary. Tasks are not procedures, so `rea_tool` is
where the work happens.

## Recovered code

When the evidence supports it, you can save the code you reconstructed for a procedure or task with
`write_source(function, source)`. It lands in `recovered/functions/` (or `recovered/tasks/`), the item is marked
analyzed, and any finding it already had is kept. The code is labelled **reconstructed**: there is no byte-exact
reference for an analyzed target, so nothing here is verified. Never call it the original source.

Base the code on what REA showed you (pseudocode, assembly, callers, referenced strings) and say what you based it
on in a note or the finding. If the reconstruction is partial or guesses at a structure, say which parts are guesses.
An app or archive project can also ask you to reconstruct a module: those items say so in their brief and use the
same tool.

## What counts as a good finding

- What the code does, in plain language, and where it sits in the program.
- Its contract: arguments, return value, side effects, error paths.
- The data it reads or writes, with addresses when they matter.
- Calls that identify the subsystem (network, files, crypto, UI) and any hard-coded strings or constants.
- Unknowns: say what you could not determine, and why (missing library, indirect call, stripped symbols).

Keep findings factual. Do not guess at a name or behavior you did not observe; say it is a hypothesis.
