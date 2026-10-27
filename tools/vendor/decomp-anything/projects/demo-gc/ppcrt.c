/* Demo Quest GC runtime: the register save/restore helpers CodeWarrior calls in prologues and epilogues
 * (PowerPC EABI layout, registers stored below r11), with an entry point per register like the SDK's.
 * Written for decomp.wtf (CC0). */
void _savegpr_14(void);
void _savegpr_15(void);
void _savegpr_16(void);
void _savegpr_17(void);
void _savegpr_18(void);
void _savegpr_19(void);
void _savegpr_20(void);
void _savegpr_21(void);
void _savegpr_22(void);
void _savegpr_23(void);
void _savegpr_24(void);
void _savegpr_25(void);
void _savegpr_26(void);
void _savegpr_27(void);
void _savegpr_28(void);
void _savegpr_29(void);
void _savegpr_30(void);
void _savegpr_31(void);
void _restgpr_14(void);
void _restgpr_15(void);
void _restgpr_16(void);
void _restgpr_17(void);
void _restgpr_18(void);
void _restgpr_19(void);
void _restgpr_20(void);
void _restgpr_21(void);
void _restgpr_22(void);
void _restgpr_23(void);
void _restgpr_24(void);
void _restgpr_25(void);
void _restgpr_26(void);
void _restgpr_27(void);
void _restgpr_28(void);
void _restgpr_29(void);
void _restgpr_30(void);
void _restgpr_31(void);

asm void __save_gpr(void) {
    nofralloc
    entry _savegpr_14
    stw r14, -72(r11)
    entry _savegpr_15
    stw r15, -68(r11)
    entry _savegpr_16
    stw r16, -64(r11)
    entry _savegpr_17
    stw r17, -60(r11)
    entry _savegpr_18
    stw r18, -56(r11)
    entry _savegpr_19
    stw r19, -52(r11)
    entry _savegpr_20
    stw r20, -48(r11)
    entry _savegpr_21
    stw r21, -44(r11)
    entry _savegpr_22
    stw r22, -40(r11)
    entry _savegpr_23
    stw r23, -36(r11)
    entry _savegpr_24
    stw r24, -32(r11)
    entry _savegpr_25
    stw r25, -28(r11)
    entry _savegpr_26
    stw r26, -24(r11)
    entry _savegpr_27
    stw r27, -20(r11)
    entry _savegpr_28
    stw r28, -16(r11)
    entry _savegpr_29
    stw r29, -12(r11)
    entry _savegpr_30
    stw r30, -8(r11)
    entry _savegpr_31
    stw r31, -4(r11)
    blr
}

asm void __restore_gpr(void) {
    nofralloc
    entry _restgpr_14
    lwz r14, -72(r11)
    entry _restgpr_15
    lwz r15, -68(r11)
    entry _restgpr_16
    lwz r16, -64(r11)
    entry _restgpr_17
    lwz r17, -60(r11)
    entry _restgpr_18
    lwz r18, -56(r11)
    entry _restgpr_19
    lwz r19, -52(r11)
    entry _restgpr_20
    lwz r20, -48(r11)
    entry _restgpr_21
    lwz r21, -44(r11)
    entry _restgpr_22
    lwz r22, -40(r11)
    entry _restgpr_23
    lwz r23, -36(r11)
    entry _restgpr_24
    lwz r24, -32(r11)
    entry _restgpr_25
    lwz r25, -28(r11)
    entry _restgpr_26
    lwz r26, -24(r11)
    entry _restgpr_27
    lwz r27, -20(r11)
    entry _restgpr_28
    lwz r28, -16(r11)
    entry _restgpr_29
    lwz r29, -12(r11)
    entry _restgpr_30
    lwz r30, -8(r11)
    entry _restgpr_31
    lwz r31, -4(r11)
    blr
}
