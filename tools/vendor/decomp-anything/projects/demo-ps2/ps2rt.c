/* Demo Quest PS2 runtime bits GCC expects: on the EE, `long` is 64 bits and there is no 64-bit multiply or
 * divide instruction, so libgcc's helpers are needed. Written with shifts and adds only (which the EE does
 * natively), so they never call themselves. Written for decomp.wtf (CC0). */
typedef unsigned long long u64;
typedef long long s64;

void __main(void) {
}

u64 __muldi3(u64 a, u64 b) {
    u64 r = 0;
    while (b != 0) {
        if (b & 1) {
            r += a;
        }
        a <<= 1;
        b >>= 1;
    }
    return r;
}

static u64 udivmod(u64 n, u64 d, u64 *rem) {
    u64 q = 0;
    u64 r = 0;
    int i;
    for (i = 63; i >= 0; i--) {
        r = (r << 1) | ((n >> i) & 1);
        if (r >= d) {
            r -= d;
            q |= (u64)1 << i;
        }
    }
    *rem = r;
    return q;
}

u64 __udivdi3(u64 n, u64 d) {
    u64 r;
    return udivmod(n, d, &r);
}

u64 __umoddi3(u64 n, u64 d) {
    u64 r;
    udivmod(n, d, &r);
    return r;
}

s64 __divdi3(s64 a, s64 b) {
    u64 r;
    u64 q = udivmod(a < 0 ? -a : a, b < 0 ? -b : b, &r);
    return ((a < 0) != (b < 0)) ? -(s64)q : (s64)q;
}

s64 __moddi3(s64 a, s64 b) {
    u64 r;
    udivmod(a < 0 ? -a : a, b < 0 ? -b : b, &r);
    return a < 0 ? -(s64)r : (s64)r;
}
