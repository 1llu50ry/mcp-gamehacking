# Data: globals, strings, tables, floats

Names
- The assembly names every address it saw: `D_80012340` (data), `func_80001234` (code), `jtbl_...`
  (jump table). Use those names in your C, or give the address a real name with `rename_symbol`.
- Declare what you use: `extern s32 D_80012340;`, `extern u8 D_80012340[];`, `extern MyStruct D_...;`
  in your source or in context.h. The type decides the load/store width and offsets.
- A reference to `D_80012350` might be `D_80012340 + 0x10`: a field of a struct or an array element.
  Either spelling links to the same address and matches.

Look at the bytes
- `read_data("D_80012340", 64)` shows a hex dump, text, words that look like pointers, and floats.
- `.bss` (uninitialized) data has no bytes in the ROM; only its address and size are known.

Data you define yourself
- String literals, `static const` tables, float constants and jump tables you write are linked where the
  ROM keeps that data, and must be byte-identical to it. A string that differs by one character fails
  with "your data for ... differs from the ROM".
- Prefer `extern` declarations for big tables that belong to other code; define small literals inline
  when the original obviously did (e.g. `"%d"` passed to a print function).

Floats
- `lui $at, 0x3F80` + `mtc1 $at, $f0` is the constant 1.0f built in registers; a `lwc1` from
  `D_...` is a constant stored in .rodata. `read_data` shows it "as f32".
