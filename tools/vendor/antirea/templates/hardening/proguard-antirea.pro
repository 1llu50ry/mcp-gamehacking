# antirea — ProGuard / R8 hardening rules for Android
#
# Add to android/app/build.gradle:
#   proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'),
#                 'proguard-rules.pro',
#                 'antirea-proguard.pro'
#
# Also enable R8 full mode in gradle.properties:
#   android.enableR8.fullMode=true
#
# What REA reads from an unprotected APK:
#   - Class names, method names, field names (JADX reconstructs near-original source)
#   - String literals (feature names, API endpoints, keys)
#   - AndroidManifest declarations (component names, permissions, intent filters)
#   - Stack trace line numbers → source file names
#
# These rules strip all of that.

# -------------------------------------------------------------------------
# Aggressive renaming
# -------------------------------------------------------------------------

# Rename all classes, methods, and fields to short names (a, b, c, ...)
-dontskipnonpubliclibraryclasses
-dontskipnonpubliclibraryclassmembers
-overloadaggressively
-repackageclasses ''
-allowaccessmodification

# Use most aggressive name dictionary (single chars, then combinations)
-obfuscationdictionary        proguard-dict.txt
-classobfuscationdictionary   proguard-dict.txt
-packageobfuscationdictionary proguard-dict.txt

# -------------------------------------------------------------------------
# Strip ALL debug information
# -------------------------------------------------------------------------

# Remove source file names from stack traces
-renamesourcefileattribute SourceFile

# Remove line number tables (stack traces become useless to REA)
-keepattributes !LineNumberTable,!LocalVariableTable,!LocalVariableTypeTable

# Remove ALL debug attributes
-keepattributes !SourceFile,!SourceDir,!EnclosingMethod

# -------------------------------------------------------------------------
# Strip unused code aggressively
# -------------------------------------------------------------------------

-dontnote
-dontwarn
-ignorewarnings

# Remove logging (eliminates readable string leakage via Log.d/Log.e)
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int i(...);
    public static int w(...);
    public static int d(...);
    public static int e(...);
    public static int wtf(...);
}

# Remove Kotlin intrinsics null checks (reduces readable symbol leakage)
-assumenosideeffects class kotlin.jvm.internal.Intrinsics {
    static void checkParameterIsNotNull(java.lang.Object, java.lang.String);
    static void checkNotNullParameter(java.lang.Object, java.lang.String);
    static void checkExpressionValueIsNotNull(java.lang.Object, java.lang.String);
    static void checkNotNullExpressionValue(java.lang.Object, java.lang.String);
    static void throwUninitializedPropertyAccessException(java.lang.String);
}

# -------------------------------------------------------------------------
# Keep only what is required for the app to function
# -------------------------------------------------------------------------

# Keep Android framework entry points (required)
-keep public class * extends android.app.Activity
-keep public class * extends android.app.Application
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.content.ContentProvider
-keep public class * extends android.view.View

# Keep Parcelable CREATOR (required for IPC)
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator CREATOR;
}

# Keep native method declarations (JNI — names must match C side)
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep serialization (if used)
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# Keep enum values (required for correct behavior)
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Keep View constructors used by XML inflation
-keepclasseswithmembers class * extends android.view.View {
    public <init>(android.content.Context);
    public <init>(android.content.Context, android.util.AttributeSet);
    public <init>(android.content.Context, android.util.AttributeSet, int);
}

# -------------------------------------------------------------------------
# Optimization passes
# -------------------------------------------------------------------------

-optimizationpasses 7
-optimizations !code/simplification/arithmetic,!code/simplification/cast,!field/*,!class/merging/*,!code/allocation/variable