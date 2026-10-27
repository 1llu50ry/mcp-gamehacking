/* The "real" header of Demo Quest. Agents never see this: they get include/context.h,
 * which starts out with the partial knowledge a decomp project typically has. */
#ifndef GAME_H
#define GAME_H

typedef signed char s8;
typedef unsigned char u8;
typedef signed short s16;
typedef unsigned short u16;
typedef signed int s32;
typedef unsigned int u32;
typedef float f32;
#define NULL ((void *)0)

#define MAX_ENTITIES 32
#define GRAVITY 2
#define MAX_FALL_SPEED 24
#define FLOOR_Y 448
#define MAX_SCORE 999999

#define ENTITY_FLAG_ACTIVE 0x1
#define ENTITY_FLAG_GROUNDED 0x2

enum EntityType { ENTITY_NONE, ENTITY_SLIME, ENTITY_BAT, ENTITY_KNIGHT, ENTITY_DRAGON, ENTITY_COIN };
enum PlayerState { PLAYER_STATE_IDLE, PLAYER_STATE_WALK, PLAYER_STATE_JUMP, PLAYER_STATE_DEAD };

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
    /* 0x1C */ s32 hp;
    /* 0x20 */ s16 invuln_timer;
    /* 0x22 */ s16 state;
    /* 0x24 */ s32 combo;
} Player; /* size 0x28 */

extern Player g_player;
extern Entity g_entities[MAX_ENTITIES];
extern s32 g_score;
extern s32 g_frame_count;
extern u32 g_rng_state;

s32 clamp_s32(s32 v, s32 lo, s32 hi);
s32 abs_s32(s32 v);
void player_take_damage(s32 amount);
u32 rng_next(void);
s32 count_alive_entities(void);
void entity_update_physics(Entity *e);
s32 entity_default_hp(s16 type);
Entity *entity_spawn(s16 type, s32 x, s32 y);
void add_score(s32 points);
f32 lerp(f32 a, f32 b, f32 t);
u32 checksum_save(const u8 *data, s32 len);
s32 entity_collides(const Entity *a, const Entity *b);
void game_tick(void);

#endif
