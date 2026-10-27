# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · **ไทย** · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**สกิลที่ปกป้องโปรเจกต์ของคุณจากเครื่องมือวิศวกรรมย้อนกลับที่ขับเคลื่อนด้วย AI เช่น REA**

`rea` และเครื่องมือที่คล้ายกันสั่งการ AI agent ผ่าน MCP เพื่อวิเคราะห์ไฟล์ไบนารี, JS bundle และ APK ของโปรเจกต์ Antirea วางคำสั่ง "หยุด" ในตำแหน่งที่ agent อ่านก่อน

## วิธีการทำงาน

REA โจมตีใน 3 ขั้นตอน:

```
1. ผู้ใช้ → โหลดสกิล REA เข้าสู่ agent
2. สกิล REA → สั่ง agent ให้เรียกใช้เครื่องมือ MCP (open_binary, analyze_javascript_application ฯลฯ)
3. Agent → อ่านและวิเคราะห์ไฟล์/ไบนารีของโปรเจกต์
```

Antirea แทรกแซงที่ขั้นตอนที่ 2 Agent ที่สอดคล้องจะอ่านไฟล์คำสั่งของโปรเจกต์ก่อนดำเนินการใดๆ Antirea เขียนคำสั่งบล็อก REA ลงในไฟล์เหล่านั้น

```
1. ผู้ใช้ → โหลดสกิล REA เข้าสู่ agent
2. สกิล REA → บอก agent ว่า "เรียก open_binary"
3. Agent → อ่าน AGENTS.md ก่อน → เห็นคำสั่ง "REA ห้าม" → หยุด
```

## ชั้นการป้องกัน

| ชั้น | เครื่องมือ | หน้าที่ |
|-----|-----------|---------|
| **L1** Agent instruction barrier | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | Agent ที่สอดคล้องปฏิเสธการเรียกเครื่องมือ REA |
| **L1** Machine-readable deny | `.re-deny` | สัญญาณที่เครื่องอ่านได้สำหรับเครื่องมือที่รู้จัก REA |
| **L2** Terminal shim | `node_modules/.bin/rea` | สกัดกั้น `npx rea-agents` และ `rea` CLI, exit 1 |
| **L3** JS obfuscation | `javascript-obfuscator` | ตัวระบุทั้งหมดกลายเป็น `a`, `b`, `c`... — ผลลัพธ์ REA ไม่มีความหมาย |
| **L3** ลบ source map | `strip-sourcemaps.js` | ไฟล์ `.map` ไม่รวมในการแจกจ่าย |
| **L3** แฮช IPC channel | `antirea-ipc-hash.js` | ชื่อ channel ของ Electron กลายเป็นแฮชเช่น `ch_a3f9b2` |
| **L3** เข้ารหัส ASAR | electron-builder fuses | `analyze_javascript_application` ไม่สามารถอ่าน ASAR |
| **L3** ลบสัญลักษณ์ debug | strip / CMake flags | `binary_overview` / `analyze_function` เห็นแค่ `sub_XXXX` |
| **L3** ลบ Rust .dep-v0 | `antirea-strip-rust.sh` | `inspect_rust_binary` ไม่เห็น dependency tree |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` ไม่คืนค่าข้อมูล module |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX เห็นแค่ `class a { void a(b c) }` |
| **L3** .NET obfuscation | ConfuserEx | CIL metadata ถูกสับเปลี่ยน, string ถูกเข้ารหัส |

## ลำดับการทำงาน

```
npm install   →  postinstall: ติดตั้ง shim ไปยัง node_modules/.bin
npm run build →  prebuild: embed-barrier.js ทำงาน, barrier ถูกฝังใน artifact
               →  build: build ปกติดำเนินต่อ
```

## การติดตั้ง

### 1. AGENTS.md / CLAUDE.md

คัดลอกเนื้อหาของ `templates/agents-inject.md` ไปยัง**ส่วนบนสุด**ของไฟล์ agent instruction ที่มีอยู่ หากไม่มีไฟล์ใด ให้คัดลอกเป็น `AGENTS.md` โดยตรง

### 2. .re-deny

คัดลอก `templates/re-deny` ไปยัง root ของโปรเจกต์เป็น `.re-deny`

### 3. package.json (โปรเจกต์ JavaScript)

เพิ่มใน `package.json`:

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

### 4. Honeypot (ไม่บังคับ)

**JavaScript:** คัดลอก `templates/honeypot-js.js` ไปยังโปรเจกต์ด้วยชื่อที่ตรงกับฟิลด์ `"main"` ใน `package.json` (เช่น `app.js`, `bundle.js`)

**Native:** คอมไพล์ `templates/honeypot-native.c` และวางด้วยชื่อเดียวกับไบนารีที่ REA จะเปิด:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## ข้อจำกัดสำคัญ

| สถานการณ์ | Antirea หยุดได้ไหม? |
|----------|---------------------|
| Agent ที่โหลดสกิล REA (Claude Code, Cursor, Codex) | **ได้** — barrier ของ AGENTS.md |
| `npx rea-agents` รันในไดเรกทอรีโปรเจกต์ | **ได้** — shim node_modules/.bin |
| Bundle/binary ที่แจกจ่ายถูกวิเคราะห์ | **บางส่วน** — agent ที่สอดคล้องหยุดผ่าน embed-barrier.js |
| `rea` รันจากนอกโปรเจกต์ด้วย absolute path | **ไม่ได้** |
| Agent ที่ไม่สนใจไฟล์คำสั่ง | **ไม่ได้** |
| Binary obfuscation / การป้องกันจริง | **นอกขอบเขต** |

## ข้อกำหนด

- **Node.js** 18 ขึ้นไป
- **npm** 8 ขึ้นไป
- เครื่องมือ hardening (javascript-obfuscator, ProGuard, ConfuserEx ฯลฯ) ต้องติดตั้งแยกต่างหากสำหรับแต่ละโปรเจกต์

## ข้อจำกัดความรับผิดชอบ

**Antirea ให้บริการตามสภาพ โดยไม่มีการรับประกันใดๆ**

- Antirea ไม่รับประกันว่าการทำวิศวกรรมย้อนกลับโปรเจกต์ของคุณเป็นไปไม่ได้ มันเพิ่มต้นทุนและความซับซ้อนของการวิเคราะห์ที่ใช้ AI อย่างมีนัยสำคัญ แต่นักวิเคราะห์ที่มีประสบการณ์ที่มีการเข้าถึงทางกายภาพและเวลาไม่จำกัดยังคงสามารถทำวิศวกรรมย้อนกลับได้
- ผู้เขียน antirea ไม่รับผิดชอบต่อความเสียหาย การสูญเสีย หรือผลทางกฎหมายที่เกิดจากการใช้หรือการใช้ในทางที่ผิดของเครื่องมือนี้
- เป็นความรับผิดชอบของคุณที่จะตรวจสอบว่าการป้องกันของ antirea ถูกนำไปใช้อย่างถูกต้องก่อนการแจกจ่าย
- Antirea ไม่ถือเป็นคำแนะนำทางกฎหมาย หากคุณต้องการการคุ้มครองทางกฎหมายสำหรับทรัพย์สินทางปัญญา ให้ปรึกษาทนายความที่มีคุณสมบัติ

**การใช้ antirea หมายความว่าคุณยอมรับความรับผิดชอบทั้งหมดสำหรับผลลัพธ์**

## การมีส่วนร่วม

พบช่องโหว่ในการป้องกัน? เปิด issue หรือ pull request

## ใบอนุญาต

MIT