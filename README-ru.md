<div align="center">

# 🎮 mcp-gamehacking

### MCP-сервер, превращающий Claude, Codex и Cursor в команду reverse-engineering.

**180+ MCP-инструментов · 73 RE/debug бэкенда · 9 host-плагинов · 4,200+ скиллов · multi-agent mesh · x86-64 + ARM64 эмуляторы**

[![version](https://img.shields.io/badge/version-5.0.0-blue)](CHANGELOG.md) [![tests](https://img.shields.io/badge/tests-91%2F91-success)](tests/) [![tools](https://img.shields.io/badge/MCP%20tools-180%2B-blue)](src/) [![skills](https://img.shields.io/badge/skills-4%2C200%2B-orange)](db/) [![docker](https://img.shields.io/badge/docker-multi--arch-informational)](Dockerfile) [![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> **v5.0.0 выпущен.** Вес репо: 19 GiB → 18 MiB (всё в SQLite + FTS5). Четыре волны фич: build-системы для host-плагинов, Frida bridge + динамический анализ, ARM64 эмулятор + кеш декомпиляции + chunking, bindiff / ROP / метадата игровых движков / MCP sampling / SVG visualization. [CHANGELOG](CHANGELOG.md).

[Быстрый старт](#быстрый-старт) · [Архитектура](docs/architecture.md) · [Agent Mesh](docs/agent-mesh.md) · [MCP Hub](docs/mcp-hub.md) · [Этика](#этика)

</div>

---

## Для кого

- **Инженеры античитов** — понять как работают bypass, укрепить систему.
- **Security researchers** — разбирать бинарники, которыми вы владеете или на которые есть разрешение.
- **Студенты RE** — учиться на 4,200+ готовых разборах (BattlEye, EAC, Vanguard, VAC, FACEIT, Byfron, Ricochet, UE4/UE5, Source 2, IL2CPP).
- **Game preservation** — документировать игровые экосистемы.

## Что умеет

- **111 нативных MCP-инструментов** — zero-dep парсеры PE/ELF/Mach-O/DEX/WASM/Minidump/ZIP/APK/.NET/Unity AssetBundle/UE .pak/IL2CPP, AoB-сканер, Shannon entropy, идентификация крипто-констант, PDB70 → ссылка на symbol server Microsoft.
- **59 RE/debug бэкендов** в едином хабе — `smart_decompile` пробует IDA → Ghidra → Binja → RetDec.
- **Multi-agent mesh** — Claude, Codex, Cursor регистрируются как агенты, общаются DM/каналами, передают задачи, голосуют за результаты друг друга, делятся KV-базой знаний.

## Быстрый старт

```bash
git clone https://github.com/1llu50ry/mcp-gamehacking
cd mcp-gamehacking
npm install && npx tsc
npm test            # 20/20 должны пройти

./bin/mcp-gamehacking.mjs stats
./bin/mcp-gamehacking.mjs search battleye
./bin/mcp-gamehacking.mjs tools
```

Для Claude Code / Codex / Cursor добавь в MCP-конфиг:
```json
{ "mcp-gamehacking": { "command": "node", "args": ["/path/to/dist/index.js"] } }
```

Или через Docker:
```bash
docker compose up
# → HTTP MCP на http://localhost:7777/mcp
# → /healthz + /metrics
```

## Этика

Проект создан для **security-ресёрча, детекции читов, оборонительной инженерии и образования**. Не содержит читов и не управляет игровым процессом. Используй против бинарников, которыми ты владеешь или на которые есть явное разрешение. См. [SECURITY.md](SECURITY.md) и [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Полная документация по-английски: [README.md](README.md). Переводы приветствуются.
