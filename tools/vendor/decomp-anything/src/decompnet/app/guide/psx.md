# Matching PlayStation (PS1) code

CPU: MIPS R3000A (MIPS I). Things that look odd at first:
- Load delay slot: the instruction after a load can't use the loaded value; you'll see `nop`s or
  reordering there. Branch delay slots exist too; there's no branch-likely.
- `mult`/`div` put results in HI/LO (`mflo`, `mfhi`). Division is followed by checks for divide by zero
  (`break 7`) and overflow (`break 6`): the PSY-Q assembler adds them, and the project's build (GCC plus
  maspsx, which imitates Sony's ASPSX) reproduces that. Write a plain `/`.
- `$gp`-relative small data (-G4 or -G8): small globals are read with `lw $v0, %gp_rel(sym)($gp)`
  (one instruction) instead of `lui` + `lw`. In a ROM project, declare such globals in context.h
  *without* `extern` (`s32 D_8001B278;`): the compiler then treats them as small data. With `extern`
  it builds the full address and the function won't match. Arrays and structs larger than the limit
  are never gp-relative.

Compilers: PSY-Q SDK GCC 2.6/2.7.2/2.8.x and ASPSX versions differ in register allocation and
instruction scheduling; the project picks them per file. Code is mostly C.

Libraries: PSY-Q's libgte, libgpu, libgs, libspu, libcd, libetc, libapi and libc are usually linked
as library objects, not decompiled; their names and prototypes are in the project's headers.

GTE (the geometry coprocessor): `mtc2`/`mfc2`/`ctc2`/`cfc2`, `lwc2`/`swc2` and commands like
`RTPS`/`NCLIP` come from PSY-Q's GTE macros (`gte_ldv0`, `gte_rtps`...). Use the project's macros;
don't write raw assembly.

Typical patterns: `jtbl_` jump tables in .rodata for dense switches; overlays loaded at the same address
(separate units); `D_800xxxxx` data and `func_800xxxxx` names for things nobody named yet.
