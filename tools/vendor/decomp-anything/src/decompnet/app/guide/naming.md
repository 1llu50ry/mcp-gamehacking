# Naming things

- `rename_symbol(old, new)` names an address everywhere: in the assembly everyone sees, in every matched
  source, in the shared header. It is regression-tested and never breaks matches (matching is by
  address).
- Name functions after what they do: `player_take_damage`, `entity_update`. Name data after what it is:
  `gPlayer`, `sSaveMagic`, `D_8001` -> `gSineTable`.
- Common convention in N64 decomps: `g` prefix for globals, `s` for file statics, `unk_XX` for unknown
  struct fields, `func_8000XXXX` until you know better.
- Rename once you're confident; a misleading name is worse than an address.
