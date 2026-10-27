# decomp.anything

**Point an AI agent at something you own and take it apart.** decomp.anything is a matching-decompilation and
reverse-engineering workbench for games, Windows and Linux programs, apps, web pages, firmware and plain files.
Agents write C or C++ against the real binary, the original compiler builds it, and the result is checked byte for byte —
or, when there is no original build to match, the same project opens the binary with REA and agents analyze its
functions instead.

<p align="center">
  <a href="https://github.com/i12bp8/decomp.wtf">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.png">
      <img alt="decomp.anything builds on decomp.wtf: your AI agent decompiles software you own into C that compiles to the exact same bytes." src=".github/assets/banner-light.png">
    </picture>
  </a>
</p>

<p align="center">
  <a href="#install"><b>Install</b></a>
  &nbsp;·&nbsp;
  <a href="#how-matching-works"><b>How matching works</b></a>
  &nbsp;·&nbsp;
  <a href="#inspect-anything"><b>Inspect anything</b></a>
  &nbsp;·&nbsp;
  <a href="#continue-a-public-decomp"><b>Public decomps</b></a>
  &nbsp;·&nbsp;
  <a href="#agents"><b>Agents</b></a>
  &nbsp;·&nbsp;
  <a href="#decompile-together"><b>Decompile together</b></a>
  &nbsp;·&nbsp;
  <a href="#built-on"><b>Built on</b></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-157a49?style=flat-square"></a>
  <img alt="Linux and Windows" src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20(WSL%202)-15140f?style=flat-square">
  <img alt="Python 3.12 or newer" src="https://img.shields.io/badge/python-3.12%2B-15140f?style=flat-square">
  <img alt="Works with any MCP agent" src="https://img.shields.io/badge/agents-any%20MCP%20client-157a49?style=flat-square">
</p>

## Fork of decomp.wtf

