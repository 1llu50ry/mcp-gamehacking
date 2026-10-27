/* Demo Quest GBA: code and constants in ROM at 0x08000000, data copied to EWRAM, .bss after it. */
ENTRY(_start)
MEMORY { rom : ORIGIN = 0x08000000, LENGTH = 32M  ewram : ORIGIN = 0x02000000, LENGTH = 1M }
SECTIONS
{
    .text : { crt0.o(.text.crt0) *(.text) *(.glue_7) *(.glue_7t) } > rom
    .rodata : { *(.rodata) *(.rodata.*) . = ALIGN(4); } > rom
    __data_lma = .;
    .data : AT(__data_lma) { __data_start = .; *(.data) . = ALIGN(4); __data_end = .; } > ewram
    .bss (NOLOAD) : { __bss_start = .; *(.bss) *(COMMON) . = ALIGN(4); __bss_end = .; } > ewram
    /DISCARD/ : { *(.comment) *(.ARM.attributes) *(.note*) }
}
