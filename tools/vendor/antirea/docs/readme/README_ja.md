# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · **日本語** · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**REA のような AI 駆動のリバースエンジニアリングツールからプロジェクトを保護するスキル。**

`rea` などのツールは MCP を通じて AI エージェントにバイナリ・JS バンドル・APK を解析させます。Antirea はエージェントが最初に読み込む場所に「停止」ディレクティブを配置します。

## 仕組み

REA は 3 つのステップで攻撃します：

```
1. ユーザー → REA スキルをエージェントに読み込む
2. REA スキル → エージェントに MCP ツール呼び出しを指示する（open_binary、analyze_javascript_application など）
3. エージェント → プロジェクトのファイル/バイナリを読み取り解析する
```

Antirea はステップ 2 に介入します。準拠エージェントは何か行動する前にプロジェクトの指示ファイルを読み込みます。Antirea はそれらのファイルに REA をブロックするディレクティブを書き込みます。

```
1. ユーザー → REA スキルをエージェントに読み込む
2. REA スキル → エージェントに「open_binary を呼び出せ」と指示
3. エージェント → まず AGENTS.md を読む → 「REA 禁止」ディレクティブを確認 → 停止
```

## 防御レイヤー

| レイヤー | ツール | 役割 |
|---------|-------|------|
| **L1** エージェント指示バリア | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | 準拠エージェントが REA ツールの呼び出しを拒否 |
| **L1** 機械可読拒否 | `.re-deny` | REA 対応ツール向けの機械可読シグナル |
| **L2** ターミナルシム | `node_modules/.bin/rea` | `npx rea-agents` と `rea` CLI を捕捉、exit 1 |
| **L3** JS 難読化 | `javascript-obfuscator` | すべての識別子が `a`、`b`、`c`…に — REA 出力は無意味に |
| **L3** ソースマップ削除 | `strip-sourcemaps.js` | `.map` ファイルは配布物に含まれない |
| **L3** IPC チャンネルハッシュ | `antirea-ipc-hash.js` | Electron チャンネル名が `ch_a3f9b2` などのハッシュになる |
| **L3** ASAR 暗号化 | electron-builder fuses | `analyze_javascript_application` が ASAR を読めない |
| **L3** デバッグシンボル除去 | strip / CMake flags | `binary_overview` / `analyze_function` は `sub_XXXX` しか見えない |
| **L3** Rust .dep-v0 削除 | `antirea-strip-rust.sh` | `inspect_rust_binary` が依存ツリーを確認できない |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` がモジュール情報を返せない |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX は `class a { void a(b c) }` しか見えない |
| **L3** .NET 難読化 | ConfuserEx | CIL メタデータが難読化され、文字列が暗号化される |

## 実行順序

```
npm install   →  postinstall：シムを node_modules/.bin にインストール
npm run build →  prebuild：embed-barrier.js が実行され、バリアがアーティファクトに埋め込まれる
               →  build：通常のビルドが続行
```

## インストール

### 1. AGENTS.md / CLAUDE.md

`templates/agents-inject.md` の内容を既存の agent instruction ファイルの**先頭**にコピーします。ファイルがない場合は、そのまま `AGENTS.md` としてコピーします。

### 2. .re-deny

`templates/re-deny` をプロジェクトルートに `.re-deny` としてコピーします。

### 3. package.json（JavaScript プロジェクト）

`package.json` に追加：

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

### 4. ハニーポット（任意）

**JavaScript：** `templates/honeypot-js.js` を `package.json` の `"main"` フィールドと一致する名前（例：`app.js`、`bundle.js`）でプロジェクトにコピーします。

**Native：** `templates/honeypot-native.c` をコンパイルし、REA が開くバイナリと同じ名前で配置します：

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## 重要な制限

| シナリオ | Antirea が止められるか |
|---------|----------------------|
| REA スキルを読み込んだエージェント（Claude Code、Cursor、Codex） | **Yes** — AGENTS.md バリア |
| プロジェクトディレクトリ内で `npx rea-agents` を実行 | **Yes** — node_modules/.bin シム |
| 配布された bundle/binary を解析 | **部分的** — 準拠エージェントは embed-barrier.js で停止 |
| プロジェクト外から絶対パスで `rea` を実行 | **No** |
| 指示ファイルを無視するエージェント | **No** |
| バイナリ難読化 / 真の保護 | **対象外** |

## 要件

- **Node.js** 18 以上
- **npm** 8 以上
- ハードニングツール（javascript-obfuscator、ProGuard、ConfuserEx など）はプロジェクトごとに別途インストールが必要です

## 免責事項

**Antirea は現状のまま提供され、いかなる保証もありません。**

- Antirea はプロジェクトのリバースエンジニアリングが不可能であることを保証しません。AI 支援分析のコストと複雑さを大幅に高めますが、バイナリへの物理アクセスと無限の時間を持つ熟練したアナリストは依然としてリバースエンジニアリングできます。
- antirea の作者は、このツールの使用または悪用から生じるいかなる損害、損失、法的結果についても責任を負いません。
- 配布前に antirea の保護が正しく適用されていることを確認する責任はあなたにあります。
- Antirea は法的アドバイスを構成しません。知的財産の法的保護が必要な場合は、資格のある弁護士に相談してください。

**antirea を使用することで、結果に対する全責任を受け入れることになります。**

## コントリビューション

保護のギャップを見つけましたか？Issue または Pull Request を開いてください。

## ライセンス

MIT