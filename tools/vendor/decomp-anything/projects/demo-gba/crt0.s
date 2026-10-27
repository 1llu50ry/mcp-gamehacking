@ Demo Quest GBA start-up: ROM header, then copy .data to RAM, clear .bss and call main in Thumb mode.
@ The header's logo area is left blank (it only matters to the console's boot check). Written for decomp.wtf (CC0).
        .section .text.crt0, "ax"
        .arm
        .global _start
_start:
        b       start_vector
        .fill   156, 1, 0               @ logo area (blank)
        .ascii  "DEMOQUEST   "          @ title, 12 bytes
        .ascii  "ADQE"                  @ game code
        .ascii  "00"                    @ maker
        .byte   0x96, 0, 0              @ fixed value, unit, device
        .fill   7, 1, 0
        .byte   0                       @ version
        .byte   0                       @ header checksum (filled in by build.py)
        .fill   2, 1, 0
start_vector:
        mov     r0, #0x12               @ IRQ mode stack
        msr     cpsr_c, r0
        ldr     sp, =0x03007FA0
        mov     r0, #0x1F               @ system mode stack
        msr     cpsr_c, r0
        ldr     sp, =0x03007F00
        ldr     r0, =__data_lma
        ldr     r1, =__data_start
        ldr     r2, =__data_end
1:      cmp     r1, r2
        ldrlt   r3, [r0], #4
        strlt   r3, [r1], #4
        blt     1b
        ldr     r1, =__bss_start
        ldr     r2, =__bss_end
        mov     r3, #0
2:      cmp     r1, r2
        strlt   r3, [r1], #4
        blt     2b
        ldr     r0, =main
        mov     lr, pc
        bx      r0
3:      b       3b
        .pool

@ libgcc's Thumb helpers agbcc calls: an indirect call through a register, and the constructor hook.
        .text
        .thumb
        .align  2
        .global _call_via_r0
        .thumb_func
_call_via_r0:
        bx      r0
        nop
        .global _call_via_r1
        .thumb_func
_call_via_r1:
        bx      r1
        nop
        .global _call_via_r2
        .thumb_func
_call_via_r2:
        bx      r2
        nop
        .global _call_via_r3
        .thumb_func
_call_via_r3:
        bx      r3
        nop
        .global _call_via_r4
        .thumb_func
_call_via_r4:
        bx      r4
        nop
        .global _call_via_r5
        .thumb_func
_call_via_r5:
        bx      r5
        nop
        .global _call_via_r6
        .thumb_func
_call_via_r6:
        bx      r6
        nop
        .global _call_via_r7
        .thumb_func
_call_via_r7:
        bx      r7
        nop
        .global __gccmain
        .thumb_func
__gccmain:
        bx      lr
