"""Known-matching sources for the demo project, written against the *initial* context.h
(Player fields still named unk_XX, several prototypes missing)."""

SOLUTIONS = {
    "abs_s32": "s32 abs_s32(s32 v) { return v < 0 ? -v : v; }",
    "clamp_s32": """
s32 clamp_s32(s32 v, s32 lo, s32 hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}""",
    "rng_next": """
u32 rng_next(void) {
    g_rng_state = g_rng_state * 1103515245 + 12345;
    return (g_rng_state >> 16) & 0x7FFF;
}""",
    "player_take_damage": """
void player_take_damage(s32 amount) {
    if (g_player.unk_20 > 0) return;
    g_player.unk_1C -= amount;
    if (g_player.unk_1C <= 0) {
        g_player.unk_1C = 0;
        g_player.unk_22 = 3;
    }
    g_player.unk_20 = 60;
}""",
    "entity_update_physics": """
void entity_update_physics(Entity *e) {
    e->vel_y += 2;
    if (e->vel_y > 24) e->vel_y = 24;
    e->x += e->vel_x;
    e->y += e->vel_y;
    if (e->y > 448) {
        e->y = 448;
        e->vel_y = 0;
        e->flags |= 2;
    }
}""",
    "add_score": """
void add_score(s32 points) {
    g_score += points * (g_player.unk_24 + 1);
    if (g_score > 999999) g_score = 999999;
}""",
    # functions that call other functions in the same file (tests relocation resolution)
    "entity_spawn": """
s32 entity_default_hp(s16 type);

Entity *entity_spawn(s16 type, s32 x, s32 y) {
    s32 i;

    for (i = 0; i < 32; i++) {
        Entity *e = &g_entities[i];
        if (!(e->flags & 1)) {
            e->type = type;
            e->x = x;
            e->y = y;
            e->vel_x = 0;
            e->vel_y = 0;
            e->flags = 1;
            e->hp = entity_default_hp(type);
            return e;
        }
    }
    return NULL;
}""",
    "game_tick": """
s32 entity_collides(const Entity *a, const Entity *b);
void add_score(s32 points);
void player_take_damage(s32 amount);

void game_tick(void) {
    s32 i;

    g_frame_count++;
    if (g_player.unk_20 > 0) {
        g_player.unk_20--;
    }
    for (i = 0; i < 32; i++) {
        Entity *e = &g_entities[i];
        if (e->flags & 1) {
            entity_update_physics(e);
            if (entity_collides(e, &g_player.ent)) {
                if (e->type == 5) {
                    add_score(10);
                    e->flags = 0;
                } else {
                    player_take_damage(1);
                }
            }
        }
    }
}""",
}

# A plausible-but-wrong first attempt: unsigned compare + wrong order
WRONG_CLAMP = """
s32 clamp_s32(s32 v, s32 lo, s32 hi) {
    if (v > hi) return hi;
    if ((u32)v < (u32)lo) return lo;
    return v;
}"""
