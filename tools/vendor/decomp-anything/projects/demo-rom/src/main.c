/* Demo Quest 64 main loop: runs the game and exercises zlib. Written for decomp.online (CC0). */
#include "game.h"

typedef unsigned long uLong;
int compress(unsigned char *dest, uLong *destLen, const unsigned char *source, uLong sourceLen);
int uncompress(unsigned char *dest, uLong *destLen, const unsigned char *source, uLong sourceLen);
uLong crc32(uLong crc, const unsigned char *buf, unsigned int len);
uLong adler32(uLong adler, const unsigned char *buf, unsigned int len);
const char *zlibVersion(void);

static const char save_magic[] = "DEMOQUEST-SAVE";
u8 save_buffer[512];
u8 packed_buffer[640];
volatile u32 debug_crc;
volatile s32 debug_status;

void save_game(void) {
    uLong packed_len = sizeof(packed_buffer);
    s32 i;

    for (i = 0; i < 14; i++) {
        save_buffer[i] = save_magic[i];
    }
    *(s32 *)(save_buffer + 16) = g_score;
    *(s32 *)(save_buffer + 20) = g_player.hp;
    debug_status = compress(packed_buffer, &packed_len, save_buffer, sizeof(save_buffer));
    debug_crc = crc32(0, packed_buffer, packed_len) ^ adler32(1, save_buffer, sizeof(save_buffer));
}

s32 load_game(void) {
    uLong out_len = sizeof(save_buffer);

    if (uncompress(save_buffer, &out_len, packed_buffer, sizeof(packed_buffer)) != 0) {
        return 0;
    }
    g_score = *(s32 *)(save_buffer + 16);
    return checksum_save(save_buffer, out_len) != 0;
}

void main(void) {
    entity_spawn(ENTITY_SLIME, 32, 0);
    entity_spawn(ENTITY_BAT, 96, 64);
    entity_spawn(ENTITY_COIN, 160, 400);
    for (;;) {
        game_tick();
        if ((g_frame_count & 0xFF) == 0) {
            save_game();
            if (zlibVersion()[0] == '1') {
                load_game();
            }
        }
    }
}
