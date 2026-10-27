/* Demo Quest PS2: an EE executable loaded at 0x00100000, like PS2 games. */
OUTPUT_ARCH(mips)
ENTRY(_start)
SECTIONS
{
    . = 0x00100000;
    .text : { crt0.o(.text) *(.text) }
    .rodata : { *(.rodata) *(.rodata.*) }
    .data : { *(.data) *(.data.*) }
    _gp = ALIGN(16) + 0x7FF0;
    .sdata : { *(.sdata) *(.lit4) *(.lit8) }
    .bss (NOLOAD) : { _bss_start = .; *(.sbss) *(.scommon) *(COMMON) *(.bss) . = ALIGN(16); _bss_end = .; }
    /DISCARD/ : { *(.reginfo) *(.mdebug*) *(.comment) *(.pdr) *(.note*) *(.gnu.attributes) *(.MIPS.abiflags) }
}
