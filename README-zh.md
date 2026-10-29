<div align="center">

# 🎮 mcp-reverse

### 让 Claude、Codex 和 Cursor 组队做逆向工程的 MCP 服务器。

**180+ 个 MCP 工具 · 73 个 RE/调试后端 · 9 个宿主插件 · 4,200+ 技能 · 多智能体网格 · x86-64 + ARM64 原生模拟器**

[![version](https://img.shields.io/badge/version-5.0.0-blue)](CHANGELOG.md) [![tests](https://img.shields.io/badge/tests-91%2F91-success)](tests/) [![tools](https://img.shields.io/badge/MCP%20tools-180%2B-blue)](src/) [![skills](https://img.shields.io/badge/skills-4%2C200%2B-orange)](db/) [![docker](https://img.shields.io/badge/docker-multi--arch-informational)](Dockerfile) [![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> **v5.0.0 已发布。** 仓库体积:19 GiB → 18 MiB(全部收进 SQLite + FTS5)。四波特性:宿主插件构建系统、Frida 桥接 + 动态分析、ARM64 模拟器 + 反编译缓存 + 分块、bindiff / ROP / 游戏引擎元数据 / MCP sampling / SVG 可视化。详见 [CHANGELOG](CHANGELOG.md)。

[快速开始](#快速开始) · [架构](docs/architecture.md) · [Agent Mesh](docs/agent-mesh.md) · [MCP Hub](docs/mcp-hub.md) · [伦理](#伦理)

</div>

---

## 适合谁

- **反作弊工程师** — 理解绕过手段,加固系统。
- **安全研究员** — 对自己拥有或有授权的二进制做分析。
- **逆向学习者** — 从 4,200+ 现成文档学习 (BattlEye、EAC、Vanguard、VAC、FACEIT、Byfron、Ricochet、UE4/UE5、Source 2、IL2CPP)。
- **游戏保存社区** — 记录游戏生态。

## 能做什么

- **111 个本地 MCP 工具** — 零依赖的 PE/ELF/Mach-O/DEX/WASM/Minidump/ZIP/APK/.NET/Unity AssetBundle/UE .pak/IL2CPP 解析器,AoB 扫描,Shannon 熵分析,加密常量识别,PDB70 → Microsoft 符号服务器 URL。
- **59 个 RE/调试后端** 统一在一个 Hub — `smart_decompile` 依次尝试 IDA → Ghidra → Binja → RetDec。
- **多智能体 mesh** — Claude、Codex、Cursor 注册为 agent,用 DM/channel 互通,交接任务,对彼此结果投票,共享 KV 知识库。

## 快速开始

```bash
git clone https://github.com/1llu50ry/mcp-reverse
cd mcp-reverse
npm install && npx tsc
npm test            # 20/20 全过

./bin/mcp-reverse.mjs stats
./bin/mcp-reverse.mjs search battleye
./bin/mcp-reverse.mjs tools
```

在 Claude Code / Codex / Cursor 的 MCP 配置里加:
```json
{ "mcp-reverse": { "command": "node", "args": ["/path/to/dist/index.js"] } }
```

或者用 Docker:
```bash
docker compose up
# → HTTP MCP 在 http://localhost:7777/mcp
# → /healthz + /metrics
```

## 伦理

本项目用于 **安全研究、作弊检测、防御工程和教育**。不包含作弊,不操控游戏流程。请只对自己拥有或经授权的二进制使用。详见 [SECURITY.md](SECURITY.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

英文完整文档: [README.md](README.md)。欢迎提交翻译 PR。
