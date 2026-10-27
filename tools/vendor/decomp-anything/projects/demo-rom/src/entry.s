# Demo Quest 64 boot entry: clear .bss, set up the stack, jump to main.
# Written for decomp.online (CC0). Same shape as a typical N64 game entry point, so ROM tools
# that look for that pattern (bss bounds, main, stack) find it here too.
        .set noreorder
        .set noat
        .section .text
        .globl entrypoint
        .ent entrypoint
entrypoint:
        lui     $t0, %hi(_bss_start)
        addiu   $t0, $t0, %lo(_bss_start)
        lui     $t1, %hi(_bss_size)
        addiu   $t1, $t1, %lo(_bss_size)
.Lclear:
        addi    $t1, $t1, -8
        sw      $zero, 0($t0)
        sw      $zero, 4($t0)
        bnez    $t1, .Lclear
        addi    $t0, $t0, 8
        lui     $t2, %hi(main)
        lui     $sp, %hi(boot_stack_top)
        addiu   $t2, $t2, %lo(main)
        jr      $t2
        addiu   $sp, $sp, %lo(boot_stack_top)
        # pad the entry point to 0x60 bytes, like N64 games do
        nop
        nop
        nop
        nop
        nop
        nop
        nop
        nop
        nop
        nop
        .end entrypoint
