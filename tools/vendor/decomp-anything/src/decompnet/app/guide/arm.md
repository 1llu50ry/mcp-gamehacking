# ARM and Thumb (GBA, DS, 3DS)

Registers: r0-r3 arguments, r0 return (r0:r1 for 64-bit); r4-r11 callee-saved; r12 (ip) scratch;
r13 sp, r14 lr, r15 pc. Prologue `push {r4-r7, lr}`, epilogue `pop {r4-r7, pc}` (or, for Thumb
interworking on the GBA, `pop {r0}` + `bx r0`).

ARM vs Thumb: 4-byte vs 2-byte instructions. GBA games are mostly Thumb (it runs faster from ROM), with
some ARM in IWRAM; the DS ARM9 runs both. Thumb mostly uses r0-r7, so register pressure shows quickly.

Recognising C
- Literal pools: constants and addresses that don't fit an immediate are loaded PC-relative
  (`ldr r0, [pc, #off]`) from words after the function. Their order follows first use.
- Operand shifts: `add r0, r1, r2, lsl #2` is `r1 + r2 * 4` (array indexing).
- `ldrsb`/`ldrsh` signed, `ldrb`/`ldrh` unsigned: field types. `lsl #24` + `asr #24` sign-extends an
  s8; `lsl #16` + `lsr #16` truncates to u16. Old GCCs (agbcc) emit these whenever a variable is
  narrower than int: changing a local between `u8`/`s16` and `int` adds or removes them.
- Conditional execution (ARM mode): `moveq`, `addne`, `ldrgt`: short `if`s without branches.
- No hardware divide on ARM7/ARM9: `/` and `%` call `__divsi3`/`__modsi3` (GBA games may use the BIOS
  `swi 6`). The DS has a divider in I/O registers (0x04000280) used through SDK functions.
- `bl` calls; `bx`/`blx` switch between ARM and Thumb (ARMv5 has `blx`).

Hardware registers: GBA I/O at 0x04000000 (REG_DISPCNT...), DS I/O at 0x04000000 too; the project's
headers have names and macros for them: use those.
