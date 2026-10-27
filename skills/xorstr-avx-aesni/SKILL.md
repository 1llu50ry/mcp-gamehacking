---
name: xorstr-avx-aesni
description: "jm::xorstr — AVX / AES-NI-based compile-time XOR string literal protection by JustasMasiulis. The de-facto standard for C++ string hiding in cheats and malware."
metadata:
  type: reference
  source: curated
  topics: [xorstr, jm, avx, aesni, string-encryption, compile-time]
---
# jm::xorstr

Compile-time encrypted string literal. Decrypts in-register at use site. Written by JustasMasiulis (JM); the de-facto standard in modern C++ cheats and malware.

## Usage

```cpp
#include "xorstr.hpp"
auto k = xorstr("CreateFileW");    // encrypted at compile time
auto fn = GetProcAddress(h, k.crypt_get()); // decrypted into XMM register
```

## Primitives

- Template metaprogramming splits the literal into 16/32-byte chunks.
- Each chunk XOR'd with a build-time pseudo-random constant.
- Decrypt runs on `__m128i` / `__m256i` so the plaintext never hits memory as a contiguous buffer.
- `JM_XORSTR_DISABLE_AVX_INTRINSICS` falls back to GPR path.
- With AES-NI, encrypt key is itself masked via `_mm_aesenc_si128`.

## Detection

- `xorstr` leaves telltale AVX intrinsics in use at every string construction site. Pattern-scan `vmovdqa64` + `vpxor` + `vpshufb` near call-sites.
- Still, extraction requires running the function or symbolic exec ([[angr-mcp]]).

## Related

[[data-obfuscation-xorstr]], [[xor-key-finder]], [[anti-disassembly-techniques]].
