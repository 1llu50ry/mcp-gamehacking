/* Demo Quest PS1: loaded at 0x80010000 like a PlayStation executable. */
OUTPUT_ARCH(mips)
ENTRY(_start)
SECTIONS
{
    . = 0x80010000;
    .text : { build/crt0.o(.text) *(.text) }
    .rodata : { *(.rodata) *(.rodata.*) }
    .data : { *(.data) *(.data.*) }
    _gp = ALIGN(16) + 0x7FF0;
    .sdata : { *(.sdata) }
    _text_end = .;
    /* small and common globals first, so they stay within $gp's reach; big static arrays after */
    .bss (NOLOAD) : { _bss_start = .; *(.sbss) *(.scommon) *(COMMON) *(.bss) . = ALIGN(4); _bss_end = .; }
    /DISCARD/ : { *(.reginfo) *(.mdebug) *(.comment) *(.pdr) *(.note*) *(.gnu.attributes) *(.MIPS.abiflags) }
}
