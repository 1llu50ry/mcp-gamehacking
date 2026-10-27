# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · **Italiano** · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**Uno skill che protegge il tuo progetto dagli strumenti di reverse engineering basati su AI come REA.**

`rea` e strumenti simili dirigono gli agenti AI tramite MCP per analizzare i binari, i bundle JS e gli APK del progetto. Antirea posiziona direttive di "stop" esattamente nei punti che gli agenti leggono per primi.

## Come funziona

REA attacca in tre fasi:

```
1. Utente → carica lo skill REA nell'agente
2. Skill REA → istruisce l'agente a chiamare strumenti MCP (open_binary, analyze_javascript_application ecc.)
3. Agente → legge e analizza i file/binari del progetto
```

Antirea interviene nella fase 2. Un agente conforme legge i file di istruzioni del progetto prima di intraprendere qualsiasi azione. Antirea scrive direttive di blocco REA in quei file.

```
1. Utente → carica lo skill REA nell'agente
2. Skill REA → dice all'agente "chiama open_binary"
3. Agente → legge prima AGENTS.md → vede la direttiva "REA VIETATO" → SI FERMA
```

## Livelli di difesa

| Livello | Strumento | Funzione |
|---------|----------|----------|
| **L1** Barriera istruzioni agente | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | L'agente conforme rifiuta di chiamare gli strumenti REA |
| **L1** Negazione leggibile da macchina | `.re-deny` | Segnale leggibile da macchina per strumenti compatibili con REA |
| **L2** Shim terminale | `node_modules/.bin/rea` | Intercetta `npx rea-agents` e `rea` CLI, exit 1 |
| **L3** Offuscazione JS | `javascript-obfuscator` | Tutti gli identificatori diventano `a`, `b`, `c`... — output REA privo di senso |
| **L3** Rimozione source map | `strip-sourcemaps.js` | I file `.map` non raggiungono la distribuzione |
| **L3** Hashing canali IPC | `antirea-ipc-hash.js` | I nomi dei canali Electron diventano hash come `ch_a3f9b2` |
| **L3** Cifratura ASAR | electron-builder fuses | `analyze_javascript_application` non riesce a leggere l'ASAR |
| **L3** Rimozione simboli di debug | strip / CMake flags | `binary_overview` / `analyze_function` vede solo `sub_XXXX` |
| **L3** Rimozione Rust .dep-v0 | `antirea-strip-rust.sh` | `inspect_rust_binary` non vede l'albero delle dipendenze |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` non restituisce informazioni sui moduli |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX vede solo `class a { void a(b c) }` |
| **L3** Offuscazione .NET | ConfuserEx | Metadati CIL mescolati, stringhe cifrate |

## Ordine di esecuzione

```
npm install   →  postinstall: gli shim vengono installati in node_modules/.bin
npm run build →  prebuild: embed-barrier.js viene eseguito, la barriera viene incorporata nell'artefatto
               →  build: il build normale continua
```

## Installazione

### 1. AGENTS.md / CLAUDE.md

Copia il contenuto di `templates/agents-inject.md` all'**inizio** del tuo file di istruzioni agente esistente. Se non ne esiste uno, copialo direttamente come `AGENTS.md`.

### 2. .re-deny

Copia `templates/re-deny` nella directory principale del progetto come `.re-deny`.

### 3. package.json (progetti JavaScript)

Aggiungi a `package.json`:

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

### 4. Honeypot (opzionale)

**JavaScript:** Copia `templates/honeypot-js.js` nel tuo progetto con il nome corrispondente al campo `"main"` in `package.json` (es. `app.js`, `bundle.js`).

**Native:** Compila `templates/honeypot-native.c` e posizionalo con lo stesso nome del binario che REA aprirebbe:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## Limiti importanti

| Scenario | Antirea può fermare? |
|---------|---------------------|
| Agente con skill REA caricato (Claude Code, Cursor, Codex) | **Sì** — barriera AGENTS.md |
| `npx rea-agents` eseguito nella directory del progetto | **Sì** — shim node_modules/.bin |
| Bundle/binary distribuito analizzato | **Parzialmente** — agenti conformi si fermano tramite embed-barrier.js |
| `rea` eseguito dall'esterno del progetto tramite percorso assoluto | **No** |
| Agente che ignora i file di istruzioni | **No** |
| Offuscazione binaria / vera protezione | **Fuori portata** |

## Requisiti

- **Node.js** 18 o superiore
- **npm** 8 o superiore
- Gli strumenti di hardening (javascript-obfuscator, ProGuard, ConfuserEx ecc.) vengono installati separatamente per progetto

## Disclaimer

**Antirea è fornito così com'è, senza garanzie di alcun tipo.**

- Antirea non garantisce che il reverse engineering del tuo progetto sia impossibile. Aumenta significativamente il costo e la complessità dell'analisi assistita da AI, ma un analista esperto con accesso fisico al tuo binario e tempo illimitato può comunque effettuarlo.
- Gli autori di antirea non accettano alcuna responsabilità per danni, perdite o conseguenze legali derivanti dall'uso o dall'abuso di questo strumento.
- È tua responsabilità verificare che le protezioni di antirea siano correttamente applicate prima della distribuzione.
- Antirea non costituisce consulenza legale. Se hai bisogno di protezione legale per la tua proprietà intellettuale, consulta un avvocato qualificato.

**Usando antirea, accetti la piena responsabilità per il risultato.**

## Contributi

Hai trovato una lacuna nella protezione? Apri una issue o una pull request.

## Licenza

MIT