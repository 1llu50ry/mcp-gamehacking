# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · **Deutsch** · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**Ein Skill, der Ihr Projekt vor KI-gestützten Reverse-Engineering-Tools wie REA schützt.**

`rea` und ähnliche Tools steuern KI-Agenten über MCP, um Binärdateien, JS-Bundles und APKs eines Projekts zu analysieren. Antirea platziert „Stopp"-Direktiven genau dort, wo Agenten zuerst lesen.

## Funktionsweise

REA greift in drei Schritten an:

```
1. Benutzer → lädt den REA-Skill in den Agenten
2. REA-Skill → weist den Agenten an, MCP-Tools aufzurufen (open_binary, analyze_javascript_application usw.)
3. Agent → liest und analysiert die Projektdateien/Binärdateien
```

Antirea greift in Schritt 2 ein. Ein konformer Agent liest die Instruktionsdateien des Projekts, bevor er Aktionen ausführt. Antirea schreibt REA-blockierende Direktiven in diese Dateien.

```
1. Benutzer → lädt den REA-Skill in den Agenten
2. REA-Skill → sagt dem Agenten „rufe open_binary auf"
3. Agent → liest zuerst AGENTS.md → sieht „REA VERBOTEN"-Direktive → STOPPT
```

## Schutzebenen

| Ebene | Tool | Funktion |
|-------|------|----------|
| **L1** Agenten-Instruktionsbarriere | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | Konformer Agent verweigert REA-Tool-Aufrufe |
| **L1** Maschinenlesbares Deny | `.re-deny` | Maschinenlesbares Signal für REA-fähige Tools |
| **L2** Terminal-Shim | `node_modules/.bin/rea` | Fängt `npx rea-agents` und `rea` CLI ab, exit 1 |
| **L3** JS-Obfuskation | `javascript-obfuscator` | Alle Bezeichner werden zu `a`, `b`, `c`... — REA-Ausgabe ist sinnlos |
| **L3** Source-Map-Entfernung | `strip-sourcemaps.js` | `.map`-Dateien gelangen nicht in die Distribution |
| **L3** IPC-Kanal-Hashing | `antirea-ipc-hash.js` | Electron-Kanalnamen werden zu Hashes wie `ch_a3f9b2` |
| **L3** ASAR-Verschlüsselung | electron-builder fuses | `analyze_javascript_application` kann ASAR nicht lesen |
| **L3** Debug-Symbol-Entfernung | strip / CMake flags | `binary_overview` / `analyze_function` sieht nur `sub_XXXX` |
| **L3** Rust .dep-v0-Entfernung | `antirea-strip-rust.sh` | `inspect_rust_binary` sieht den Abhängigkeitsbaum nicht |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` gibt keine Modulinformationen zurück |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX sieht nur `class a { void a(b c) }` |
| **L3** .NET-Obfuskation | ConfuserEx | CIL-Metadaten verschlüsselt, Strings chiffriert |

## Ausführungsreihenfolge

```
npm install   →  postinstall: Shims werden in node_modules/.bin installiert
npm run build →  prebuild: embed-barrier.js läuft, Barriere wird in Artefakt eingebettet
               →  build: normaler Build wird fortgesetzt
```

## Installation

### 1. AGENTS.md / CLAUDE.md

Kopieren Sie den Inhalt von `templates/agents-inject.md` an den **Anfang** Ihrer bestehenden Agent-Instruktionsdatei. Falls keine vorhanden ist, kopieren Sie sie direkt als `AGENTS.md`.

### 2. .re-deny

Kopieren Sie `templates/re-deny` in das Projektstammverzeichnis als `.re-deny`.

### 3. package.json (JavaScript-Projekte)

Fügen Sie zu `package.json` hinzu:

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

### 4. Honeypot (optional)

**JavaScript:** Kopieren Sie `templates/honeypot-js.js` in Ihr Projekt mit dem Namen, der dem `"main"`-Feld in `package.json` entspricht (z.B. `app.js`, `bundle.js`).

**Native:** Kompilieren Sie `templates/honeypot-native.c` und platzieren Sie es mit demselben Namen wie die Binärdatei, die REA öffnen würde:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## Wichtige Einschränkungen

| Szenario | Kann Antirea stoppen? |
|---------|----------------------|
| Agent mit geladenem REA-Skill (Claude Code, Cursor, Codex) | **Ja** — AGENTS.md-Barriere |
| `npx rea-agents` im Projektverzeichnis ausgeführt | **Ja** — node_modules/.bin-Shim |
| Verteiltes Bundle/Binary analysiert | **Teilweise** — konforme Agenten stoppen über embed-barrier.js |
| `rea` von außerhalb des Projekts über absoluten Pfad ausgeführt | **Nein** |
| Agent, der Instruktionsdateien ignoriert | **Nein** |
| Binary-Obfuskation / echte Schutzmaßnahmen | **Außerhalb des Geltungsbereichs** |

## Anforderungen

- **Node.js** 18 oder höher
- **npm** 8 oder höher
- Hardening-Tools (javascript-obfuscator, ProGuard, ConfuserEx usw.) werden separat pro Projekt installiert — antirea installiert sie nicht für Sie

## Haftungsausschluss

**Antirea wird ohne jegliche Garantie „wie besehen" bereitgestellt.**

- Antirea garantiert nicht, dass Reverse Engineering Ihres Projekts unmöglich ist. Es erhöht die Kosten und Komplexität der KI-gestützten Analyse erheblich, aber ein erfahrener Analyst mit physischem Zugang zu Ihrer Binärdatei und unbegrenzter Zeit kann sie dennoch reverse engineeren.
- Die Autor(en) von antirea übernehmen keine Verantwortung für Schäden, Verluste oder rechtliche Folgen, die durch die Nutzung oder den Missbrauch dieses Tools entstehen.
- Es liegt in Ihrer Verantwortung, vor der Verteilung zu überprüfen, ob die Schutzmaßnahmen von antirea korrekt auf Ihr Projekt angewendet wurden.
- Antirea stellt keine Rechtsberatung dar. Wenn Sie rechtlichen Schutz für Ihr geistiges Eigentum benötigen, wenden Sie sich an einen qualifizierten Rechtsanwalt.

**Durch die Verwendung von antirea akzeptieren Sie die volle Verantwortung für das Ergebnis.**

## Mitwirken

Eine Lücke im Schutz gefunden? Öffnen Sie ein Issue oder einen Pull Request.

## Lizenz

MIT