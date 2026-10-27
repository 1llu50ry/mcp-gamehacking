# PowerPC (GameCube, Wii, Xbox 360 PPC)

Registers
- r1 stack pointer; r2 base of read-only small data (.sdata2/.sbss2); r13 base of small data
  (.sdata/.sbss). `lwz r3, x@sda21(r13)` reads a small global.
- r3-r10 integer arguments, r3 return value (r3:r4 for 64-bit); r11-r12 scratch; r14-r31 callee-saved.
- f1-f8 float arguments, f1 return; f14-f31 callee-saved. cr0-cr7 condition fields, lr return address,
  ctr for indirect calls (`mtctr r12; bctrl`) and some loops (`bdnz`).

Prologue/epilogue: `stwu r1, -N(r1)`, `mflr r0`, `stw r0, N+4(r1)`, saves of r31, r30... (or `stmw`),
then the reverse and `blr`. The number of saved registers tells you how many values live across calls.

Recognising C
- Loads: `lwz`/`lhz`/`lbz` unsigned, `lha` signed halfword, `extsb`/`extsh` sign extension: they give
  you field types. `lfs` float, `lfd` double. `stwu`/`lwzu` update forms walk pointers.
- `rlwinm`: shift and mask. `clrlwi rD, rS, 24` is `& 0xFF` (or a u8 cast), `slwi` multiply by a power
  of 2, `srwi` unsigned shift, `srawi` signed shift; `srawi` + `addze` is signed division by 2^n.
- `cmpw`/`cmpwi` signed compare, `cmplw`/`cmplwi` unsigned: that's the variable's signedness.
- `cntlzw` + `srwi 5` is `x == 0`; `neg`/`subfic` + `adde` patterns are `!=` and boolean results.
- `lis`/`addi` (`@ha`/`@l`) build addresses of globals; `lis`/`ori` build constants.
- int to float: subtract the magic double 0x43300000_80000000 (signed) or 0x43300000_00000000
  (unsigned) after an `xoris 0x8000`; float to int: `fctiwz` + `stfd` + `lwz`.
- `frsp` rounds a double to float: a double was involved (a literal without `f`, or a double variable).
- `fmadds`/`fmsubs`: a*b+c fused by the compiler.
- Virtual call: `lwz r12, vtbl(r3)`, `lwz r12, off(r12)`, `mtctr r12`, `bctrl`.
- Switch: `cmplwi` range check, then a jump table load and `bctr`.