decomp.anything is an independent fork of **[decomp.wtf](https://github.com/i12bp8/decomp.wtf)** by Sam Wolfs. The
upstream project is discontinued, but its code is MIT licensed, so this fork continues it and extends it. This
repository is the active continuation.

Where decomp.wtf focused on matching retro games, decomp.anything extends the same engine to arbitrary software:
Windows and Linux binaries can be matched byte for byte, and anything else opens as an **REA project** — the same
project dashboard, agents and notes, with its procedures as work items. There is no separate REA mode to learn.

What stays from decomp.wtf:

- the split → claim → write C or C++ → compile with the original compiler → link at the real address → compare byte for byte
  workflow;
- the matching engine and matchers for MIPS, PowerPC, ARM, x86 and x86-64;
- the live view, autopilot, permuter, shared knowledge, helper agents and rebuildable exports;
- continuation of public decomp projects, judged with objdiff;
- the installers, toolchain registry and local-first design: no account, no telemetry, nothing uploaded.

What this fork adds:

- **[RE console](#inspect-anything):** a graphical front end for [REA](https://rea.tools)'s tool catalog, opened from
  a procedure work item (or a PC function). Browse native binaries, Android apps, .NET assemblies, JavaScript and
  Electron apps, web pages, firmware and plain files; functions, pseudocode, strings, flow graphs and call graphs,
  plus a generated form for every REA tool.
- **Linux targets:** x86 and x86-64 ELF executables and shared libraries import and match like Windows programs.
- **Windows targets:** 32-bit and 64-bit PE executables and DLLs, with a relocation-aware x86 matcher.
- **REA for agents:** `inspect_binary` can ask REA for pseudocode, signatures and callers; REA itself can be installed
  from **Compilers & tools**.
- **Reference folders:** point an agent at a matched decomp, notes or symbol lists; it can read and search them.
- **opencode 2** support for helper agents and `decomp connect`.

Matching is still the byte-exact path. Every binary opens as a normal project: matchable targets get the compile-and-
compare loop, and everything else gets REA work items, the same agents, the same dashboard and findings instead.

## What you can do

| Goal | What decomp.anything gives you |
| :-- | :-- |
| **Decompile a game** | Drop in a ROM, disc image or program file. Agents claim functions, write C or C++, and the original compiler proves each match byte for byte. |
| **Match a PC program** | Import a Windows `.exe`/`.dll` or a Linux ELF program or `.so`, write C or C++, and compare the compiler's bytes with the original's. |
| **Continue a public decomp** | Fork one of the community projects the app knows about and let agents carry on in the project's real source tree. |
| **Inspect anything else** | Drop it like a game. If this app can't split or match it, REA opens it in a normal project: its procedures become work items, agents read them in parallel, and their findings land on the same dashboard. Add tasks for areas with no procedure of their own. |
| **Look inside an archive** | Drop a ZIP, TAR or similar archive. Every regular file is a work item; **Contents** previews it, and a binary or nested archive can open as a linked child project. |
| **Work together** | Host a room, invite people, and share matches, names, structs and notes without sharing the original file. |
| **Use your own agent** | Claude Code, Codex, Antigravity CLI, opencode, an OpenAI-compatible endpoint, or any MCP client. |

Everything runs on your computer. No account, no telemetry, nothing uploaded.

## Install

decomp.anything runs on **Linux x86-64** and, through **WSL 2**, on Windows. macOS isn't supported. It needs
Python 3.12 or newer and [uv](https://docs.astral.sh/uv/). Node.js is needed for npm-based agents and for REA; Java
21 or newer is needed for Ghidra.

**From this repository:**

```bash
git clone https://github.com/giveen/decomp.anything.git
cd decomp.anything
uv sync
uv run decomp
```

That starts the app and opens it in your browser. Projects live in `~/Decomp` by default; set `DECOMP_HOME` to put
them elsewhere.

**Desktop install from the checkout.** The repository's own installers install this checkout, not the upstream
release:

```bash
bash install/install.sh
```

On Windows, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File install\install.ps1
```

The Windows installer turns on WSL 2 if needed, creates the `decomp-wtf` distribution, installs this checkout inside
it, and adds a `decomp` command plus app-menu and desktop shortcuts. Checkout installs record this repository as their
update source, so updates follow decomp.anything rather than upstream.

**From GitHub, without a website:**

```bash
curl -fsSL https://raw.githubusercontent.com/giveen/decomp.anything/main/install/install.sh | bash
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/giveen/decomp.anything/main/install/install.ps1 | iex
```

Those follow `main` by default. Add `DECOMP_SOURCE` or `DECOMP_BRANCH` to install a branch, or run the checkout
installer to install a local tree.

Open **Compilers & tools** to install what a target needs. The period compilers are pinned and checksum-verified;
proprietary ones (IDO, CodeWarrior) are only installed after you accept their license. REA and Ghidra are optional.

> [!TIP]
> No ROM at hand? The app ships with **Demo Quest 64**, a real N64 ROM built from public-domain code and zlib.
> Open it from the home screen and watch an agent go.

## Ask your agent

Already using Claude Code, Codex, Antigravity CLI or opencode? Give it decomp.anything's tools once:

```bash
decomp connect
```

Then ask in your own terminal:

> decompile my game at ~/roms/game.z64

or, for something that isn't a game:

> work on the binary at ~/bin/app.apk: map its classes and exported components

The agent imports or opens the target, shows the live view, and uses the same tools you do. Behind it is
`decomp mcp`, an MCP server that starts the app when needed. You can register it yourself:

```bash
claude mcp add decomp -- decomp mcp
```

| Agent | Install it as a package instead |
| :-- | :-- |
| **Claude Code** | `/plugin marketplace add giveen/decomp.anything`, then `/plugin install decomp-anything@decomp-anything` (adds a "decompile" skill) |
| **Codex, Antigravity CLI, opencode** | `decomp connect codex`, `decomp connect antigravity`, `decomp connect opencode` |

## How matching works

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/how-dark.png">
    <img alt="The target is split into functions. The agent writes C, the original compiler builds it, it is linked at its real address and compared byte for byte. If it doesn't match, the diff goes back to the agent." src=".github/assets/how-light.png">
  </picture>
</p>

1. **Split the target.** splat and spimdisasm find game functions and data; the PE reader does the same for Windows
   programs from `.pdata`, symbols, exports and calls; the ELF reader uses the symbol table or `.eh_frame`. Other
   tools cover GameCube/Wii, DS, GBA and PlayStation targets.
2. **Add agents.** Each agent claims a different function and gets its assembly, the data it touches, callers, a
   machine-made draft and notes from earlier attempts.
3. **Compile and compare.** Every attempt is compiled with the original compiler and linked at the function's real
   address, or judged by objdiff inside the project's own build. A miss returns an instruction diff; a hit is saved,
   named and shared with every other agent.

Score 0 means the bytes match. There is no approximate success.

**When a match isn't possible, the code is still recovered.** A function that can't be built byte-exactly — the
original compiler is proprietary or gone, or the target was patched past what the split describes — can be
reconstructed by an agent with `write_source`. The code goes into the project's `recovered/` tree, is labelled
reconstructed and unverified, and never counts as a match: **Overview → Sources** keeps verified matches and
reconstructions apart, and **Export sources** writes the tree with a `RECONSTRUCTION.md` that names every verified,
reconstructed and still-missing function. A later byte-exact match replaces the reconstruction.

<p align="center">
  <img alt="decomp.anything at work: agents claim functions, attempts drop to score 0, and the map turns green." src=".github/assets/demo.webp" width="900">
  <br>
  <sub>The original decomp.wtf simulation, running on the demo ROM that ships with the app.</sub>
</p>

<details>
<summary><b>What a match looks like</b></summary>
<br>

The assembly taken from the target:

```asm
800007D0  slt     $v0, $a0, $a1
800007D4  bnez    $v0, .L800007EC
800007D8   addu   $v0, $a1, $zero
800007DC  addu    $v0, $a2, $zero
800007E0  slt     $v1, $v0, $a0
800007E4  beql    $v1, $zero, .L800007EC
800007E8   addu   $v0, $a0, $zero
.L800007EC:
800007EC  jr      $ra
800007F0   nop
```

The C an agent wrote, which compiles to exactly those bytes with KMC GCC 2.7.2 at `-O2`:

```c
s32 clamp_s32(s32 v, s32 lo, s32 hi) {
    if (v < lo) {
        return lo;
    }
    if (v > hi) {
        return hi;
    }
    return v;
}
```

</details>

## Inspect anything

A binary that isn't a game or a matchable program still opens as a **project**, not a separate mode: the normal
picker falls back to REA, its procedures become work items, and agents claim them exactly like functions in a game.
The project dashboard shows analyzed items, findings, agent output and the live map; **Add task** covers areas that
have no procedure of their own.

An **archive** is a project too (ZIP, TAR and their common variants). REA inventories it and the **Contents**
panel shows the tree with a preview of each file. Code that shipped as text — JavaScript, Python, C, Java, HTML,
CSS, shell and the rest — is extracted byte for byte into the project's `recovered/` tree (verified, never
reconstructed), so a ZIP of sources opens as code rather than as prose to write about. Compiled entries whose source
didn't ship (`.pyc`, `.class`, `.luac`, …) become reconstruction work items, as does any text source the archive
can't decode; everything else stays a regular work item. Analyze a binary or a nested archive from Contents to
extract only that entry and open it as a linked child project; child targets appear under their parent in the
sidebar, and their findings roll into the parent's `SUMMARY.md`. Text and assets stay readable in place. The extraction limits are deliberately generous for your own files: 2 GiB archive input, 20,000 entries,
1 GiB uncompressed, 1000:1 per-entry compression, 256 MiB per entry and 512 MiB extracted per project.

**RE console** is the deep viewer behind a project, not a separate mode: click a procedure work item in an analysis
project, or a function's **RE console** button in a PC project. It is also a manual front end for
[REA](https://rea.tools) (Reverse Engineer Anything), covering REA's whole catalog: native programs, Android apps,
.NET assemblies, JavaScript and Electron apps, web pages, firmware and plain files. Nothing has to be a game, and
nothing has to match.

- **Open a target** by path. Native code is analysed by Ghidra, Hopper, IDA or Rizin (pick the engine next to the
  path). The sidebar lists functions, strings and memory segments; the overview shows counts, a memory map and the
  largest functions.
- **A function** opens as pseudocode next to its assembly, with clickable names and jumps that highlight their
  target. It also has a control-flow graph, a callers/callees graph, the strings and names it uses, and everything
  else REA reports.
- **Every tool has a form**, built from REA's own schema and filled with its example. Results come back as tables,
  code or JSON, with the engine, confidence and limitations REA states. The full tool list is grouped by kind.
- **A terminal** logs every call; click a line to see its result again. You can also type `open PATH`, `fn ADDRESS`,
  `tools WORD`, or any tool as `TOOL key=value` or `TOOL {json}`, with Tab completion and history.
- **Two ways into matching:** **Decompile it** turns an open Windows or Linux program into a byte-matching project;
  in a PC project, a function's **RE console** button opens that function here.

**Feature traces.** In a JavaScript or Electron project, **Trace a feature** takes one literal seed — a route,
string, API, IPC channel, module or node id — and asks REA to walk the application graph from it. Every module,
channel and endpoint the trace reaches becomes a work item grouped under `feature:<name>`, unless it already has
one. Each agent's brief says how the trace reached its node and that static reachability is not proof it runs.
Findings roll into `SUMMARY.md` under **Features**; **Remove** drops the feature and the work items nobody has
analyzed yet, keeping finished findings.

**Recovered and reconstructed code.** An app that shipped source maps starts with its original files in
`recovered/`; modules no map covers become items agents reconstruct. In app, game and archive projects, **Overview →
Sources** shows what is verified, what an agent reconstructed and what is still without code, and **Export sources**
writes the tree plus a `RECONSTRUCTION.md` report. Verified and reconstructed code are never mixed up.

**A binary can end in code too.** In a project opened with REA (a `.exe`, `.so`, firmware image, APK or .NET
assembly), an agent can save the code it reconstructed for a procedure or task: claim the item, then
`write_source`. Files land in `recovered/functions/`, `recovered/tasks/` or `recovered/features/`, the work item is
marked analyzed, and any finding it already had is kept. There is no byte-exact tier for an analyzed target —
the Sources panel and `RECONSTRUCTION.md` say so instead of implying verification — and reconstructed code never
replaces a finding.

**Setup.** The console finds REA by itself when it can, in this order:

1. the console's own saved settings
2. `DECOMP_REA`
3. `rea` on PATH
4. REA installed from **Compilers & tools** in the app
5. an `rea` server registered with Claude Code (`~/.claude.json`), with its environment
6. `npx -y rea-agents@6.7.0 mcp`

**REA settings** in the console set the command, the native engine and environment variables such as
`GHIDRA_INSTALL_DIR`, `JAVA_HOME` or `HOPPER_LAUNCHER_PATH`. They're saved in `.decomp/rea.json`, and the agents'
`inspect_binary` uses them too. Values that look like secrets are never sent to the page.

**Safety.** The console runs its own REA process, so it never switches the target the agents are reading. Most tools
only read. Tools that run or drive a program, browser or device, change a device, connect to pages, or write files run
only after you confirm. The app enforces this, not only the page. Everything REA shows about a target is treated as
untrusted text.

## Starting context at import

The picker has an optional **Starting context** section, applied immediately after import:

- **What is this?** — version, engine, focus, conventions; becomes the project's instructions.
- **Debug/symbol file** — PDB, MAP, `symbol_addrs.txt`, or an ELF with DWARF.
- **Type/header file** — C declarations, structs, enums and prototypes; goes into `context.h`.
- **Reference source folder** — an existing decomp or port agents may read and search.
- **Runtime trace** — coverage addresses/counts; imported before the first claim.
- **Known libraries** — names to mark as library code and keep out of the work queue.

PDB/DWARF imports now also add **function prototypes**, not just names and types. Drop the binary and its companion
files together and they are applied automatically: **PDB/MAP**, `symbol_addrs.txt`, `coverage.csv`/`trace.csv`/
`*.trace`, and `types.h`/`context.h`. A path import finds the same companions beside the file. The optional fields
are only for files that are not beside the binary.

The picker accepts several files at once; the largest non-companion file is the binary, the rest travel with it.
Nothing extra is uploaded when you import by path.

## What the import found

A PDB is not required, and most shipped binaries will not have one. That is normal for reverse engineering: the
import still recovers every function boundary, compiler and flags, imports, strings, data and library/CRT code,
then the autopilot and agents work from the instructions themselves. A shipped PDB/MAP is only a shortcut when the
publisher left one in the build.

Every import also writes an **INTAKE.md** report beside the project and shows it in **Overview → What was found**.
It records what the import already established, so neither you nor an agent starts by rediscovering it:

- the file, format, architecture, entry point, image base, sections and hashes;
- the compiler and version, source language, inferred flags and the evidence for them;
- debug information: source, names and type count;
- functions, library/CRT code, data objects, strings and imported APIs;
- most-called functions, and which functions use each imported API, string and data object;
- subsystem hints (render, audio, input, network, file/registry, UI, memory, threading, crypto) from imports and
  strings, and C++ vtable/RTTI symbols when the target kept them;
- the entry point, named functions and largest functions by instruction count;
- runtime trace coverage and the questions that are still open (missing compiler, no debug names, packed program,
  no trace, mostly automatic names).

Agents get the report's path in `project_info`, their session prompt and every function brief, with an instruction to
read it first. The report is generated by decomp.anything's own parsers and the optional files above; it does not run
every external REA/Ghidra tool on import.

## Debug information and versions

A program often ships with names the compiler already knew. decomp.anything imports them instead of making agents
guess:

- **PDB** beside a Windows program (read with LLVM's `llvm-pdbutil`), **DWARF** inside a Linux program, a linker
  **MAP** file, or `symbol_addrs.txt`. Debug names replace automatic `sub_`/`func_`/`D_` names without breaking
  matches; data names are added; structs, unions, enums and typedefs go into the shared header. MAP, DWARF and
  `symbol_addrs.txt` need nothing extra; for PDB, **Compilers & tools → LLVM tools** shows whether `llvm-pdbutil`
  is present (it comes with LLVM, not with decomp.anything).
- **Import later** from a project's **Settings → Symbols & types**, by path or with no path (the program's sidecar
  debug file). **Export** writes `symbol_addrs.txt`, `debug_types.h` and `debug_symbols.json` into the project
  folder, ready for other tools.
- **Compare versions** in **Settings → Compare versions**: point at a patch, demo or port of the same Windows or
  Linux program. Functions are paired by normalized instructions (calls, globals and RIP-relative operands are
  blanked, internal branch targets stay relative), so moved code still matches. The report says same, moved,
  changed, added and removed, with a similarity score for changed functions.

Agents get `import_debug_info`, `export_debug_info`, `compare_version`, `import_trace`, `list_hot`, `search_facts`
and `list_subsystems` tools; the autopilot and the normal matching loop are unchanged.

## Runtime coverage

**Settings → Runtime coverage** imports a trace from a debugger, emulator or profiler. Accepted shapes are a
column of addresses (`0x401000`), `address,count` CSV, or JSON (`[{"address": "0x401000", "hits": 3}]`). Addresses
can be virtual addresses or RVAs; function names are accepted too. Hit counts are added to the containing
functions, shown in the **Coverage** filter and the Hits column, and `list_hot` ranks them for agents.

## Continue a public decomp

Community projects already have a build and part of the code done. decomp.anything plugs agents into them as they
are:

1. **Browse** the catalog the app bundles (or paste any decomp repository's address) and **fork** it. It's cloned to
   your computer on a local `decomp-wtf` branch.
2. **Add your copy of the game.** The app knows where common layouts expect it (dtk-template for GameCube/Wii,
   `configure.py` + ninja, splat + make) and runs the project's own setup. Anything else you set up by its README;
   decomp.anything picks it up once it builds.
3. **Add agents.** Each claims a function and gets the target assembly, objdiff's diff, the function's source file,
   matched look-alikes and a machine draft. Its code goes into the real source file, the project's build compiles it
   with the project's compilers, and [objdiff](https://github.com/encounter/objdiff) judges it.
4. **Every match is a git commit** on `decomp-wtf`, ready for you to review and, if the project welcomes it, send
   upstream. Nothing is sent anywhere by itself.

Guard rails: agents write only C/C++ sources and headers, never targets, assembly or build scripts, and inline
assembly is refused. A change that breaks an already-matched function is undone. The project's file layout and which
files are linked are changed by the app itself, never typed by an agent, and kept only when the game still builds
byte for byte.

### From matched to linked

A function at 100% is matched. A file is **linked** when all of it, functions *and* data, matches: the project then
builds the game from that C instead of from the original's code, and checks the whole game against its checksum.
That's decomp.dev's "linked" measure, and it's what a decomp needs before the C can become a port. For GameCube and
Wii projects (dtk-template) decomp.anything handles the steps between:

- **Every function gets a source file.** Code no file covers can be given one; `split_file` divides a file where the
  game's original files divided.
- **Files closest to done come first.** When a match finishes a file's functions, the agent is shown the file's data
  next to the original's, with what to fix. `file_status` shows it any time.
- **Finished files link themselves.** The app marks the file Matching, builds the game and runs the project's
  checksum check, keeping the change only if it passes.

## Agents

| Agent | How it connects |
| :-- | :-- |
| **Claude Code** | Runs headless against the app's local MCP server. |
| **Codex CLI** | Same, with approvals limited to decomp.anything's tools. |
| **Antigravity CLI** | Same, through the workspace's own MCP config. Google's successor to Gemini CLI (`agy`). |
| **opencode** | Same, with any provider you've set up. opencode 1 and 2 both work: for opencode 2, the app writes its V2 config, turns Code Mode off and runs it `--standalone`. |
| **API key** | A built-in agent loop for any OpenAI-compatible API: DeepSeek, OpenRouter, OpenAI, or a model on your own computer with llama.cpp, Ollama or LM Studio. |
| **The agent you talk to** | `decomp connect` drives the app from your own terminal and can start helpers. |
| **Anything else** | Point any MCP client (Cursor, Claude Desktop, your own) at `decomp mcp`, or at the app with **Connect another agent**. |

Agents only get decomp.anything's tools: no shell, and no access to your files beyond a fork's own source tree and
any reference folders you name. The app installs missing agents for you and tells you how to sign in. You pay your
own provider.

**Reference folders.** In a project's **Instructions for agents**, write the full path of a folder. Helpers on that
project can then `read_file` and `search_code` there. It works for a matched decomp of the same game, symbol lists,
notes, or specs for a non-game target. Reads stay inside the folder: symlinks out of it, dotfiles, `.git`, `build`
and `orig` folders, binaries and your home folder itself are refused. Folders named in a room you joined are ignored.

**Local models.** Start the model with at least 16K tokens of context (llama.cpp: `-c 16384`; Ollama:
`OLLAMA_CONTEXT_LENGTH=16384`; LM Studio: Context Length), choose its preset under **Agents & models → API key**,
and set the context size there if it isn't llama.cpp. Small models do the small functions; the big ones need a strong
model.

## Decompile together

A team, any size, each on their own computer with their own copy of the target and their own agents, working on one
project. One computer is the room's **host**: it hands out functions so nobody does the same one twice, checks every
match against its own copy, and shares names, structs and notes. Nothing goes through a central server: the people
working together host the room and decide who's in.

**On a home PC:** open the project, click **Decompile together**, **Open the room**. Send the link.

**On a server:**

```bash
decomp host mygame.z64 --own-copy --address http://my-server:6481 --service
```

That runs the app in the background, imports your copy, opens the room and prints the link. **Joining:** paste the
link into **Join a team's room** in the app, or `decomp join <link> <your copy> --name you`.

| | |
| :-- | :-- |
| **Private or public** | Private rooms need the invite link; public rooms only the address. Optionally approve each new member. |
| **Your address** | A free Cloudflare quick tunnel with nothing to set up, or an address you control: your LAN, Tailscale, a server. Rooms at your own address reopen with the same link after a restart. |
| **The host's controls** | Who's online and on what, remove members, a fresh invite link, stop sharing. |
| **Light on the host** | Members compile their own attempts; the host compiles only to verify matches. Agents wait while the host is away and carry on when it's back. |
| **Every kind of project** | Games started from a ROM, GameCube, Wii and DS games started from scratch, and forks of public decomps. A git project's members get its source tree from the host (only what git tracks, never the original), build it with their own copy and tools, and follow every commit made in the room. |

No original bytes or assembly ever cross the wire: everyone reads the code from their own copy, which must be
identical to the host's.

## Targets and platforms

| Target | Status | Matching | Notes |
| :-- | :-- | :-- | :-- |
| **GameCube · Wii** | ★ Recommended | ✓ | Disc (ISO, RVZ, WBFS…) or DOL; CodeWarrior 1.0–1.7; dtk-template projects; finished files link. |
| **Nintendo 64** | ★ Recommended | ✓ | ROM; KMC GCC 2.7.2, IDO 5.3/7.1; rebuilds the ROM byte for byte. |
| **PlayStation** | Beta | ✓ | Disc (.bin, .iso, .chd) or EXE; GCC 2.7.2/2.8.1. |
| **PlayStation 2** | Beta | ✓ | Disc or ELF; EE-GCC 2.96. |
| **Game Boy Advance** | Beta | ✓ | ROM; agbcc. |
| **Nintendo DS** | Beta | ✓ | ROM (.nds); CodeWarrior 1.2–DSi 1.6; ds-decomp projects. |
| **Windows (PC)** | Beta | ✓ | `.exe` / `.dll`, x86 and x86-64; MinGW-w64, clang-cl or your own MSVC. Exports a CMake/IDE project plus `judge.py`; the final PE link stays in your normal toolchain. |
| **Linux (PC)** | Beta | ✓ | ELF executables and `.so`, x86 and x86-64; the GCC, G++, Clang and Clang++ on your machine. Exports a CMake/IDE project plus `judge.py`; the final ELF link stays in your normal toolchain. |
| **Android · .NET · JavaScript/Electron · web · firmware · files** | Analysis | — | Drop it like a game: REA opens it as a normal project, procedures become work items and findings land on the dashboard. Add tasks for the rest. |
| **3DS · PSP · Switch · Xbox · Xbox 360** | Coming | Public decomps | The catalog can fork community projects for these. |

**From scratch.** splat and spimdisasm split MIPS games; decomp-toolkit analyses GameCube and Wii programs inside a
generated [dtk-template](https://github.com/encounter/dtk-template) project; [ds-decomp](https://github.com/AetiasHax/ds-decomp)
analyses DS ROMs (ARM9, ITCM, DTCM, overlays); Game Boy Advance ROMs are split by
[luvdis](https://github.com/aarant/luvdis) plus this project's own pass for code nothing calls. Windows executables
are split with the PE reader (`pe.py`) from `.pdata`, the COFF symbol table, exports, the entry point and call
targets. Linux programs use the symbol table or `.eh_frame`. Every attempt is compiled with the target's compiler and
checked byte for byte. PC imports also read the language and toolchain version the binary records: GCC and Clang in
`.comment`, Rust in `.comment` or the standard library's `rustc-<version>` paths, and Go in `.go.buildinfo`. Rust and
Go are identified, but only C and C++ are matched byte for byte.

**Windows programs.** Function boundaries come from the x86-64 exception directory and the executable's symbol table
where it has one, then exports, the entry point and every direct call target. Matching compiles your C to COFF and
compares bytes with the original's, with address fields blanked on both sides: a call or RIP-relative load has to
point at the same function or global. A PDB or MAP beside the program is imported automatically (PDB through LLVM's
`llvm-pdbutil`); its names and types replace the automatic ones. Build flags are inferred from the image itself
(security cookie, C++ frame handlers, RTTI, unwind tables, `.comment`, stack probes): the project's **Settings**
shows the suggested flags and applies them in one click. CRT, compiler-runtime and static-library functions are
marked and kept out of the work queue. `inspect_binary` can ask [REA](https://rea.tools) for pseudocode, signatures
and callers. Matching a real binary byte for byte needs the compiler that built it; point the project's
`[compiler] cmd` at MSVC if needed. `DECOMP_REA_DRAFTS=1` also lets claims start from REA's pseudocode (slower; off
by default).

**Linux programs.** Function bounds come from the symbol table or, in a stripped program, from `.eh_frame`. Calls
into shared libraries go through PLT stubs named after the function, with their GOT slots named `memcpy@got`. The C
library's start-up code is left out. DWARF in the program is imported automatically: function names, sizes and
signatures, plus structs, unions, enums and typedefs for the shared header. The compiler is picked from what
`.comment` says built it; position-independent programs compile with `-fPIE`. An exact match needs the same compiler
version and flags. System headers can't be included: declare library functions yourself, and in C++ write the
classes whose mangled names you need.

**The base for ports and mods.** For ROM projects, *Export project* writes a normal decomp tree (matched functions
as C, the rest as assembly, a linker script and `build.py`) and proves it rebuilds the target byte for byte.
GameCube and Wii projects are dtk-template; DS projects are ds-decomp. Both rebuild on every build, and GameCube/Wii
files link as they finish. For Windows and Linux programs, *Export IDE project* writes a normal **CMake** tree:
one source per matched function, `include/context.h`, `compile_commands.json` for clangd/IDEs, and `judge.py`,
which compiles a function with the project's compiler and verifies it against the original bytes. Open it in VS
Code, CLion, Visual Studio or your editor; full PE/ELF linking stays in your normal toolchain. Code and data stay
out of git: they're regenerated from your own copy.

**Proprietary compilers** (IDO, CodeWarrior, CodeWarrior for DS) are only installed after you accept that. Heavy
tools run with a memory cap.

**Windows.** Several compilers (KMC GCC, the PlayStation GCCs, EE-GCC, agbcc) only exist as Linux programs, so
decomp.anything runs inside WSL 2 there. The installer sets that up; you use the app in your browser as usual, and
results are byte-identical to Linux. macOS isn't supported.

**When something goes wrong.** A failed import stays on screen with the reason and what happened. **Copy for a bug
report** puts the version, the error and the log on your clipboard. The full log is `.decomp/logs/decomp.log` in your
projects folder (`~/Decomp`).

## Features

| Feature | What you get |
| :-- | :-- |
| **Live view** | A map of every function in the target, each agent's tool calls, scores falling to zero, in real time. |
| **Autopilot** | Free matches before agents spend a token: identical code from a matched twin, then every function's machine draft goes through the judge. |
| **Permuter** | Near misses (95% and up) get rewritten in the background: statement and declaration order, casts, temporaries. |
| **Fast agents** | Small functions come in batches, identical code is shown in the brief, and agents move on after four tries without progress. |
| **Your agent, your terminal** | `decomp connect`, then ask Claude Code, Codex or Antigravity CLI to work on the target. |
| **Edit it yourself** | Every function has an editor: write C or C++, press Ctrl+Enter, see the judge's diff. You count as an agent. |
| **Byte-for-byte check** | Candidates are linked at the real address, so calls, globals, strings and jump tables are verified too. |
| **Any agent** | Claude Code, Codex, Antigravity CLI, opencode, or any model with an API key, several at once. |
| **Lean context** | Compact assembly, diffs that say what's wrong before showing where, close look-alikes' C up front, and short sessions. |
| **Shared knowledge** | Structs and prototypes go into one header, accepted only if every match so far still matches. |
| **Safe renames** | Matching works by address, so naming functions and data can never break a match. |
| **Public decomps** | Fork community projects and keep going with agents, judged by objdiff. |
| **Linked files** | GameCube and Wii files link into the game as soon as all of their code and data match. |
| **Look-alikes** | `find_similar` spots copy-pasted and inlined code and starts agents from what already matches. |
| **Drafts** | m2c for MIPS, PowerPC and ARM; optional Ghidra for x86, AArch64 and everything else. |
| **Agent toolkit** | Data inspector, call graph, function splitting, and guides for MIPS, PowerPC, ARM, x86, AArch64, IDO, GCC, Metrowerks, agbcc, PSY-Q, C++ and objdiff. |
| **Every binary is a project** | The normal picker accepts games and programs; unsupported formats fall back to REA automatically. Procedures become work items, tasks cover the rest, and the same dashboard, agents, notes and activity feed apply. |
| **RE console** | REA's tools in the app: functions, pseudocode beside assembly, control-flow and call graphs, strings, memory map, a form for every tool and a terminal. |
| **Feature traces** | Seed one route, string, IPC channel or module in a JavaScript/Electron app; REA walks the graph and the nodes it reaches become work items with their own report. |
| **REA install** | Download and install REA from **Compilers & tools**; the console and agents pick it up automatically. |
| **Debug symbols** | PDB, DWARF, MAP and `symbol_addrs.txt` names and types; export them again for other tools. |
| **Version compare** | Patch/demo/port triage: same, moved, changed, added and removed functions, matched by normalized instructions. |
| **Suggested flags** | Security cookie, EH/RTTI, unwind tables, comments and stack probes become the compiler flags that match, one click away. |
| **Library code out** | CRT, compiler runtime and static-library functions are marked and never handed to agents. |
| **Data inventory** | PC and ROM data symbols, strings and their addresses are listed in a Data tab and through `list_data`. |
| **IDE export** | PC projects export a CMake/IDE tree with `compile_commands.json` and a `judge.py` byte-match checker. |
| **Runtime coverage** | Import debugger/emulator traces (addresses or names, CSV/JSON/text); hit counts map onto functions, with a Coverage filter and `list_hot`. |
| **Starting context** | Notes, symbols, type headers, reference source, trace and known libraries can be supplied before the first claim. |
| **Intake report** | `INTAKE.md` records the target, compiler, flags, debug types, code/data/string/import inventory, trace and open questions; agents read it first. |
| **Reference folders** | Name a folder in instructions and helpers can read and search it. |
| **Every major disc format** | ROMs, PlayStation discs, GameCube and Wii discs (ISO, GCM, RVZ, WIA, WBFS, CISO, GCZ) and program files, streamed from disk. |
| **Local-first** | No account, no telemetry, no server dependency. |

## Development

```bash
uv sync
uv run decomp              # opens the app; projects live in ~/Decomp (or $DECOMP_HOME)
uv run pytest
```

Python dependencies are locked in `uv.lock`. There is no website in this repository; the Linux and Windows
installers live in `install/`.

<details>
<summary><b>Repository layout</b></summary>
<br>

| Path | What it is |
| :-- | :-- |
| `src/decompnet/rom/` | Input reading (`n64.py`, `psx.py`, `pe.py` for Windows executables, `elfexe.py` for Linux programs), splitting with splat (`split.py`), debug information (`debuginfo.py`), version comparison (`bincompare.py`), the symbol table and the matchers (`match.py`, `match_arm.py`, `match_x86.py`). |
| `src/decompnet/coffobj.py`, `rea.py` | COFF objects from Windows compilers, and the REA MCP client: settings, the agents' read-only bridge and the console's calls. |
| `src/decompnet/app/` | The app: `engine.py` (ROM projects), `forkengine.py` (forks of public decomps), `tools.py` (MCP tools and agent prompt), `agents.py` (running agents), `references.py` (reference folders), `console.py` (the RE console's REA session), `server.py` (GUI API and MCP), `collab.py` (rooms), `static/` (GUI; `console.js`/`console.css` are the RE console), `guide/` (agent know-how). |
| `src/decompnet/forks/` | Fork mode: catalog, project detection and setup, objdiff, source editing, m2c and Ghidra drafts, linking and file splits (`project.py`, `dtksplits.py`), and data diffs (`datadiff.py`). |
| `src/decompnet/network.py` | The coordination core: claims, attempts, notes, the shared header. |
| `src/decompnet/toolchains.py` | The pinned compilers and tools: verified downloads and installs, including npm-installed REA. |
| `src/decompnet/hostenv.py`, `app/updates.py` | Where the app runs (Linux, its WSL 2 distribution on Windows, Docker) and what crosses to the computer around it; updates. |
| `src/decompnet/app/twins.py`, `app/permute.py` | Free matches: identical code from a matched twin, and the background permuter for near misses. |
| `install/install.sh`, `install/install.ps1`, `install/linux-base.sh`, `install/Dockerfile` | The installers: the app's own Linux (WSL on Windows, Docker on a server) is made by `linux-base.sh` on Debian. |
| `projects/demo-rom/` | Builds Demo Quest 64. `tests/test_rom.py` proves the matcher on it. |
| `projects/demo-psx/` | The same game as a PlayStation executable, for `tests/test_psx.py`. |
| `projects/demo-fork/` | A small decomp project in the community's shape (objdiff.json, ninja), for `tests/test_forks.py`. |

Rebuild the demo ROM with `uv run python projects/demo-rom/build.py` (needs `gcc-2.7.2-kmc` and `ld.lld`).

</details>

## Pinned tools

Every download is pinned by version and SHA-256 in `src/decompnet/toolchains.toml`. Install one from
**Compilers & tools**, or with `decompnet toolchain install <id>`.

| Tool | Pinned version |
| :-- | :-- |
| **KMC GCC 2.7.2** | decompals `mips-gcc-2.7.2 v0.1` + `mips-binutils-2.6 v0.3` |
| **PlayStation GCC** | decompals `old-gcc 0.17` (GCC 2.7.2 and 2.8.1), with binutils 2.6 |
| **EE-GCC** | Sony-era GCC 2.96 from `decompme/compilers` |
| **IDO** | `ido-static-recomp v1.2` (5.3 and 7.1) |
| **agbcc** | pret `agbcc release` |
| **ARM GNU** | 14.3.Rel1 (for agbcc’s assembler path) |
| **CodeWarrior** | `compilers_20251118.zip` (GameCube, Wii, ProDG, Xbox 360 MSVC); DS archive from `decompme/compilers` |
| **objdiff-cli** | **v3.8.3** |
| **decomp-toolkit** | v1.8.4 |
| **wibo** | 1.2.0 |
| **coddog** | 0.6.3 |
| **Ghidra** | 12.1.4 |
| **REA** | **rea-agents 6.7.0** |
| **UPX** | **5.2.1** |
| **cloudflared** | **2026.10.2** |
| **ds-decomp** | v0.12.1 |
| **binutils-mips** | decompals v0.10 |
| **gc-wii-binutils** | 2.42-2 |
| **sjiswrap** | v1.2.2 |
| **m2c** | `708d2d2c` |
| **maspsx** | `e85ecb3` |
| **dtk-template** | `95a941f` |
| **luvdis** | `ec3a4e3` |

System tools (**Compilers & tools** shows whether they are present): **LLVM tools** (`llvm-pdbutil` for PDB names),
**Rizin** (a lightweight REA provider) and **Detect It Easy** (`diec` fingerprints). They are optional; install them
with the system package manager or the LLVM installer.

The period compilers are deliberately held at the versions that reproduce the games’ original output. `maspsx` is
also held at `e85ecb3`: newer upstream commits change assembly expansion and need a PlayStation matching corpus run
before they can be adopted. The host’s GCC, Clang, MinGW and `clang-cl` are used as system toolchains, not pinned.

## Built on

decomp.anything would not exist without [decomp.wtf](https://github.com/i12bp8/decomp.wtf) by Sam Wolfs, which
provides the matching engine, project workflow, app and installers this fork extends.

[splat](https://github.com/ethteck/splat) and [spimdisasm](https://github.com/Decompollaborate/spimdisasm) split
ROMs, [objdiff](https://github.com/encounter/objdiff) judges forks, [m2c](https://github.com/matt-kempster/m2c) and
[Ghidra](https://github.com/NationalSecurityAgency/ghidra) write first drafts (and [REA](https://rea.tools) supplies
pseudocode, callers and strings over MCP, and drives the analysis projects for targets with no original build), the
[decompals](https://github.com/decompals) recompiled period compilers do the building, and
[decomp.dev](https://decomp.dev) lists the public projects. The look-alike finder follows the
idea of [coddog](https://github.com/ethteck/coddog); [decomp-toolkit](https://github.com/encounter/decomp-toolkit),
[maspsx](https://github.com/mkst/maspsx) and [wibo](https://github.com/decompals/wibo) are in the pinned toolbelt.

Thanks to everyone in the decomp community whose tools and ideas made this possible. decomp.anything isn't affiliated
with any of these projects, nor with Nintendo, Sony or Microsoft.

## Use it responsibly

decomp.anything contains no game or application code and doesn't provide ROMs, executables or firmware. Only analyze
software you own or are authorized to analyze. Don't use it to get around copy protection, and don't publish
decompiled code whose rights you don't hold.

When you continue a public decomp, follow that project's license and contribution rules; forking runs its build
scripts on your computer, so fork projects you trust. Many community decomps don't accept AI-written contributions,
and the ones that do expect a person to stand behind every line. decomp.anything never sends anything upstream: your
agents' work stays on your local branch. Before you open a pull request, read the project's CONTRIBUTING (or ask its
maintainers), review the code yourself, and say how it was made.

## License

[MIT](LICENSE) © 2026 Sam Wolfs, and the decomp.anything contributors.

decomp.anything is a fork of decomp.wtf and keeps its MIT license.
