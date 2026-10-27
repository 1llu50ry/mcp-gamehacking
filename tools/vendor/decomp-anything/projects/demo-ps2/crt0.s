# Demo Quest PS2 start-up: clear .bss, set the stack and $gp, call main. Written for decomp.wtf (CC0).
# Numeric registers ($8 = t0, $9 = t1, $28 = gp, $29 = sp) and reorder mode, for the period EE assembler.
        .set reorder
        .section .text
        .globl _start
        .ent _start
_start:
        la      $8, _bss_start
        la      $9, _bss_end
.Lclear:
        sq      $0, 0($8)
        addiu   $8, $8, 16
        sltu    $1, $8, $9
        nop
        nop
        bne     $1, $0, .Lclear
        lui     $29, 0x0200
        la      $28, _gp
        jal     main
.Lhang:
        b       .Lhang
        .end _start
