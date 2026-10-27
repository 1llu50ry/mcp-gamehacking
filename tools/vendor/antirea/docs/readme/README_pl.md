# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · **Polski** · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**Skill chroniący Twój projekt przed narzędziami inżynierii wstecznej opartymi na AI, takimi jak REA.**

`rea` i podobne narzędzia kierują agentami AI przez MCP w celu analizy plików binarnych, pakietów JS i APK projektu. Antirea umieszcza dyrektywy „stop" dokładnie tam, gdzie agenci czytają jako pierwsi.

## Jak to działa

REA atakuje w trzech krokach:

```
1. Użytkownik → ładuje skill REA do agenta
2. Skill REA → instruuje agenta do wywoływania narzędzi MCP (open_binary, analyze_javascript_application itp.)
3. Agent → czyta i analizuje pliki/binaria projektu
```

Antirea interweniuje w kroku 2. Zgodny agent czyta pliki instrukcji projektu przed podjęciem jakichkolwiek działań. Antirea zapisuje dyrektywy blokujące REA w tych plikach.

```
1. Użytkownik → ładuje skill REA do agenta
2. Skill REA → mówi agentowi „wywołaj open_binary"
3. Agent → najpierw czyta AGENTS.md → widzi dyrektywę „REA ZABRONIONE" → ZATRZYMUJE SIĘ
```

## Warstwy obrony

| Warstwa | Narzędzie | Funkcja |
|---------|----------|---------|
| **L1** Bariera instrukcji agenta | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | Zgodny agent odmawia wywoływania narzędzi REA |
| **L1** Odmowa czytelna maszynowo | `.re-deny` | Sygnał czytelny maszynowo dla narzędzi obsługujących REA |
| **L2** Shim terminala | `node_modules/.bin/rea` | Przechwytuje `npx rea-agents` i `rea` CLI, exit 1 |
| **L3** Obfuskacja JS | `javascript-obfuscator` | Wszystkie identyfikatory stają się `a`, `b`, `c`... — wyjście REA bez sensu |
| **L3** Usuwanie source map | `strip-sourcemaps.js` | Pliki `.map` nie trafiają do dystrybucji |
| **L3** Haszowanie kanałów IPC | `antirea-ipc-hash.js` | Nazwy kanałów Electron stają się hashami jak `ch_a3f9b2` |
| **L3** Szyfrowanie ASAR | electron-builder fuses | `analyze_javascript_application` nie może odczytać ASAR |
| **L3** Usuwanie symboli debugowania | strip / CMake flags | `binary_overview` / `analyze_function` widzi tylko `sub_XXXX` |
| **L3** Usuwanie Rust .dep-v0 | `antirea-strip-rust.sh` | `inspect_rust_binary` nie widzi drzewa zależności |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` nie zwraca informacji o modułach |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX widzi tylko `class a { void a(b c) }` |
| **L3** Obfuskacja .NET | ConfuserEx | Metadane CIL pomieszane, ciągi zaszyfrowane |

## Kolejność wykonania

```
npm install   →  postinstall: shimy instalowane do node_modules/.bin
npm run build →  prebuild: embed-barrier.js uruchamia się, bariera wbudowana w artefakt
               →  build: normalny build kontynuowany
```

## Instalacja

### 1. AGENTS.md / CLAUDE.md

Skopiuj zawartość `templates/agents-inject.md` na **sam początek** istniejącego pliku instrukcji agenta. Jeśli nie istnieje żaden, skopiuj go bezpośrednio jako `AGENTS.md`.

### 2. .re-deny

Skopiuj `templates/re-deny` do katalogu głównego projektu jako `.re-deny`.

### 3. package.json (projekty JavaScript)

Dodaj do `package.json`:

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

### 4. Honeypot (opcjonalnie)

**JavaScript:** Skopiuj `templates/honeypot-js.js` do projektu z nazwą odpowiadającą polu `"main"` w `package.json` (np. `app.js`, `bundle.js`).

**Native:** Skompiluj `templates/honeypot-native.c` i umieść z tą samą nazwą co binarny, który REA by otworzył:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## Ważne ograniczenia

| Scenariusz | Czy Antirea może zatrzymać? |
|-----------|----------------------------|
| Agent z załadowanym skillem REA (Claude Code, Cursor, Codex) | **Tak** — bariera AGENTS.md |
| `npx rea-agents` uruchomiony w katalogu projektu | **Tak** — shim node_modules/.bin |
| Dystrybuowany bundle/binary analizowany | **Częściowo** — zgodne agenty zatrzymują się przez embed-barrier.js |
| `rea` uruchomiony spoza projektu przez ścieżkę absolutną | **Nie** |
| Agent ignorujący pliki instrukcji | **Nie** |
| Obfuskacja binariów / prawdziwa ochrona | **Poza zakresem** |

## Wymagania

- **Node.js** 18 lub nowszy
- **npm** 8 lub nowszy
- Narzędzia hardening (javascript-obfuscator, ProGuard, ConfuserEx itp.) są instalowane osobno dla każdego projektu

## Zastrzeżenie

**Antirea jest dostarczane w stanie takim, jakim jest, bez jakichkolwiek gwarancji.**

- Antirea nie gwarantuje, że inżynieria wsteczna Twojego projektu jest niemożliwa. Znacznie zwiększa koszt i złożoność analizy wspomaganej przez AI, ale doświadczony analityk z fizycznym dostępem do binarnego i nieograniczonym czasem nadal może przeprowadzić inżynierię wsteczną.
- Autor(zy) antirea nie ponoszą odpowiedzialności za jakiekolwiek szkody, straty lub konsekwencje prawne wynikające z użycia lub nadużycia tego narzędzia.
- Twoim obowiązkiem jest weryfikacja, że ochrony antirea są prawidłowo zastosowane przed dystrybucją.
- Antirea nie stanowi porady prawnej. Jeśli potrzebujesz ochrony prawnej dla swojej własności intelektualnej, skonsultuj się z wykwalifikowanym prawnikiem.

**Używając antirea, akceptujesz pełną odpowiedzialność za wynik.**

## Wkład

Znalazłeś lukę w ochronie? Otwórz issue lub pull request.

## Licencja

MIT