# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · **Français** · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**Un skill qui protège votre projet des outils de rétro-ingénierie pilotés par IA comme REA.**

`rea` et les outils similaires dirigent les agents IA via MCP pour analyser les binaires, les bundles JS et les APK de votre projet. Antirea place des directives « arrêt » exactement là où les agents lisent en premier.

## Fonctionnement

REA attaque en trois étapes :

```
1. Utilisateur → charge le skill REA dans l'agent
2. Skill REA → instruit l'agent d'appeler des outils MCP (open_binary, analyze_javascript_application, etc.)
3. Agent → lit et analyse les fichiers/binaires du projet
```

Antirea intervient à l'étape 2. Un agent conforme lit les fichiers d'instructions du projet avant toute action. Antirea écrit des directives de blocage REA dans ces fichiers.

```
1. Utilisateur → charge le skill REA dans l'agent
2. Skill REA → dit à l'agent « appelle open_binary »
3. Agent → lit AGENTS.md en premier → voit la directive « REA INTERDIT » → S'ARRÊTE
```

## Couches de défense

| Couche | Outil | Fonction |
|--------|-------|----------|
| **L1** Barrière d'instructions agent | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | L'agent conforme refuse d'appeler les outils REA |
| **L1** Refus lisible par machine | `.re-deny` | Signal lisible par machine pour les outils compatibles REA |
| **L2** Shim terminal | `node_modules/.bin/rea` | Intercepte `npx rea-agents` et `rea` CLI, exit 1 |
| **L3** Obfuscation JS | `javascript-obfuscator` | Tous les identifiants deviennent `a`, `b`, `c`... — sortie REA sans sens |
| **L3** Suppression source map | `strip-sourcemaps.js` | Les fichiers `.map` n'atteignent pas la distribution |
| **L3** Hachage des canaux IPC | `antirea-ipc-hash.js` | Les noms de canaux Electron deviennent des hachages comme `ch_a3f9b2` |
| **L3** Chiffrement ASAR | electron-builder fuses | `analyze_javascript_application` ne peut pas lire l'ASAR |
| **L3** Suppression des symboles de débogage | strip / CMake flags | `binary_overview` / `analyze_function` ne voit que `sub_XXXX` |
| **L3** Suppression Rust .dep-v0 | `antirea-strip-rust.sh` | `inspect_rust_binary` ne voit pas l'arbre de dépendances |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` ne renvoie pas d'informations sur les modules |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX ne voit que `class a { void a(b c) }` |
| **L3** Obfuscation .NET | ConfuserEx | Métadonnées CIL brouillées, chaînes chiffrées |

## Ordre d'exécution

```
npm install   →  postinstall : les shims sont installés dans node_modules/.bin
npm run build →  prebuild : embed-barrier.js s'exécute, la barrière est intégrée dans l'artefact
               →  build : le build normal continue
```

## Installation

### 1. AGENTS.md / CLAUDE.md

Copiez le contenu de `templates/agents-inject.md` au **tout début** de votre fichier d'instructions agent existant. S'il n'en existe pas, copiez-le directement en tant qu'`AGENTS.md`.

### 2. .re-deny

Copiez `templates/re-deny` à la racine du projet en tant que `.re-deny`.

### 3. package.json (projets JavaScript)

Ajoutez à `package.json` :

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

### 4. Honeypot (optionnel)

**JavaScript :** Copiez `templates/honeypot-js.js` dans votre projet avec le nom correspondant au champ `"main"` dans `package.json` (ex. `app.js`, `bundle.js`).

**Native :** Compilez `templates/honeypot-native.c` et placez-le avec le même nom que le binaire que REA ouvrirait :

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## Limites importantes

| Scénario | Antirea peut-il arrêter ? |
|---------|--------------------------|
| Agent avec skill REA chargé (Claude Code, Cursor, Codex) | **Oui** — barrière AGENTS.md |
| `npx rea-agents` exécuté dans le répertoire du projet | **Oui** — shim node_modules/.bin |
| Bundle/binary distribué analysé | **Partiellement** — agents conformes s'arrêtent via embed-barrier.js |
| `rea` exécuté hors du projet via chemin absolu | **Non** |
| Agent ignorant les fichiers d'instructions | **Non** |
| Obfuscation de binaires / vraie protection | **Hors portée** |

## Prérequis

- **Node.js** 18 ou supérieur
- **npm** 8 ou supérieur
- Les outils de durcissement (javascript-obfuscator, ProGuard, ConfuserEx, etc.) sont installés séparément par projet — antirea ne les installe pas pour vous

## Avertissement

**Antirea est fourni tel quel, sans garantie d'aucune sorte.**

- Antirea ne garantit pas que la rétro-ingénierie de votre projet est impossible. Il augmente considérablement le coût et la complexité de l'analyse assistée par IA, mais un analyste expérimenté avec un accès physique à votre binaire et un temps illimité peut toujours procéder à la rétro-ingénierie.
- Les auteurs d'antirea n'acceptent aucune responsabilité pour les dommages, pertes ou conséquences juridiques résultant de l'utilisation ou de l'abus de cet outil.
- Il est de votre responsabilité de vérifier que les protections d'antirea sont correctement appliquées avant la distribution.
- Antirea ne constitue pas un conseil juridique. Si vous avez besoin d'une protection juridique pour votre propriété intellectuelle, consultez un avocat qualifié.

**En utilisant antirea, vous acceptez l'entière responsabilité du résultat.**

## Contribuer

Vous avez trouvé une faille dans la protection ? Ouvrez une issue ou une pull request.

## Licence

MIT