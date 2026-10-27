# Reading the m2c draft

m2c translates the assembly to C mechanically. It is a starting point, never a match.

- `?` types: m2c couldn't tell. Replace with s32/u8/a struct pointer as the instructions suggest
  (see the `mips` guide's "Types from instructions").
- `arg0`, `var_v0`, `temp_s0`, `sp10`: placeholder names. `spXX` is a stack local at offset XX.
- `*(s32 *)(arg0 + 0x1C)`: a struct field. Collect the offsets a pointer is used with and define a
  struct (see the `structs` guide), then write `p->field`.
- `M2C_ERROR(...)` or `goto`s everywhere: control flow m2c couldn't structure; rebuild it by hand from
  the assembly.
- Calls declared `/* extern */` with `?` arguments: m2c guessed the signature from register use. Check
  it against other callers and add a real prototype to context.h.
- `saved_reg_*`: a register preserved for the caller; usually nothing to write in C.
- m2c inlines expressions aggressively. The original often had temporaries; put them back when the
  register allocation differs.
