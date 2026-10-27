# Matching Metrowerks CodeWarrior (GameCube, Wii, DS)

The project sets each file's compiler version (GC/1.x-3.x, Wii/1.x, DS 1.x-2.x) and flags, typically
`-O4,p -inline auto -fp hard -enum int -Cpp_exceptions off -RTTI off`. Files may carry `#pragma`s
(`optimization_level`, `inline_depth`, `dont_inline`, `scheduling`, `peephole`, `opt_strength_reduction`):
keep them, and only add your own the way the project does elsewhere.

Inlining (the biggest source of mismatches)
- With `-inline auto`, small functions defined earlier in the same file, and `inline` functions in
  headers, are inlined. If the target calls a function you wrote as inline (or inlines one you call),
  move or change the definition, or use the project's existing inline helper.
- Vector/matrix math and getters are usually header inlines in the project: use them rather than
  writing the arithmetic out, or the instruction order differs.

Registers (GC/1.x's allocator, documented from the compiler itself; Wii/DS versions behave alike)
- Callee-saved registers are claimed on demand from r31 down (r31, r30, ... r14; f31 down for floats).
  Volatiles (r0, r3-r12) go to values that don't live across a call.
- Named locals are numbered in reverse declaration order, and that order decides who gets r31, r30...:
  when two callee-saved registers are swapped against the target, swap those two locals' declarations.
  First use doesn't matter as much as declaration order; a local assigned twice can split into two values.
- Only registers differ (structure, offsets, calls all match): try declaration order first, then whether a
  value is a separate local or recomputed, then the expression's form. It's almost never a compiler flag.

Stack frame (`stwu r1, -N(r1)` and every r1 offset)
- The frame holds every local and temporary the compiler ever needed: GC/1.0-1.2.5 never reclaims a dead
  slot, so a local you removed, an inlined call's temporaries or a struct copy still take room.
- Frame too small: the original had more locals (often a temporary struct, an inlined helper's locals, or a
  value kept in a variable instead of recomputed). Too big: you have one the original didn't.
- When everything matches but the frame size and r1 offsets, the code is right: fix the locals, not the
  logic, and know that the match percentage barely moves until the frame is exactly right.
- Locals sit in declaration order (arrays and structs first in some versions): a slot in the wrong place
  usually means the declaration order differs.

Respellings to try before anything odd (plausible code a developer wrote, in this order)
- a condition as a bool/int vs. a comparison; the comparison the other way round (`a < b` / `b > a`);
  `return x;` from each branch vs. one exit; declaration order; a local vs. an expression inline;
  integer reassociation (`a + b + c` grouping); parameters in their own locals; bitfields vs. masks.
- Not these: `volatile`, empty `asm`, `do {} while (0)`, pointless temporaries or casts that only push the
  score: they are fake matches, and the project would reject them.

Code shape
- `if`/`else` keeps source order: the fall-through block is the first branch you wrote.
- Ternaries can compile differently from the equivalent `if`/`else`; try both.
- Loops with known trip counts get strength-reduced (pointer walking) and sometimes unrolled.
- `BOOL` is usually `int` (Dolphin/Revolution SDK); `bool` is a byte in C++. Using the wrong one adds
  or drops `clrlwi`/`extsb`.
- Float literals come from .sdata2 in first-use order; `0.0f` vs `0.0` matters (double adds `frsp`).
- `-enum int`: enums are 4 bytes; enum-typed struct fields are words.

Libraries: the Dolphin/Revolution SDK (OS, GX, DVD, PAD, VI, AX), MSL (the C library), the Runtime
(`__ptmf`, `__construct_array`), NW4R, EGG or JSystem are usually already decompiled in the community;
the project's headers have their prototypes and structs.

DS (mwccarm, CodeWarrior for DS 1.2-2.0 and DSi 1.x): the same inlining rules; see guide("arm") for the
instruction set. Notes that differ from GameCube/Wii:
- Code is ARM unless a file says `#pragma thumb on`; `-interworking` lets ARM and Thumb call each other.
- Callee-saved registers r4-r11 are pushed together (`stmdb sp!, {r4-r8, lr}`); which register a local gets
  follows first use, like on PowerPC.
- No FPU: with `-fp soft`, float math calls `_fadd`, `_fsub`, `_fmul`, `_fdiv`, `_ffix`, `_fflt`, `_fls`,
  `_fgr`...; division calls `_s32_div_f` / `_u32_div_f` (or the SDK's divider at 0x04000280).
- Strings and constants sit in .rodata, reached through each function's literal pool; `-str noreuse` keeps
  equal strings as separate copies.
- NitroSDK functions (OS_, MI_, GX_, G2_, FS_, SND_, PAD_, TP_) and its macros are usually already known in the
  project; ITCM functions (fast copies, math) and DTCM data are linked separately but compile like the rest.
- Started from scratch: ds-decomp named things `func_02001234` and `data_02041480`; use those names (or rename
  them with the project's tools) and keep each function in the `src/auto/` file that holds its address.
