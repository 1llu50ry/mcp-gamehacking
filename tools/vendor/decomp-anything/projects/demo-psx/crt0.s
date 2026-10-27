# Demo Quest PS1 start-up: clear .bss, set the stack and $gp, call main. Written for decomp.wtf (CC0).
        .set noreorder
        .set noat
        .section .text
        .globl _start
        .ent _start
_start:
        lui     $t0, %hi(_bss_start)
        addiu   $t0, $t0, %lo(_bss_start)
        lui     $t1, %hi(_bss_end)
        addiu   $t1, $t1, %lo(_bss_end)
.Lclear:
        sw      $zero, 0($t0)
        addiu   $t0, $t0, 4
        sltu    $at, $t0, $t1
        bnez    $at, .Lclear
        nop
        li      $sp, 0x801FFF00
        lui     $gp, %hi(_gp)
        jal     main
        addiu   $gp, $gp, %lo(_gp)
.Lhang:
        j       .Lhang
        nop
        .end _start
