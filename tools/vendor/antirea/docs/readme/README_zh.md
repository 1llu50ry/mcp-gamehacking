# antirea

[English](../../README.md) · **简体中文** · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**一个保护您的项目免受 AI 驱动的逆向工程工具（如 REA）侵害的技能。**

`rea` 及类似工具通过 MCP 指挥 AI 代理分析项目的二进制文件、JS 包和 APK。Antirea 在代理首先读取的位置放置"停止"指令。

## 工作原理

REA 分三步发起攻击：

```
1. 用户 → 将 REA 技能加载到代理中
2. REA 技能 → 指示代理调用 MCP 工具（open_binary、analyze_javascript_application 等）
3. 代理 → 读取并分析项目文件/二进制文件
```

Antirea 在第 2 步介入。合规的代理在执行任何操作之前会读取项目的指令文件。Antirea 将 REA 拦截指令写入这些文件。

```
1. 用户 → 将 REA 技能加载到代理中
2. REA 技能 → 告诉代理"调用 open_binary"
3. 代理 → 先读取 AGENTS.md → 看到"REA 被禁止"指令 → 停止
```

## 防御层

| 层级 | 工具 | 作用 |
|------|------|------|
| **L1** 代理指令屏障 | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | 合规代理拒绝调用 REA 工具 |
| **L1** 机器可读拒绝 | `.re-deny` | 为支持 REA 的工具提供机器可读信号 |
| **L2** 终端拦截脚本 | `node_modules/.bin/rea` | 拦截 `npx rea-agents` 和 `rea` CLI，退出码 1 |
| **L3** JS 混淆 | `javascript-obfuscator` | 所有标识符变为 `a`、`b`、`c`……REA 输出毫无意义 |
| **L3** 删除 Source Map | `strip-sourcemaps.js` | `.map` 文件不进入发布包 |
| **L3** IPC 通道哈希 | `antirea-ipc-hash.js` | Electron 通道名变为 `ch_a3f9b2` 等哈希值 |
| **L3** ASAR 加密 | electron-builder fuses | `analyze_javascript_application` 无法读取 ASAR |
| **L3** 调试符号剥离 | strip / CMake flags | `binary_overview` / `analyze_function` 只能看到 `sub_XXXX` |
| **L3** Rust .dep-v0 删除 | `antirea-strip-rust.sh` | `inspect_rust_binary` 无法查看依赖树 |
| **L3** Go 剥离 + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` 不返回模块信息 |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX 只能看到 `class a { void a(b c) }` |
| **L3** .NET 混淆 | ConfuserEx | CIL 元数据被打乱，字符串被加密 |

## 运行顺序

```
npm install   →  postinstall：将拦截脚本安装到 node_modules/.bin
npm run build →  prebuild：embed-barrier.js 运行，屏障嵌入构件
               →  build：正常构建继续
```

Agent instruction 文件（AGENTS.md）保护源目录。`embed-barrier.js` 保护分发的 bundle/binary。两者协同工作。

## 安装

### 1. AGENTS.md / CLAUDE.md

将 `templates/agents-inject.md` 的内容复制到现有 agent instruction 文件的**最顶部**。如果没有此类文件，直接将其复制为 `AGENTS.md`。

### 2. .re-deny

将 `templates/re-deny` 复制到项目根目录，命名为 `.re-deny`。

### 3. package.json（JavaScript 项目）

在 `package.json` 中添加：

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

### 4. 蜜罐（可选）

**JavaScript：** 将 `templates/honeypot-js.js` 复制到项目中，使用与 `package.json` 中 `"main"` 字段匹配的名称（如 `app.js`、`bundle.js`）。

**Native：** 编译 `templates/honeypot-native.c` 并以 REA 会打开的二进制文件相同的名称放置：

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## 重要限制

| 场景 | Antirea 能否阻止 |
|------|----------------|
| 加载了 REA 技能的代理（Claude Code、Cursor、Codex） | **能** — AGENTS.md 屏障 |
| 在项目目录中运行 `npx rea-agents` | **能** — node_modules/.bin 拦截脚本 |
| 分发的 bundle/binary 被分析 | **部分** — embed-barrier.js 阻止合规代理 |
| 从项目外部通过绝对路径运行 `rea` | **否** |
| 忽略指令文件的代理 | **否** |
| Binary 混淆 / 真正保护 | **超出范围** |

## 需求

- **Node.js** 18 或更高版本
- **npm** 8 或更高版本
- 加固工具（javascript-obfuscator、ProGuard、ConfuserEx 等）需按项目单独安装——antirea 不会为您安装它们

## 免责声明

**Antirea 按原样提供，不提供任何形式的保证。**

- Antirea 不保证对您项目的逆向工程是不可能的。它显著提高了 AI 辅助分析的成本和复杂性，但拥有对您的二进制文件的物理访问权限和无限时间的专业分析师仍然可以对其进行逆向工程。
- antirea 的作者对因使用或滥用本工具而产生的任何损害、损失或法律后果不承担任何责任。
- 在分发之前，您有责任验证 antirea 的保护是否正确应用于您的项目。
- Antirea 不构成法律建议。如果您需要对知识产权进行法律保护，请咨询合格的律师。

**使用 antirea，即表示您接受对结果承担全部责任。**

## 贡献

发现保护漏洞？开启 issue 或 pull request。

## 许可证

MIT