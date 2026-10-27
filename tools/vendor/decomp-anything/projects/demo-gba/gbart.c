/* Demo Quest GBA runtime: the helpers agbcc calls on a CPU with no divide instruction and no FPU. This
 * executable exists to be decompiled, not played, so the float ones are integer stand-ins (like the PS1 demo).
 * Written for decomp.wtf (CC0). */
typedef union { float f; int i; } bits;

static unsigned int udivmod(unsigned int n, unsigned int d, unsigned int *rem) {
    unsigned int q = 0, r = 0;
    int i;
    for (i = 31; i >= 0; i--) {
        r = (r << 1) | ((n >> i) & 1);
        if (r >= d) {
            r -= d;
            q |= 1u << i;
        }
    }
    *rem = r;
    return q;
}

unsigned int __udivsi3(unsigned int n, unsigned int d) { unsigned int r; return udivmod(n, d, &r); }
unsigned int __umodsi3(unsigned int n, unsigned int d) { unsigned int r; udivmod(n, d, &r); return r; }
int __divsi3(int a, int b) {
    unsigned int r, q = udivmod(a < 0 ? -a : a, b < 0 ? -b : b, &r);
    return ((a < 0) != (b < 0)) ? -(int)q : (int)q;
}
int __modsi3(int a, int b) {
    unsigned int r;
    udivmod(a < 0 ? -a : a, b < 0 ? -b : b, &r);
    return a < 0 ? -(int)r : (int)r;
}

float __addsf3(float a, float b) { bits x, y; x.f = a; y.f = b; x.i += y.i; return x.f; }
float __subsf3(float a, float b) { bits x, y; x.f = a; y.f = b; x.i -= y.i; return x.f; }
float __mulsf3(float a, float b) { bits x, y; x.f = a; y.f = b; x.i = (x.i >> 1) + (y.i >> 1); return x.f; }
float __divsf3(float a, float b) { bits x, y; x.f = a; y.f = b; x.i -= y.i >> 1; return x.f; }
int __fixsfsi(float a) { bits x; x.f = a; return x.i >> 8; }
float __floatsisf(int a) { bits x; x.i = a << 8; return x.f; }
int __ltsf2(float a, float b) { bits x, y; x.f = a; y.f = b; return x.i < y.i ? -1 : 0; }
int __gtsf2(float a, float b) { bits x, y; x.f = a; y.f = b; return x.i > y.i ? 1 : 0; }
int __lesf2(float a, float b) { bits x, y; x.f = a; y.f = b; return x.i <= y.i ? 0 : 1; }
int __gesf2(float a, float b) { bits x, y; x.f = a; y.f = b; return x.i >= y.i ? 0 : -1; }
int __eqsf2(float a, float b) { bits x, y; x.f = a; y.f = b; return x.i != y.i; }
int __nesf2(float a, float b) { bits x, y; x.f = a; y.f = b; return x.i != y.i; }
float __negsf2(float a) { bits x; x.f = a; x.i ^= 0x80000000; return x.f; }
