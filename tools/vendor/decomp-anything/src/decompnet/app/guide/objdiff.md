# Reading objdiff

objdiff compares your compiled function with the original, instruction by instruction, relocations
included. The match percentage is how alike they are; 100% means identical. decomp.wtf's score is
(1 - match) × instructions × 100: lower is better, 0 is identical.

The diff shows TARGET (original) and YOURS side by side, only around differences:
- blank: identical.
- `|`: a different instruction here. Usually expression structure, a different operation, or types.
- `i`: same instruction, an operand differs: register, constant, offset, or the symbol a relocation
  points at (wrong global, wrong struct field, a literal that should be a named constant).
- `<`: only in the target: you're missing an instruction (a check, a cast, a sign extension).
- `>`: only in yours: you have something extra.

"Not in your build yet" means the base object has no symbol by that name: the function isn't written,
is `static` when it should be global (or the reverse), or (C++) its signature doesn't produce the
same mangled name. Compare the mangled name in the brief with what your definition would produce.

Order of work
1. Same number of instructions and the same control flow (branches, calls, loop shape).
2. Operands: types, constants, struct offsets, which globals.
3. Register allocation and scheduling last: local declaration order, temporaries, expression order.

Relocations
- A call to the wrong function or a load of the wrong global shows as `i` on the relocated operand.
- Float constants and strings come from literal pools or small-data sections; the value has to match,
  and literals are laid out in the order they first appear in the file.
