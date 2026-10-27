"""Functions that are not the program's own code: CRT start-up, compiler runtime and static libraries.

Marking them saves agents from "decompiling" _start or operator new, and keeps a project's progress
about the code someone actually wrote. The names come from symbol tables, PDBs and import tables;
auto-generated names (sub_...) are never classified on their own.
"""

from __future__ import annotations

from .symbols import AUTO_NAME

CRT = {
    "_start", "start", "entry", "mainCRTStartup", "WinMainCRTStartup", "wWinMainCRTStartup",
    "_init", "_fini", "__main", "_mainCRTStartup", "__libc_csu_init", "__libc_csu_fini",
    "deregister_tm_clones", "register_tm_clones", "__do_global_dtors_aux", "frame_dummy",
    "_dl_relocate_static_pie", "__x86.get_pc_thunk.bx", "__gmon_start__",
}
CRT_PREFIXES = (
    "__scrt_", "__mingw_", "_GLOBAL__sub_I", "__gxx_personality", "__cxa_", "_Unwind_", "__unwind_",
    "__stack_chk_", "__security_", "_guard_", "__chkstk", "___chkstk", "__libc_", "_IO_", "__printf",
    "__fprintf", "__sprintf", "__snprintf", "__mem", "__str", "__errno", "_errno", "__assert",
    "std::", "operator new", "operator delete", "_ZSt", "_ZNSt", "_ZTV", "_ZTI", "_ZTS",
    "??2@", "??3@", "??_", ".?AV", "__RTDynamicCast", "__RTCastToVoid",
)
CRT_CONTAINS = ("crt", "mingw", "libgcc", "libstdc++", "libc++", "msvcp", "ucrt", "vcruntime")
# Statically linked C library functions. GCC/MinGW keeps their real names; without this an agent would
# "decompile" malloc, memcpy and the printf family as if the game shipped them.
LIBC = {
    "malloc", "calloc", "realloc", "free", "memcpy", "memmove", "memset", "memcmp", "memchr",
    "strlen", "strcmp", "strncmp", "strcpy", "strncpy", "strcat", "strncat", "strstr", "strchr",
    "strrchr", "strdup", "strerror", "strtok", "strspn", "strcspn", "strpbrk", "strtol", "strtoul",
    "strtod", "atoi", "atol", "atof", "qsort", "bsearch", "abs", "labs",
    "printf", "fprintf", "sprintf", "snprintf", "vprintf", "vfprintf", "vsprintf", "vsnprintf",
    "puts", "putchar", "fputs", "fputc", "fgets", "fgetc", "fread", "fwrite", "fopen", "fclose",
    "fflush", "fseek", "ftell", "rewind", "feof", "ferror", "perror", "scanf", "sscanf",
    "exit", "abort", "atexit", "getenv", "setenv", "time", "clock", "rand", "srand", "system",
    "toupper", "tolower", "isalpha", "isdigit", "isspace", "isalnum", "isupper", "islower",
}


def kind(name: str) -> str | None:
    """'CRT', 'C++ runtime', 'static library' or None. Auto names are never guessed from their shape."""
    if not name or AUTO_NAME.match(name):
        return None
    if name in LIBC:
        return "C runtime"
    if name in CRT or name.startswith(("__scrt_", "mainCRTStartup", "WinMainCRTStartup", "wWinMainCRTStartup",
                                        "_GLOBAL__sub_I", "__libc_csu", "_dl_relocate", "__x86.get_pc_thunk",
                                        "deregister_tm_clones", "register_tm_clones", "_pei386",
                                        "__gcc_", "__gxx_", "__gnu_")):
        return "CRT"
    if name.startswith(("??2@", "??3@", "??_", ".?AV", "_ZTV", "_ZTI", "_ZTS", "_ZSt", "_ZNSt",
                        "std::", "operator new", "operator delete", "__cxa_", "__gxx_personality",
                        "_Unwind_", "__RTDynamicCast")):
        return "C++ runtime"
    if name.startswith(CRT_PREFIXES):
        return "CRT"
    if any(x in name.lower() for x in CRT_CONTAINS):
        return "static library"
    return None
