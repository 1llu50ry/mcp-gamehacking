# Vertical: firmware / IoT

The `superghidra-mcp`, `ghidrathon-mcp`, `qiling-mcp`, `unicorn-mcp`, `angr-mcp` backends cover most firmware RE. The missing piece — a `binwalk`-equivalent native parser — is a top priority (see ROADMAP).

## Workflows

- **UBoot image carve**: not yet built-in; use external `binwalk` + feed each chunk to `file_identify`.
- **ELF embedded**: `elf_parse` on handed-off binaries.
- **ESP32 / RISC-V**: `ida-pro-mcp` + `capstone-mcp`.
- **Bootloader RE**: `pak_parse`-style scan patterns, custom skills.
- **UEFI**: skill-level content under `efi-persistence` (hand-written).

## Skills to add

- `uboot-image-carve`
- `uefi-runtime-services-hooks`
- `esp32-flash-layout`
- `mt-bootloader-hacks`
- `realtek-firmware-structure`
- `uboot-env-parse`
- `rockchip-sfc-dump`
