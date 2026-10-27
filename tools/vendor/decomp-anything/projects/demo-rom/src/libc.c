/* A tiny C library for Demo Quest 64: just what zlib and the game need. Written for decomp.online (CC0). */
typedef unsigned int size_t;

static char heap[0x40000];
static size_t heap_used;

void *malloc(size_t n) {
    char *p;
    n = (n + 7) & ~7;
    if (heap_used + n > sizeof(heap)) {
        return 0;
    }
    p = heap + heap_used;
    heap_used += n;
    return p;
}

void *memset(void *dst, int c, size_t n) {
    unsigned char *d = dst;
    while (n--) {
        *d++ = c;
    }
    return dst;
}

void *calloc(size_t count, size_t size) {
    void *p = malloc(count * size);
    if (p != 0) {
        memset(p, 0, count * size);
    }
    return p;
}

void free(void *p) {
    (void)p;
}

void *memcpy(void *dst, const void *src, size_t n) {
    unsigned char *d = dst;
    const unsigned char *s = src;
    while (n--) {
        *d++ = *s++;
    }
    return dst;
}

int memcmp(const void *a, const void *b, size_t n) {
    const unsigned char *x = a;
    const unsigned char *y = b;
    for (; n != 0; n--, x++, y++) {
        if (*x != *y) {
            return *x - *y;
        }
    }
    return 0;
}

size_t strlen(const char *s) {
    const char *p = s;
    while (*p) {
        p++;
    }
    return p - s;
}

char *strcpy(char *dst, const char *src) {
    char *d = dst;
    while ((*d++ = *src++) != 0) {
    }
    return dst;
}

int errno;

void exit(int code) {
    (void)code;
    for (;;) {
    }
}
