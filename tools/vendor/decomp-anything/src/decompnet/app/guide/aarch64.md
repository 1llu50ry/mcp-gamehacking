# AArch64 and Clang (Switch)

Registers: x0-x7 arguments, x0 return (w0-w7 are the 32-bit views); x8 indirect result; x9-x15 scratch;
x19-x28 callee-saved; x29 frame pointer, x30 link register, sp. Floats/SIMD: v0-v7 arguments (s0/d0
return), v8-v15 callee-saved (low halves).

Prologue `stp x29, x30, [sp, #-N]!` + `mov x29, sp`, then `stp x20, x19, [sp, #16]`... Globals:
`adrp x8, sym` + `ldr x8, [x8, :lo12:sym]` (or through the GOT).

Recognising C/C++
- `sxtw`/`ldrsw` sign extension: int becoming a 64-bit index or pointer offset; `uxtw` unsigned.
  Mismatched int/long/size_t types show up here first.
- `csel`, `cset`, `cinc`, `csinv`: ternaries, boolean results and small ifs without branches.
- `madd`/`msub`: multiply-add from index arithmetic; `ubfx`/`sbfx`/`bfi`: bitfields and masks.
- Virtual call: `ldr x8, [x0]`, `ldr x8, [x8, #off]`, `blr x8`. A `b` at the end is a tail call.
- `fmadd` only appears when the compiler may contract a*b+c.

Compilers: games use the clang versions of their Nintendo SDK (old titles clang 3.9/4.0, newer ones
later versions); the project's toolchain matches it. Almost everything is C++ with Itanium mangling
(`_ZN...`). Libraries such as sead, nn and the game's engine are often already decompiled in the
project or related ones: reuse their headers.

Clang output is stable, so differences usually come from types, inlined helpers (use the project's),
member order, and early returns vs nested ifs. Functions are large: get the structure right first.
Some projects have MATCHING_HACK macros; only use them where the project already does.
