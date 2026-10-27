---
name: jvm-native-obfuscation
description: "Native-side Java obfuscation (`native_jvm.hpp`) — JNI calls that hand JVM bytecode off to a native loader that decrypts + defines classes at runtime. Defeats static JAR/APK decompilation."
metadata:
  type: reference
  source: curated
  topics: [jvm, jni, java, defineclass, native-obfuscation]
---
# Native JVM obfuscation

Idea: Java bytecode never lives on disk in plaintext. A native shim loads encrypted class blobs, decrypts them in native memory, and calls `JNIEnv::DefineClass` to hand them to the JVM at runtime.

## Flow

1. Protected JAR / APK ships encrypted class blobs as raw resources.
2. At app start, native lib (`libnative_jvm.so` / `.dll`) is loaded by a stub.
3. Native lib reads blobs, decrypts (AES / XOR / custom).
4. `env->DefineClass(name, classLoader, bytes, len)` registers the class.
5. Call sites use `env->CallStaticVoidMethod` on these dynamically-registered classes.

## Why it matters

- JADX / dex2jar / CFR see only the stub classes.
- Dynamic analysis (Frida) sees them after `DefineClass` returns.

## Related

[[dex-analyzer]], [[frida-mcp]], [[il2cpp-string-decrypt]].
