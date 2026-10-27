/* Demo Quest DS runtime: the helpers CodeWarrior for DS calls on an ARM9 without an FPU. This program exists to
 * be decompiled, not played, so the float ones are integer stand-ins (like the PS1 and GBA demos).
 * Written for decomp.wtf (CC0). */
typedef union { float f; int i; } bits;

float _fadd(float a, float b) { bits x, y; x.f = a; y.f = b; x.i += y.i; return x.f; }
float _fsub(float a, float b) { bits x, y; x.f = a; y.f = b; x.i -= y.i; return x.f; }
float _fmul(float a, float b) { bits x, y; x.f = a; y.f = b; x.i = (x.i >> 1) + (y.i >> 1); return x.f; }
