@ Demo Quest DS start-up, laid out like a NitroSDK game's ARM9 program so the community's tools (ds-decomp) read it:
@ the secure area, the entry point that runs the autoloads, clears .bss, runs the static initializers and jumps to
@ main, the build info that describes the autoloads, a static initializer, and code and data that autoload to the
@ ITCM and DTCM. Calls go to local labels (.L...), which the assembler resolves itself: CodeWarrior's linker
@ doesn't take the newer relocations GNU as would write for them. Written for decomp.wtf (CC0); nothing here comes
@ from the SDK.
        .syntax unified
        .arm

        .section .secure, "ax"
        .word   0xE7FFDEFF, 0xE7FFDEFF          @ the decrypted secure area's marker
        .thumb                                  @ BIOS calls live here, as in DS games
        .global SVC_WaitByLoop
        .thumb_func
SVC_WaitByLoop:
        svc     #0x03
        bx      lr
        .global SVC_CpuSet
        .thumb_func
SVC_CpuSet:
        svc     #0x0B
        bx      lr
        .arm
        .fill   0x7F8 - 8, 1, 0

        .section .crt0, "ax"
        .global _start
_start:
        mov     r12, #0x04000000
        str     r12, [r12, #0x208]              @ interrupts off (IME = 0)
        bl      .Ldo_autoload
        ldr     r0, =ds_frame                   @ the DS part of the demo, once (through a register: CodeWarrior's
        blx     r0                              @ linker doesn't take GNU's call relocations)
        mov     r0, #0
        ldr     r1, =__bss_start
        ldr     r2, =__bss_end
        sub     r2, r2, r1
        bl      .LINITi_CpuClear32
        bl      .Lrun_inits
        ldr     r1, =main
        ldr     lr, =0xFFFF0000
        bx      r1
        .ltorg

        .global INITi_CpuClear32
INITi_CpuClear32:                             @ r0 = value, r1 = destination, r2 = size in bytes
.LINITi_CpuClear32:
        add     r12, r1, r2
1:      cmp     r1, r12
        strlt   r0, [r1], #4
        blt     1b
        bx      lr

        .global do_autoload
do_autoload:                                  @ copy each autoload block to its address, clear its .bss
.Ldo_autoload:
        stmdb   sp!, {r4-r7, lr}
        ldr     r4, =_start_ModuleParams
        ldr     r5, [r4]                        @ autoload infos
        ldr     r6, [r4, #4]                    @ end of the infos
        ldr     r7, [r4, #8]                    @ the blocks
1:      cmp     r5, r6
        beq     4f
        ldr     r0, [r5], #4                    @ destination
        ldr     r1, [r5], #4                    @ size
        add     r1, r0, r1
2:      cmp     r0, r1
        ldrlt   r2, [r7], #4
        strlt   r2, [r0], #4
        blt     2b
        ldr     r1, [r5], #4                    @ .bss size
        add     r1, r0, r1
        mov     r2, #0
3:      cmp     r0, r1
        strlt   r2, [r0], #4
        blt     3b
        b       1b
4:      bl      .L_start_AutoloadDoneCallback
        ldmia   sp!, {r4-r7, lr}
        bx      lr
        .ltorg

        .global _start_AutoloadDoneCallback
_start_AutoloadDoneCallback:
.L_start_AutoloadDoneCallback:
        bx      lr

        .global run_inits
run_inits:                                    @ call every static initializer in .ctor
.Lrun_inits:
        stmdb   sp!, {r4, lr}
        ldr     r4, =__ctor_start
1:      ldr     r0, [r4], #4
        cmp     r0, #0
        beq     2f
        mov     lr, pc
        bx      r0
        b       1b
2:      ldmia   sp!, {r4, lr}
        bx      lr
        .ltorg

        .global _start_ModuleParams
        .balign 4
_start_ModuleParams:                            @ build info (ds-rom fills in the autoload fields)
        .word   0, 0, 0                         @ autoload infos start / end, autoload blocks
        .word   __bss_start, __bss_end
        .word   0                               @ not compressed
        .word   0x04027531                      @ "SDK version"
        .word   0xDEC00621, 0x2106C0DE          @ nitrocode

        .section .init, "ax"
        .global __sinit_dsrt
__sinit_dsrt:                                   @ a static initializer: start the frame counter at 1
        ldr     r0, =g_frame_count
        mov     r1, #1
        str     r1, [r0]
        bx      lr
        .ltorg

        .section .ctor, "a"
        .word   __sinit_dsrt

        .section .itcm, "ax"
        .global itcm_fill32
itcm_fill32:                                    @ r0 = destination, r1 = value, r2 = words (runs from the ITCM)
        cmp     r2, #0
        bxeq    lr
1:      str     r1, [r0], #4
        subs    r2, r2, #1
        bne     1b
        bx      lr

        .section .dtcm, "aw"
        .global dtcm_scratch
dtcm_scratch:
        .word   0x44454D4F, 0x51554553, 0x54204453, 0
