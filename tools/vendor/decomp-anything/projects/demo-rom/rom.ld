/* Demo Quest 64: code and data are loaded at 0x80000400 from ROM offset 0x1000. */
OUTPUT_ARCH(mips)
ENTRY(entrypoint)
SECTIONS
{
    . = 0x80000400;
    .text : { build/entry.o(.text) *(.text) }
    .rodata : { *(.rodata) *(.rodata.*) }
    .data : { *(.data) *(.data.*) *(.sdata) }
    _code_end = .;
    .bss (NOLOAD) : ALIGN(16) { _bss_start = .; *(.bss) *(.sbss) *(COMMON) . = ALIGN(16); _bss_end = .; }
    _bss_size = _bss_end - _bss_start;
    boot_stack_top = 0x80400000;
    /DISCARD/ : { *(.reginfo) *(.mdebug) *(.comment) *(.pdr) *(.note*) *(.gnu.attributes) *(.MIPS.abiflags) }
}
