/* m2c-style machine seed: structurally right, needs cleanup */
u32 rng_next(void) {
    u32 temp_v0;

    temp_v0 = (g_rng_state * 0x41C64E6D) + 0x3039;
    g_rng_state = temp_v0;
    return (temp_v0 >> 0x10) & 0x7FFF;
}
