/* Demo Quest 64: decompiled so far. */
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


u32 rng_next(void) {
    g_rng_state = g_rng_state * 1103515245 + 12345;
    return (g_rng_state >> 16) & 0x7FFF;
}


void add_score(s32 points) {
    g_score += points * (g_player.combo + 1);
    if (g_score > MAX_SCORE) {
        g_score = MAX_SCORE;
    }
}

void player_take_damage(s32 amount) {
    if (g_player.invuln_timer > 0) {
        return;
    }
    g_player.invuln_timer = 60;
    g_player.hp -= amount;
    if (g_player.hp <= 0) {
        g_player.hp = 0;
        g_player.state = PLAYER_STATE_DEAD;
    }
}
