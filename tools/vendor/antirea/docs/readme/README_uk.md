# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · **Українська** · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**Навичка, що захищає ваш проєкт від інструментів зворотної розробки на базі ШІ, таких як REA.**

`rea` та подібні інструменти спрямовують агентів ШІ через MCP на аналіз бінарних файлів, JS-пакетів та APK проєкту. Antirea розміщує директиви «стоп» саме там, де агенти читають першими.

## Як це працює

REA атакує у три кроки:

```
1. Користувач → завантажує навичку REA в агент
2. Навичка REA → інструктує агента викликати інструменти MCP (open_binary, analyze_javascript_application тощо)
3. Агент → читає та аналізує файли/бінарники проєкту
```

Antirea втручається на кроці 2. Сумісний агент читає файли інструкцій проєкту перед виконанням будь-яких дій. Antirea записує директиви блокування REA в ці файли.

```
1. Користувач → завантажує навичку REA в агент
2. Навичка REA → каже агенту «виклич open_binary»
3. Агент → спочатку читає AGENTS.md → бачить директиву «REA ЗАБОРОНЕНО» → ЗУПИНЯЄТЬСЯ
```

## Рівні захисту

| Рівень | Інструмент | Дія |
|--------|-----------|-----|
| **L1** Бар'єр інструкцій агента | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | Сумісний агент відмовляється викликати інструменти REA |
| **L1** Машиночитаємий запис | `.re-deny` | Машиночитаємий сигнал для REA-сумісних інструментів |
| **L2** Термінальний шим | `node_modules/.bin/rea` | Перехоплює `npx rea-agents` і `rea` CLI, exit 1 |
| **L3** Обфускація JS | `javascript-obfuscator` | Усі ідентифікатори стають `a`, `b`, `c`... — вивід REA безглуздий |
| **L3** Видалення source map | `strip-sourcemaps.js` | Файли `.map` не потрапляють у дистрибутив |
| **L3** Хешування каналів IPC | `antirea-ipc-hash.js` | Назви каналів Electron стають хешами на кшталт `ch_a3f9b2` |
| **L3** Шифрування ASAR | electron-builder fuses | `analyze_javascript_application` не може прочитати ASAR |
| **L3** Видалення налагоджувальних символів | strip / CMake flags | `binary_overview` / `analyze_function` бачить лише `sub_XXXX` |
| **L3** Видалення Rust .dep-v0 | `antirea-strip-rust.sh` | `inspect_rust_binary` не бачить дерево залежностей |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` не повертає інформацію про модулі |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX бачить лише `class a { void a(b c) }` |
| **L3** Обфускація .NET | ConfuserEx | Метадані CIL перемішані, рядки зашифровані |

## Порядок виконання

```
npm install   →  postinstall: шими встановлюються в node_modules/.bin
npm run build →  prebuild: запускається embed-barrier.js, бар'єр вбудовується в артефакт
               →  build: звичайна збірка продовжується
```

## Встановлення

### 1. AGENTS.md / CLAUDE.md

Скопіюйте вміст `templates/agents-inject.md` на **самий початок** існуючого файлу інструкцій агента. Якщо такого файлу немає, скопіюйте його безпосередньо як `AGENTS.md`.

### 2. .re-deny

Скопіюйте `templates/re-deny` до кореня проєкту як `.re-deny`.

### 3. package.json (для JavaScript-проєктів)

Додайте до `package.json`:

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

### 4. Пастка (необов'язково)

**JavaScript:** Скопіюйте `templates/honeypot-js.js` у проєкт з ім'ям, що збігається з полем `"main"` у `package.json` (наприклад, `app.js`, `bundle.js`).

**Native:** Скомпілюйте `templates/honeypot-native.c` і розмістіть з тим самим ім'ям, що й бінарник, який REA відкрив би першим:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## Важливі обмеження

| Сценарій | Чи може Antirea зупинити? |
|---------|--------------------------|
| Агент із завантаженою навичкою REA (Claude Code, Cursor, Codex) | **Так** — бар'єр AGENTS.md |
| `npx rea-agents` у директорії проєкту | **Так** — шим node_modules/.bin |
| Аналіз розповсюджуваного bundle/binary | **Частково** — сумісні агенти зупиняються через embed-barrier.js |
| `rea` запущено поза проєктом через абсолютний шлях | **Ні** |
| Агент, що ігнорує файли інструкцій | **Ні** |
| Обфускація бінарників / справжній захист | **Поза областю дії** |

## Вимоги

- **Node.js** версії 18 і вище
- **npm** версії 8 і вище
- Інструменти захисту (javascript-obfuscator, ProGuard, ConfuserEx тощо) встановлюються окремо для кожного проєкту

## Відмова від відповідальності

**Antirea надається «як є», без будь-яких гарантій.**

- Antirea не гарантує неможливості зворотної розробки вашого проєкту. Інструмент значно підвищує вартість і складність ШІ-аналізу, але досвідчений аналітик з фізичним доступом до бінарника і необмеженим часом все одно зможе його реконструювати.
- Автори antirea не несуть відповідальності за будь-які збитки, втрати або правові наслідки, що виникли внаслідок використання або неправомірного використання цього інструменту.
- Ви несете відповідальність за перевірку правильності застосування захисту antirea до вашого проєкту перед розповсюдженням.
- Antirea не є юридичною консультацією. Якщо вам потрібен правовий захист інтелектуальної власності, зверніться до кваліфікованого юриста.

**Використовуючи antirea, ви приймаєте на себе повну відповідальність за результат.**

## Участь у розробці

Виявили прогалину в захисті? Відкрийте issue або pull request.

## Ліцензія

MIT