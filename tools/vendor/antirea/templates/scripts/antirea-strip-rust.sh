#!/usr/bin/env sh
# antirea — Rust cargo-auditable section remover
#
# Run this after `cargo build --release` to strip the .dep-v0 section
# that REA's inspect_rust_binary reads.
#
# Usage:
#   sh scripts/antirea-strip-rust.sh target/release/myapp
#   sh scripts/antirea-strip-rust.sh target/release/myapp.so
#
# Or add to Makefile / cargo xtask:
#   strip-release:
#       cargo build --release
#       sh scripts/antirea-strip-rust.sh target/release/$(BINARY_NAME)
#
# What REA reads from .dep-v0:
#   - Every crate name, version, and source URL in your dependency tree
#   - Build settings and rustc commit hash
#   - Dependency graph edges
#
# After this script: inspect_rust_binary returns null metadata.
# REA cannot enumerate your dependencies, detect vulnerable crates,
# or infer your tech stack from cargo-auditable data.
#
# Requirements:
#   Linux/macOS: objcopy (binutils) or llvm-objcopy
#   The binary is ELF (Linux), PE (Windows via cross-compile), or Mach-O (macOS)
#
# Note on Mach-O (macOS):
#   cargo-auditable embeds in __DATA,__dep_v0 on Mach-O.
#   llvm-objcopy --remove-section __DATA,__dep_v0 handles this.
#   Standard macOS `strip` does not remove named sections by section name.

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <binary-path>" >&2
  exit 1
fi

BINARY="$1"

if [ ! -f "$BINARY" ]; then
  echo "[antirea:strip-rust] ERROR: file not found: $BINARY" >&2
  exit 1
fi

# Detect OS and choose tool
case "$(uname -s)" in
  Linux)
    TOOL=""
    if command -v objcopy > /dev/null 2>&1; then
      TOOL="objcopy"
    elif command -v llvm-objcopy > /dev/null 2>&1; then
      TOOL="llvm-objcopy"
    else
      echo "[antirea:strip-rust] ERROR: objcopy not found. Install binutils: sudo apt install binutils" >&2
      exit 1
    fi

    # Strip .dep-v0 (cargo-auditable)
    "$TOOL" --remove-section .dep-v0 "$BINARY" 2>/dev/null || true

    # Also strip debug sections while we're here
    "$TOOL" \
      --strip-debug \
      --strip-unneeded \
      --remove-section .comment \
      --remove-section .note.gnu.build-id \
      "$BINARY" 2>/dev/null || true

    echo "[antirea:strip-rust] OK (Linux/objcopy): $BINARY"
    ;;

  Darwin)
    TOOL=""
    if command -v llvm-objcopy > /dev/null 2>&1; then
      TOOL="llvm-objcopy"
    elif command -v objcopy > /dev/null 2>&1; then
      TOOL="objcopy"
    fi

    if [ -n "$TOOL" ]; then
      "$TOOL" --remove-section __DATA,__dep_v0 "$BINARY" 2>/dev/null || true
      echo "[antirea:strip-rust] OK (macOS/llvm-objcopy): $BINARY"
    else
      # Fallback: use strip (removes debug, not cargo-auditable section by name)
      strip "$BINARY" 2>/dev/null || true
      echo "[antirea:strip-rust] PARTIAL (macOS/strip — install llvm-objcopy for full .dep-v0 removal): $BINARY"
    fi
    ;;

  MINGW*|MSYS*|CYGWIN*)
    # Windows cross-compile — use llvm-objcopy if available
    if command -v llvm-objcopy > /dev/null 2>&1; then
      llvm-objcopy --remove-section .dep-v0 "$BINARY" 2>/dev/null || true
      echo "[antirea:strip-rust] OK (Windows/llvm-objcopy): $BINARY"
    else
      echo "[antirea:strip-rust] WARNING: llvm-objcopy not found. Install LLVM tools to strip .dep-v0 on Windows." >&2
    fi
    ;;

  *)
    echo "[antirea:strip-rust] WARNING: Unknown OS. Skipping .dep-v0 removal." >&2
    ;;
esac

# Additional: ensure -s -w flags were used at compile time
# (strip symbol table and DWARF via linker flags)
# Add to .cargo/config.toml:
#
# [profile.release]
# strip = "symbols"
# debug = false
# lto = true
# codegen-units = 1
# opt-level = 3
#
# Or pass at build time:
#   RUSTFLAGS="-C strip=symbols -C debuginfo=0" cargo build --release
echo "[antirea:strip-rust] REMINDER: build with -C strip=symbols -C debuginfo=0 or set in .cargo/config.toml"