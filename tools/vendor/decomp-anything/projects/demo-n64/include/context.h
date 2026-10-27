/* Demo Quest — shared decomp context. Agents extend this with edit_context as they learn. */
typedef signed char s8;
typedef unsigned char u8;
typedef signed short s16;
typedef unsigned short u16;
typedef signed int s32;
typedef unsigned int u32;
typedef float f32;
#define NULL ((void *)0)

typedef struct Entity {
    /* 0x00 */ s16 type;
    /* 0x02 */ u16 flags;
    /* 0x04 */ s32 x;
    /* 0x08 */ s32 y;
    /* 0x0C */ s32 vel_x;
    /* 0x10 */ s32 vel_y;
    /* 0x14 */ s16 w;
    /* 0x16 */ s16 h;
    /* 0x18 */ s32 hp;
} Entity; /* size 0x1C */

typedef struct Player {
    /* 0x00 */ Entity ent;
    /* 0x1C */ s32 unk_1C;
    /* 0x20 */ s16 unk_20;
    /* 0x22 */ s16 unk_22;
    /* 0x24 */ s32 unk_24;
} Player; /* size 0x28 */

extern Player g_player;
extern Entity g_entities[32];
extern s32 g_score;
extern s32 g_frame_count;
extern u32 g_rng_state;

s32 abs_s32(s32 v);
void entity_update_physics(Entity *e);
