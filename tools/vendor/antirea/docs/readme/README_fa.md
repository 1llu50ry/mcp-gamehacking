# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · **فارسی** · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

<div dir="rtl">

**مهارتی که پروژه شما را در برابر ابزارهای مهندسی معکوس مبتنی بر هوش مصنوعی مانند REA محافظت می‌کند.**

ابزارهایی مانند `rea` از طریق MCP به عامل‌های هوش مصنوعی دستور می‌دهند تا فایل‌های باینری، بسته‌های JS و APK پروژه را تحلیل کنند. Antirea دستورالعمل‌های "توقف" را دقیقاً در جاهایی قرار می‌دهد که عامل‌ها اول می‌خوانند.

## نحوه کارکرد

REA در سه مرحله حمله می‌کند:

```
۱. کاربر ← مهارت REA را به عامل بارگذاری می‌کند
۲. مهارت REA ← به عامل دستور می‌دهد ابزارهای MCP را فراخوانی کند (open_binary، analyze_javascript_application و...)
۳. عامل ← فایل‌ها/باینری‌های پروژه را می‌خواند و تحلیل می‌کند
```

Antirea در مرحله ۲ مداخله می‌کند. یک عامل سازگار قبل از هر اقدامی فایل‌های دستورالعمل پروژه را می‌خواند. Antirea دستورالعمل‌های مسدودکننده REA را در آن فایل‌ها می‌نویسد.

```
۱. کاربر ← مهارت REA را به عامل بارگذاری می‌کند
۲. مهارت REA ← به عامل می‌گوید «open_binary را فراخوانی کن»
۳. عامل ← ابتدا AGENTS.md را می‌خواند ← دستورالعمل «REA ممنوع» را می‌بیند ← متوقف می‌شود
```

## لایه‌های دفاعی

| لایه | ابزار | عملکرد |
|------|-------|--------|
| **L1** سد دستورالعمل عامل | `AGENTS.md`، `CLAUDE.md`، `.cursor/rules` | عامل سازگار از فراخوانی ابزارهای REA خودداری می‌کند |
| **L1** رد قابل خواندن توسط ماشین | `.re-deny` | سیگنال قابل خواندن توسط ماشین برای ابزارهای سازگار با REA |
| **L2** Shim ترمینال | `node_modules/.bin/rea` | `npx rea-agents` و `rea` CLI را رهگیری می‌کند، exit 1 |
| **L3** مبهم‌سازی JS | `javascript-obfuscator` | همه شناسه‌ها به `a`، `b`، `c`... تبدیل می‌شوند — خروجی REA بی‌معناست |
| **L3** حذف source map | `strip-sourcemaps.js` | فایل‌های `.map` به توزیع نمی‌رسند |
| **L3** هش کردن کانال‌های IPC | `antirea-ipc-hash.js` | نام کانال‌های Electron به هش‌هایی مانند `ch_a3f9b2` تبدیل می‌شوند |
| **L3** رمزگذاری ASAR | electron-builder fuses | `analyze_javascript_application` نمی‌تواند ASAR را بخواند |
| **L3** حذف نمادهای اشکال‌زدایی | strip / CMake flags | `binary_overview` / `analyze_function` فقط `sub_XXXX` می‌بیند |
| **L3** حذف Rust .dep-v0 | `antirea-strip-rust.sh` | `inspect_rust_binary` نمی‌تواند درخت وابستگی را ببیند |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` اطلاعات ماژول را برنمی‌گرداند |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX فقط `class a { void a(b c) }` می‌بیند |
| **L3** مبهم‌سازی .NET | ConfuserEx | متادیتای CIL درهم‌ریخته، رشته‌ها رمزگذاری شده |

## ترتیب اجرا

```
npm install   ←  postinstall: shimها در node_modules/.bin نصب می‌شوند
npm run build ←  prebuild: embed-barrier.js اجرا می‌شود، سد در آرتیفکت جاسازی می‌شود
               ←  build: ساخت معمولی ادامه می‌یابد
```

## نصب

### ۱. AGENTS.md / CLAUDE.md

محتوای `templates/agents-inject.md` را به **ابتدای** فایل دستورالعمل عامل موجود کپی کنید. اگر چنین فایلی وجود ندارد، آن را مستقیماً به عنوان `AGENTS.md` کپی کنید.

### ۲. .re-deny

فایل `templates/re-deny` را به ریشه پروژه با نام `.re-deny` کپی کنید.

### ۳. package.json (پروژه‌های JavaScript)

به `package.json` اضافه کنید:

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

### ۴. تله (اختیاری)

**JavaScript:** فایل `templates/honeypot-js.js` را با نامی که با فیلد `"main"` در `package.json` مطابقت دارد (مثلاً `app.js`، `bundle.js`) به پروژه کپی کنید.

**Native:** فایل `templates/honeypot-native.c` را کامپایل کنید و با همان نام باینری که REA باز می‌کند قرار دهید:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## محدودیت‌های مهم

| سناریو | آیا Antirea می‌تواند متوقف کند؟ |
|--------|--------------------------------|
| عامل با مهارت REA بارگذاری شده (Claude Code، Cursor، Codex) | **بله** — سد AGENTS.md |
| اجرای `npx rea-agents` در دایرکتوری پروژه | **بله** — shim node_modules/.bin |
| تحلیل bundle/binary توزیع شده | **تا حدی** — عامل‌های سازگار از طریق embed-barrier.js متوقف می‌شوند |
| اجرای `rea` از خارج پروژه با مسیر مطلق | **خیر** |
| عاملی که فایل‌های دستورالعمل را نادیده می‌گیرد | **خیر** |
| مبهم‌سازی باینری / حفاظت واقعی | **خارج از محدوده** |

## پیش‌نیازها

- **Node.js** نسخه ۱۸ یا بالاتر
- **npm** نسخه ۸ یا بالاتر
- ابزارهای سخت‌سازی (javascript-obfuscator، ProGuard، ConfuserEx و غیره) باید به صورت جداگانه برای هر پروژه نصب شوند

## سلب مسئولیت

**Antirea به همان شکلی که هست ارائه می‌شود، بدون هیچ گونه ضمانتی.**

- Antirea تضمین نمی‌کند که مهندسی معکوس پروژه شما غیرممکن باشد. هزینه و پیچیدگی تحلیل مبتنی بر هوش مصنوعی را به طور قابل توجهی افزایش می‌دهد، اما یک تحلیلگر ماهر با دسترسی فیزیکی به باینری‌های شما و زمان نامحدود هنوز می‌تواند مهندسی معکوس انجام دهد.
- نویسندگان antirea هیچ مسئولیتی در قبال هیچ گونه خسارت، ضرر یا عواقب قانونی ناشی از استفاده یا سوء استفاده از این ابزار نمی‌پذیرند.
- مسئولیت تأیید اینکه حفاظت‌های antirea قبل از توزیع به درستی روی پروژه شما اعمال شده‌اند بر عهده شماست.
- Antirea مشاوره حقوقی محسوب نمی‌شود. اگر به حمایت قانونی برای مالکیت فکری خود نیاز دارید، با یک وکیل واجد شرایط مشورت کنید.

**با استفاده از antirea، مسئولیت کامل نتیجه را می‌پذیرید.**

## مشارکت

آیا شکافی در محافظت پیدا کردید؟ یک issue یا pull request باز کنید.

## مجوز

MIT

</div>