/* Demo Quest PS1 runtime bits GCC expects on a PlayStation (no FPU): the __main constructor hook and the
 * single-precision soft-float helpers. This executable exists to be decompiled, not played, so these are
 * plain integer stand-ins. Written for decomp.wtf (CC0). */
typedef union { float f; int i; } bits;

void __main(void) {
}

float __addsf3(float a, float b) {
    bits x, y;
    x.f = a;
    y.f = b;
    x.i += y.i;
    return x.f;
}

float __subsf3(float a, float b) {
    bits x, y;
    x.f = a;
    y.f = b;
    x.i -= y.i;
    return x.f;
}

float __mulsf3(float a, float b) {
    bits x, y;
    x.f = a;
    y.f = b;
    x.i = (x.i >> 1) + (y.i >> 1);
    return x.f;
}
