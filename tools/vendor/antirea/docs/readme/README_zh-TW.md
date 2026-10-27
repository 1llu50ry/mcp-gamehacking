# antirea

[English](../../README.md) · [简体中文](README_zh.md) · **繁體中文** · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**一個保護您的專案免受 AI 驅動的逆向工程工具（如 REA）侵害的技能。**

`rea` 及類似工具透過 MCP 指揮 AI 代理分析專案的二進位檔案、JS 套件和 APK。Antirea 在代理首先讀取的位置放置「停止」指令。

## 運作原理

REA 分三步發起攻擊：

```
1. 使用者 → 將 REA 技能載入代理
2. REA 技能 → 指示代理呼叫 MCP 工具（open_binary、analyze_javascript_application 等）
3. 代理 → 讀取並分析專案檔案/二進位檔案
```

Antirea 在第 2 步介入。合規的代理在執行任何操作之前會讀取專案的指令檔案。Antirea 將 REA 攔截指令寫入這些檔案。

```
1. 使用者 → 將 REA 技能載入代理
2. REA 技能 → 告訴代理「呼叫 open_binary」
3. 代理 → 先讀取 AGENTS.md → 看到「REA 被禁止」指令 → 停止
```

## 防禦層

| 層級 | 工具 | 作用 |
|------|------|------|
| **L1** 代理指令屏障 | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | 合規代理拒絕呼叫 REA 工具 |
| **L1** 機器可讀拒絕 | `.re-deny` | 為支援 REA 的工具提供機器可讀訊號 |
| **L2** 終端攔截腳本 | `node_modules/.bin/rea` | 攔截 `npx rea-agents` 和 `rea` CLI，退出碼 1 |
| **L3** JS 混淆 | `javascript-obfuscator` | 所有識別碼變為 `a`、`b`、`c`……REA 輸出毫無意義 |
| **L3** 刪除 Source Map | `strip-sourcemaps.js` | `.map` 檔案不進入發佈包 |
| **L3** IPC 通道雜湊 | `antirea-ipc-hash.js` | Electron 通道名變為 `ch_a3f9b2` 等雜湊值 |
| **L3** ASAR 加密 | electron-builder fuses | `analyze_javascript_application` 無法讀取 ASAR |
| **L3** 除錯符號剝離 | strip / CMake flags | `binary_overview` / `analyze_function` 只能看到 `sub_XXXX` |
| **L3** Rust .dep-v0 刪除 | `antirea-strip-rust.sh` | `inspect_rust_binary` 無法查看依賴樹 |
| **L3** Go 剝離 + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` 不回傳模組資訊 |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX 只能看到 `class a { void a(b c) }` |
| **L3** .NET 混淆 | ConfuserEx | CIL 中繼資料被打亂，字串被加密 |

## 執行順序

```
npm install   →  postinstall：將攔截腳本安裝到 node_modules/.bin
npm run build →  prebuild：embed-barrier.js 執行，屏障嵌入建置產物
               →  build：正常建置繼續
```

## 安裝

### 1. AGENTS.md / CLAUDE.md

將 `templates/agents-inject.md` 的內容複製到現有 agent instruction 檔案的**最頂部**。如果沒有此類檔案，直接將其複製為 `AGENTS.md`。

### 2. .re-deny

將 `templates/re-deny` 複製到專案根目錄，命名為 `.re-deny`。

### 3. package.json（JavaScript 專案）

在 `package.json` 中新增：

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

### 4. 蜜罐（選用）

**JavaScript：** 將 `templates/honeypot-js.js` 複製到專案中，使用與 `package.json` 中 `"main"` 欄位匹配的名稱（如 `app.js`、`bundle.js`）。

**Native：** 編譯 `templates/honeypot-native.c` 並以 REA 會開啟的二進位檔案相同的名稱放置：

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## 重要限制

| 場景 | Antirea 能否阻止 |
|------|----------------|
| 載入了 REA 技能的代理（Claude Code、Cursor、Codex） | **能** — AGENTS.md 屏障 |
| 在專案目錄中執行 `npx rea-agents` | **能** — node_modules/.bin 攔截腳本 |
| 分發的 bundle/binary 被分析 | **部分** — embed-barrier.js 阻止合規代理 |
| 從專案外部透過絕對路徑執行 `rea` | **否** |
| 忽略指令檔案的代理 | **否** |
| Binary 混淆 / 真正保護 | **超出範圍** |

## 需求

- **Node.js** 18 或更高版本
- **npm** 8 或更高版本
- 加固工具（javascript-obfuscator、ProGuard、ConfuserEx 等）需按專案單獨安裝——antirea 不會為您安裝它們

## 免責聲明

**Antirea 按原樣提供，不提供任何形式的保證。**

- Antirea 不保證對您專案的逆向工程是不可能的。它顯著提高了 AI 輔助分析的成本和複雜性，但擁有對您的二進位檔案的實體存取權限和無限時間的專業分析師仍然可以對其進行逆向工程。
- antirea 的作者對因使用或濫用本工具而產生的任何損害、損失或法律後果不承擔任何責任。
- 在分發之前，您有責任驗證 antirea 的保護是否正確應用於您的專案。
- Antirea 不構成法律建議。如果您需要對智慧財產權進行法律保護，請諮詢合格的律師。

**使用 antirea，即表示您接受對結果承擔全部責任。**

## 貢獻

發現保護漏洞？開啟 issue 或 pull request。

## 授權條款

MIT