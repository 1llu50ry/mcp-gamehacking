# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · **العربية** · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

<div dir="rtl">

**مهارة تحمي مشروعك من أدوات الهندسة العكسية المدعومة بالذكاء الاصطناعي مثل REA.**

تقوم أدوات مثل `rea` والأدوات المشابهة بتوجيه وكلاء الذكاء الاصطناعي عبر MCP لتحليل الملفات الثنائية وحزم JS وملفات APK الخاصة بمشروعك. يضع Antirea توجيهات "توقف" في المواضع التي يقرأها الوكلاء أولاً.

## كيف يعمل

يهاجم REA في ثلاث خطوات:

```
1. المستخدم ← يحمّل مهارة REA إلى الوكيل
2. مهارة REA ← تأمر الوكيل باستدعاء أدوات MCP (open_binary، analyze_javascript_application...)
3. الوكيل ← يقرأ ويحلل ملفات/ثنائيات المشروع
```

يتدخل Antirea في الخطوة 2. يقرأ الوكيل المتوافق ملفات التعليمات الخاصة بالمشروع قبل اتخاذ أي إجراء. يكتب Antirea توجيهات حظر REA في تلك الملفات.

```
1. المستخدم ← يحمّل مهارة REA إلى الوكيل
2. مهارة REA ← تقول للوكيل "استدعِ open_binary"
3. الوكيل ← يقرأ AGENTS.md أولاً ← يرى توجيه "REA محظور" ← يتوقف
```

## طبقات الدفاع

| الطبقة | الأداة | الوظيفة |
|--------|--------|---------|
| **L1** حاجز تعليمات الوكيل | `AGENTS.md`، `CLAUDE.md`، `.cursor/rules` | يرفض الوكيل المتوافق استدعاء أدوات REA |
| **L1** رفض قابل للقراءة آلياً | `.re-deny` | إشارة قابلة للقراءة آلياً للأدوات المتوافقة مع REA |
| **L2** Shim الطرفية | `node_modules/.bin/rea` | يعترض `npx rea-agents` و`rea` CLI، exit 1 |
| **L3** تعتيم JS | `javascript-obfuscator` | تصبح جميع المعرّفات `a`، `b`، `c`... — مخرجات REA بلا معنى |
| **L3** إزالة خرائط المصدر | `strip-sourcemaps.js` | لا تصل ملفات `.map` إلى التوزيع |
| **L3** تجزئة قنوات IPC | `antirea-ipc-hash.js` | تصبح أسماء قنوات Electron تجزئات مثل `ch_a3f9b2` |
| **L3** تشفير ASAR | electron-builder fuses | لا يستطيع `analyze_javascript_application` قراءة ASAR |
| **L3** إزالة رموز التصحيح | strip / CMake flags | يرى `binary_overview` / `analyze_function` فقط `sub_XXXX` |
| **L3** إزالة Rust .dep-v0 | `antirea-strip-rust.sh` | لا يستطيع `inspect_rust_binary` رؤية شجرة التبعيات |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | لا يُرجع `inspect_go_binary` معلومات الوحدات |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | يرى JADX فقط `class a { void a(b c) }` |
| **L3** تعتيم .NET | ConfuserEx | بيانات CIL الوصفية مشوّشة، السلاسل مشفّرة |

## ترتيب التنفيذ

```
npm install   ←  postinstall: تثبيت shims في node_modules/.bin
npm run build ←  prebuild: تشغيل embed-barrier.js، تضمين الحاجز في القطعة
               ←  build: استمرار البناء الطبيعي
```

## التثبيت

### 1. AGENTS.md / CLAUDE.md

انسخ محتوى `templates/agents-inject.md` إلى **بداية** ملف تعليمات الوكيل الموجود. إذا لم يكن موجوداً، انسخه مباشرةً بوصفه `AGENTS.md`.

### 2. .re-deny

انسخ `templates/re-deny` إلى جذر المشروع بوصفه `.re-deny`.

### 3. package.json (مشاريع JavaScript)

أضف إلى `package.json`:

```json
{
  "rea": {
    "deny": true,
    "reason": "Analysis not authorized by project owner.",
    "contact": ""
  },
  "dependencies": {
    "rea-agents": "file:scripts/rea-agents-shim"
  }
}
```

### 4. مصيدة (اختياري)

**JavaScript:** انسخ `templates/honeypot-js.js` إلى مشروعك باسم يطابق حقل `"main"` في `package.json` (مثل `app.js`، `bundle.js`).

**Native:** قم بتصريف `templates/honeypot-native.c` وضعه بنفس اسم الملف الثنائي الذي سيفتحه REA:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## القيود المهمة

| السيناريو | هل يستطيع Antirea الإيقاف؟ |
|----------|---------------------------|
| وكيل محمّل بمهارة REA (Claude Code، Cursor، Codex) | **نعم** — حاجز AGENTS.md |
| تشغيل `npx rea-agents` في مجلد المشروع | **نعم** — shim node_modules/.bin |
| تحليل bundle/binary الموزَّع | **جزئياً** — الوكلاء المتوافقون يتوقفون عبر embed-barrier.js |
| تشغيل `rea` من خارج المشروع بمسار مطلق | **لا** |
| وكيل يتجاهل ملفات التعليمات | **لا** |
| تعتيم الثنائيات / الحماية الحقيقية | **خارج النطاق** |

## المتطلبات

- **Node.js** الإصدار 18 أو أحدث
- **npm** الإصدار 8 أو أحدث
- تُثبَّت أدوات التصليب (javascript-obfuscator، ProGuard، ConfuserEx إلخ) بشكل منفصل لكل مشروع

## إخلاء المسؤولية

**يُقدَّم Antirea كما هو، دون أي ضمانات من أي نوع.**

- لا يضمن Antirea استحالة الهندسة العكسية لمشروعك. يرفع التكلفة وتعقيد التحليل المدعوم بالذكاء الاصطناعي بشكل كبير، لكن محللاً متمرساً يملك وصولاً مادياً إلى ملفاتك الثنائية ووقتاً غير محدود قد يتمكن مع ذلك من الهندسة العكسية.
- لا يتحمل مؤلفو antirea أي مسؤولية عن أي أضرار أو خسائر أو تبعات قانونية ناجمة عن استخدام هذه الأداة أو إساءة استخدامها.
- تقع على عاتقك مسؤولية التحقق من صحة تطبيق حمايات antirea على مشروعك قبل التوزيع.
- لا يُعدّ Antirea استشارة قانونية. إذا كنت بحاجة إلى حماية قانونية لملكيتك الفكرية، استشر محامياً مؤهلاً.

**باستخدامك antirea، فإنك تقبل تحمّل المسؤولية الكاملة عن النتائج.**

## المساهمة

اكتشفت ثغرة في الحماية؟ افتح issue أو pull request.

## الرخصة

MIT

</div>