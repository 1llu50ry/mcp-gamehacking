/* Demo Quest — the "original source" used only to build target/game.o.
 * In a real project this file does not exist; the target comes from the ROM via splat. */
#include "game.h"

Player g_player;
Entity g_entities[MAX_ENTITIES];
s32 g_score;
s32 g_frame_count;
u32 g_rng_state;

s32 clamp_s32(s32 v, s32 lo, s32 hi) {
    if (v < lo) {
        return lo;
    }
    if (v > hi) {
        return hi;
    }
    return v;
}

s32 abs_s32(s32 v) {
    return v < 0 ? -v : v;
}

void player_take_damage(s32 amount) {
    if (g_player.invuln_timer > 0) {
        return;
    }
    g_player.hp -= amount;
    if (g_player.hp <= 0) {
        g_player.hp = 0;
        g_player.state = PLAYER_STATE_DEAD;
    }
    g_player.invuln_timer = 60;
}

u32 rng_next(void) {
    g_rng_state = g_rng_state * 1103515245 + 12345;
    return (g_rng_state >> 16) & 0x7FFF;
}

s32 count_alive_entities(void) {
    s32 i;
    s32 n = 0;

    for (i = 0; i < MAX_ENTITIES; i++) {
        if (g_entities[i].flags & ENTITY_FLAG_ACTIVE) {
            n++;
        }
    }
    return n;
}

void entity_update_physics(Entity *e) {
    e->vel_y += GRAVITY;
    if (e->vel_y > MAX_FALL_SPEED) {
        e->vel_y = MAX_FALL_SPEED;
    }
    e->x += e->vel_x;
    e->y += e->vel_y;
    if (e->y > FLOOR_Y) {
        e->y = FLOOR_Y;
        e->vel_y = 0;
        e->flags |= ENTITY_FLAG_GROUNDED;
    }
}

s32 entity_default_hp(s16 type) {
    switch (type) {
        case ENTITY_SLIME:
            return 3;
        case ENTITY_BAT:
            return 2;
        case ENTITY_KNIGHT:
            return 10;
        case ENTITY_DRAGON:
            return 50;
        case ENTITY_COIN:
            return 1;
        default:
            return 0;
    }
}

Entity *entity_spawn(s16 type, s32 x, s32 y) {
    s32 i;

    for (i = 0; i < MAX_ENTITIES; i++) {
        Entity *e = &g_entities[i];
        if (!(e->flags & ENTITY_FLAG_ACTIVE)) {
            e->type = type;
            e->x = x;
            e->y = y;
            e->vel_x = 0;
            e->vel_y = 0;
            e->flags = ENTITY_FLAG_ACTIVE;
            e->hp = entity_default_hp(type);
            return e;
        }
    }
    return NULL;
}

void add_score(s32 points) {
    g_score += points * (g_player.combo + 1);
    if (g_score > MAX_SCORE) {
        g_score = MAX_SCORE;
    }
}

f32 lerp(f32 a, f32 b, f32 t) {
    return a + (b - a) * t;
}

u32 checksum_save(const u8 *data, s32 len) {
    u32 sum = 0x1234;
    s32 i;

    for (i = 0; i < len; i++) {
        sum = (sum << 5) + sum + data[i];
    }
    return sum;
}

s32 entity_collides(const Entity *a, const Entity *b) {
    return abs_s32(a->x - b->x) < (a->w + b->w) / 2 && abs_s32(a->y - b->y) < (a->h + b->h) / 2;
}

void game_tick(void) {
    s32 i;

    g_frame_count++;
    if (g_player.invuln_timer > 0) {
        g_player.invuln_timer--;
    }
    for (i = 0; i < MAX_ENTITIES; i++) {
        Entity *e = &g_entities[i];
        if (e->flags & ENTITY_FLAG_ACTIVE) {
            entity_update_physics(e);
            if (entity_collides(e, &g_player.ent)) {
                if (e->type == ENTITY_COIN) {
                    add_score(10);
                    e->flags = 0;
                } else {
                    player_take_damage(1);
                }
            }
        }
    }
}
