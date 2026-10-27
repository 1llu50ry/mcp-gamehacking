# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · **한국어** · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**REA와 같은 AI 기반 리버스 엔지니어링 도구로부터 프로젝트를 보호하는 스킬.**

`rea` 및 유사 도구는 MCP를 통해 AI 에이전트가 프로젝트의 바이너리, JS 번들, APK를 분석하도록 지시합니다. Antirea는 에이전트가 가장 먼저 읽는 위치에 "중단" 지시문을 배치합니다.

## 작동 방식

REA는 세 단계로 공격합니다:

```
1. 사용자 → REA 스킬을 에이전트에 로드
2. REA 스킬 → 에이전트에 MCP 도구 호출 지시 (open_binary, analyze_javascript_application 등)
3. 에이전트 → 프로젝트 파일/바이너리를 읽고 분석
```

Antirea는 2단계에서 개입합니다. 규정을 준수하는 에이전트는 어떤 작업을 수행하기 전에 프로젝트의 지시 파일을 읽습니다. Antirea는 해당 파일에 REA 차단 지시문을 작성합니다.

```
1. 사용자 → REA 스킬을 에이전트에 로드
2. REA 스킬 → 에이전트에 "open_binary 호출" 지시
3. 에이전트 → 먼저 AGENTS.md 읽음 → "REA 금지" 지시문 확인 → 중단
```

## 방어 레이어

| 레이어 | 도구 | 역할 |
|--------|------|------|
| **L1** 에이전트 지시 배리어 | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | 규정 준수 에이전트가 REA 도구 호출 거부 |
| **L1** 머신 가독 거부 | `.re-deny` | REA 인식 도구를 위한 머신 가독 신호 |
| **L2** 터미널 심 | `node_modules/.bin/rea` | `npx rea-agents` 및 `rea` CLI 가로채기, exit 1 |
| **L3** JS 난독화 | `javascript-obfuscator` | 모든 식별자가 `a`, `b`, `c`...로 변환 — REA 출력 무의미 |
| **L3** 소스 맵 제거 | `strip-sourcemaps.js` | `.map` 파일이 배포물에 포함되지 않음 |
| **L3** IPC 채널 해싱 | `antirea-ipc-hash.js` | Electron 채널 이름이 `ch_a3f9b2` 같은 해시로 변환 |
| **L3** ASAR 암호화 | electron-builder fuses | `analyze_javascript_application`이 ASAR 읽기 불가 |
| **L3** 디버그 심볼 제거 | strip / CMake flags | `binary_overview` / `analyze_function`이 `sub_XXXX`만 봄 |
| **L3** Rust .dep-v0 제거 | `antirea-strip-rust.sh` | `inspect_rust_binary`가 의존성 트리 확인 불가 |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary`가 모듈 정보 반환 불가 |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX가 `class a { void a(b c) }`만 봄 |
| **L3** .NET 난독화 | ConfuserEx | CIL 메타데이터 스크램블, 문자열 암호화 |

## 실행 순서

```
npm install   →  postinstall: 심이 node_modules/.bin에 설치됨
npm run build →  prebuild: embed-barrier.js 실행, 배리어가 아티팩트에 삽입됨
               →  build: 일반 빌드 계속
```

## 설치

### 1. AGENTS.md / CLAUDE.md

`templates/agents-inject.md` 내용을 기존 agent instruction 파일의 **맨 위**에 복사합니다. 파일이 없으면 `AGENTS.md`로 직접 복사합니다.

### 2. .re-deny

`templates/re-deny`를 프로젝트 루트에 `.re-deny`로 복사합니다.

### 3. package.json (JavaScript 프로젝트)

`package.json`에 추가:

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

### 4. 허니팟 (선택 사항)

**JavaScript:** `templates/honeypot-js.js`를 `package.json`의 `"main"` 필드와 일치하는 이름(예: `app.js`, `bundle.js`)으로 복사합니다.

**Native:** `templates/honeypot-native.c`를 컴파일하고 REA가 열 바이너리와 같은 이름으로 배치합니다:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## 중요한 제한 사항

| 시나리오 | Antirea가 차단 가능한가? |
|---------|------------------------|
| REA 스킬이 로드된 에이전트 (Claude Code, Cursor, Codex) | **가능** — AGENTS.md 배리어 |
| 프로젝트 디렉토리 내에서 `npx rea-agents` 실행 | **가능** — node_modules/.bin 심 |
| 배포된 bundle/binary 분석 | **부분** — 준수 에이전트는 embed-barrier.js로 중단 |
| 프로젝트 외부에서 절대 경로로 `rea` 실행 | **불가** |
| 지시 파일을 무시하는 에이전트 | **불가** |
| 바이너리 난독화 / 실제 보호 | **범위 외** |

## 요구 사항

- **Node.js** 18 이상
- **npm** 8 이상
- 하드닝 도구(javascript-obfuscator, ProGuard, ConfuserEx 등)는 프로젝트별로 별도 설치 필요

## 면책 조항

**Antirea는 어떠한 보증도 없이 있는 그대로 제공됩니다.**

- Antirea는 프로젝트의 리버스 엔지니어링이 불가능하다고 보장하지 않습니다. AI 지원 분석의 비용과 복잡성을 크게 높이지만, 바이너리에 물리적 접근이 가능하고 무한한 시간을 가진 숙련된 분석가는 여전히 리버스 엔지니어링할 수 있습니다.
- antirea 작성자는 이 도구의 사용 또는 오용으로 인한 손해, 손실 또는 법적 결과에 대해 어떠한 책임도 지지 않습니다.
- 배포 전에 antirea의 보호가 프로젝트에 올바르게 적용되었는지 확인하는 것은 귀하의 책임입니다.
- Antirea는 법적 조언을 구성하지 않습니다. 지적 재산에 대한 법적 보호가 필요한 경우 자격을 갖춘 변호사와 상담하십시오.

**antirea를 사용함으로써 결과에 대한 모든 책임을 수락하는 것입니다.**

## 기여

보호 공백을 발견했나요? 이슈 또는 풀 리퀘스트를 열어주세요.

## 라이선스

MIT