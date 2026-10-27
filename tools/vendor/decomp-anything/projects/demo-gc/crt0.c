/* Demo Quest GC start-up, written the way the CodeWarrior SDK's __start.c is: asm functions in .init that set up
 * the stack and small-data registers, then __init_data walks the linker-generated _rom_copy_info and
 * _bss_init_info tables. Written for decomp.wtf (CC0). */
typedef unsigned int u32;

typedef struct { u32 *rom; u32 *addr; u32 size; } RomCopyInfo;
typedef struct { u32 *addr; u32 size; } BssInitInfo;

extern RomCopyInfo _rom_copy_info[];
extern BssInitInfo _bss_init_info[];
extern u32 _stack_addr[];
extern u32 _SDA_BASE_[];
extern u32 _SDA2_BASE_[];
extern void main(void);

int __argc = -1;              /* small: .sdata */
float __time_scale;           /* float constants land in .sdata2, as in every GameCube game */
int __init_state[8] = {1};    /* bigger: .data; both are written at start-up, like the SDK's */

__declspec(section ".init") asm void __init_registers(void) {
    nofralloc
    lis r1, _stack_addr@h
    ori r1, r1, _stack_addr@l
    lis r2, _SDA2_BASE_@h
    ori r2, r2, _SDA2_BASE_@l
    lis r13, _SDA_BASE_@h
    ori r13, r13, _SDA_BASE_@l
    blr
}

__declspec(section ".init") void __init_data(void) {
    RomCopyInfo *rom = _rom_copy_info;
    BssInitInfo *bss = _bss_init_info;
    u32 i;

    for (; rom->size != 0; rom++) {
        if (rom->rom != rom->addr) {
            for (i = 0; i < rom->size / 4; i++) {
                rom->addr[i] = rom->rom[i];
            }
        }
    }
    for (; bss->size != 0; bss++) {
        for (i = 0; i < bss->size / 4; i++) {
            bss->addr[i] = 0;
        }
    }
    __argc = 0;
    __init_state[0] = 2;
    __time_scale = 1.5f * (float)__init_state[1] + 0.25f;
}

__declspec(section ".init") asm void __start(void) {
    nofralloc
    bl __init_registers
    bl __init_data
    bl main
loop:
    b loop
}
