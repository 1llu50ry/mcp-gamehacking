# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · **Español** · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**Un skill que protege tu proyecto de herramientas de ingeniería inversa impulsadas por IA como REA.**

`rea` y herramientas similares dirigen a los agentes de IA a través de MCP para analizar los binarios, paquetes JS y APK de tu proyecto. Antirea coloca directivas de "alto" exactamente donde los agentes leen primero.

## Cómo funciona

REA ataca en tres pasos:

```
1. Usuario → carga el skill de REA en el agente
2. Skill de REA → instruye al agente a llamar herramientas MCP (open_binary, analyze_javascript_application, etc.)
3. Agente → lee y analiza los archivos/binarios del proyecto
```

Antirea interviene en el paso 2. Un agente conforme lee los archivos de instrucciones del proyecto antes de tomar cualquier acción. Antirea escribe directivas de bloqueo de REA en esos archivos.

```
1. Usuario → carga el skill de REA en el agente
2. Skill de REA → le dice al agente "llama a open_binary"
3. Agente → lee AGENTS.md primero → ve la directiva "REA PROHIBIDO" → SE DETIENE
```

## Capas de defensa

| Capa | Herramienta | Función |
|------|------------|---------|
| **L1** Barrera de instrucciones del agente | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | El agente conforme rechaza llamar herramientas REA |
| **L1** Denegación legible por máquina | `.re-deny` | Señal legible por máquina para herramientas compatibles con REA |
| **L2** Shim de terminal | `node_modules/.bin/rea` | Intercepta `npx rea-agents` y `rea` CLI, exit 1 |
| **L3** Ofuscación JS | `javascript-obfuscator` | Todos los identificadores se convierten en `a`, `b`, `c`... — salida de REA sin sentido |
| **L3** Eliminación de source map | `strip-sourcemaps.js` | Los archivos `.map` no llegan a la distribución |
| **L3** Hashing de canales IPC | `antirea-ipc-hash.js` | Los nombres de canales de Electron se convierten en hashes como `ch_a3f9b2` |
| **L3** Cifrado ASAR | electron-builder fuses | `analyze_javascript_application` no puede leer el ASAR |
| **L3** Eliminación de símbolos de depuración | strip / CMake flags | `binary_overview` / `analyze_function` solo ve `sub_XXXX` |
| **L3** Eliminación de Rust .dep-v0 | `antirea-strip-rust.sh` | `inspect_rust_binary` no puede ver el árbol de dependencias |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` no devuelve información de módulos |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX solo ve `class a { void a(b c) }` |
| **L3** Ofuscación .NET | ConfuserEx | Metadatos CIL mezclados, strings cifrados |

## Orden de ejecución

```
npm install   →  postinstall: los shims se instalan en node_modules/.bin
npm run build →  prebuild: embed-barrier.js se ejecuta, la barrera se incrusta en el artefacto
               →  build: el build normal continúa
```

## Instalación

### 1. AGENTS.md / CLAUDE.md

Copia el contenido de `templates/agents-inject.md` al **principio** de tu archivo de instrucciones de agente existente. Si no existe ninguno, cópialo directamente como `AGENTS.md`.

### 2. .re-deny

Copia `templates/re-deny` al directorio raíz del proyecto como `.re-deny`.

### 3. package.json (proyectos JavaScript)

Agrega a `package.json`:

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

### 4. Honeypot (opcional)

**JavaScript:** Copia `templates/honeypot-js.js` a tu proyecto con el nombre que coincida con el campo `"main"` en `package.json` (ej. `app.js`, `bundle.js`).

**Native:** Compila `templates/honeypot-native.c` y colócalo con el mismo nombre que el binario que REA abriría:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## Límites importantes

| Escenario | ¿Puede Antirea detenerlo? |
|----------|--------------------------|
| Agente con skill REA cargado (Claude Code, Cursor, Codex) | **Sí** — barrera AGENTS.md |
| `npx rea-agents` ejecutado en el directorio del proyecto | **Sí** — shim node_modules/.bin |
| Bundle/binary distribuido analizado | **Parcialmente** — agentes conformes se detienen por embed-barrier.js |
| `rea` ejecutado desde fuera del proyecto por ruta absoluta | **No** |
| Agente que ignora los archivos de instrucciones | **No** |
| Ofuscación de binarios / protección real | **Fuera del alcance** |

## Requisitos

- **Node.js** 18 o superior
- **npm** 8 o superior
- Las herramientas de hardening (javascript-obfuscator, ProGuard, ConfuserEx, etc.) se instalan por separado por proyecto — antirea no las instala por ti

## Aviso legal

**Antirea se proporciona tal cual, sin garantías de ningún tipo.**

- Antirea no garantiza que la ingeniería inversa de tu proyecto sea imposible. Aumenta significativamente el costo y la complejidad del análisis asistido por IA, pero un analista experto con acceso físico a tu binario y tiempo ilimitado aún puede realizarla.
- Los autores de antirea no aceptan responsabilidad por daños, pérdidas o consecuencias legales derivadas del uso o mal uso de esta herramienta.
- Es tu responsabilidad verificar que las protecciones de antirea se apliquen correctamente antes de distribuir.
- Antirea no constituye asesoramiento legal. Si necesitas protección legal para tu propiedad intelectual, consulta a un abogado calificado.

**Al usar antirea, aceptas toda la responsabilidad por el resultado.**

## Contribuciones

¿Encontraste una brecha en la protección? Abre un issue o pull request.

## Licencia

MIT