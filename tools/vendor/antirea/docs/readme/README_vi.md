# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · **Tiếng Việt** · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**Một skill bảo vệ dự án của bạn khỏi các công cụ dịch ngược được hỗ trợ bởi AI như REA.**

`rea` và các công cụ tương tự chỉ đạo các tác nhân AI qua MCP để phân tích các tệp nhị phân, gói JS và APK của dự án. Antirea đặt các chỉ thị "dừng lại" ở đúng những nơi mà tác nhân đọc đầu tiên.

## Cách hoạt động

REA tấn công theo ba bước:

```
1. Người dùng → tải kỹ năng REA vào tác nhân
2. Kỹ năng REA → hướng dẫn tác nhân gọi các công cụ MCP (open_binary, analyze_javascript_application, ...)
3. Tác nhân → đọc và phân tích các tệp/nhị phân của dự án
```

Antirea can thiệp ở bước 2. Một tác nhân tuân thủ đọc các tệp hướng dẫn của dự án trước khi thực hiện bất kỳ hành động nào. Antirea ghi các chỉ thị chặn REA vào những tệp đó.

```
1. Người dùng → tải kỹ năng REA vào tác nhân
2. Kỹ năng REA → nói với tác nhân "gọi open_binary"
3. Tác nhân → đọc AGENTS.md trước → thấy chỉ thị "REA BỊ CẤM" → DỪNG LẠI
```

## Các lớp phòng thủ

| Lớp | Công cụ | Chức năng |
|-----|---------|-----------|
| **L1** Rào cản chỉ thị tác nhân | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | Tác nhân tuân thủ từ chối gọi công cụ REA |
| **L1** Từ chối đọc máy | `.re-deny` | Tín hiệu đọc máy cho các công cụ hỗ trợ REA |
| **L2** Shim terminal | `node_modules/.bin/rea` | Chặn `npx rea-agents` và `rea` CLI, exit 1 |
| **L3** Làm rối JS | `javascript-obfuscator` | Tất cả định danh trở thành `a`, `b`, `c`... — đầu ra REA vô nghĩa |
| **L3** Xóa source map | `strip-sourcemaps.js` | Tệp `.map` không vào bản phân phối |
| **L3** Băm tên kênh IPC | `antirea-ipc-hash.js` | Tên kênh Electron trở thành hash như `ch_a3f9b2` |
| **L3** Mã hóa ASAR | electron-builder fuses | `analyze_javascript_application` không đọc được ASAR |
| **L3** Xóa ký hiệu debug | strip / CMake flags | `binary_overview` / `analyze_function` chỉ thấy `sub_XXXX` |
| **L3** Xóa Rust .dep-v0 | `antirea-strip-rust.sh` | `inspect_rust_binary` không thấy cây phụ thuộc |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` không trả về thông tin module |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX chỉ thấy `class a { void a(b c) }` |
| **L3** Làm rối .NET | ConfuserEx | Metadata CIL bị xáo trộn, chuỗi được mã hóa |

## Thứ tự chạy

```
npm install   →  postinstall: shim được cài vào node_modules/.bin
npm run build →  prebuild: embed-barrier.js chạy, rào cản được nhúng vào artifact
               →  build: build bình thường tiếp tục
```

## Cài đặt

### 1. AGENTS.md / CLAUDE.md

Sao chép nội dung `templates/agents-inject.md` vào **đầu tiên** của tệp agent instruction hiện có. Nếu không có tệp nào, sao chép trực tiếp thành `AGENTS.md`.

### 2. .re-deny

Sao chép `templates/re-deny` vào thư mục gốc dự án với tên `.re-deny`.

### 3. package.json (dự án JavaScript)

Thêm vào `package.json`:

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

### 4. Honeypot (tùy chọn)

**JavaScript:** Sao chép `templates/honeypot-js.js` vào dự án với tên khớp với trường `"main"` trong `package.json` (ví dụ: `app.js`, `bundle.js`).

**Native:** Biên dịch `templates/honeypot-native.c` và đặt với tên giống binary mà REA sẽ mở:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## Giới hạn quan trọng

| Tình huống | Antirea có thể ngăn chặn? |
|-----------|--------------------------|
| Tác nhân có kỹ năng REA (Claude Code, Cursor, Codex) | **Có** — rào cản AGENTS.md |
| `npx rea-agents` chạy trong thư mục dự án | **Có** — shim node_modules/.bin |
| Bundle/binary phân phối bị phân tích | **Một phần** — tác nhân tuân thủ dừng qua embed-barrier.js |
| `rea` chạy từ ngoài dự án qua đường dẫn tuyệt đối | **Không** |
| Tác nhân bỏ qua tệp hướng dẫn | **Không** |
| Obfuscation binary / bảo vệ thực sự | **Ngoài phạm vi** |

## Yêu cầu

- **Node.js** 18 trở lên
- **npm** 8 trở lên
- Các công cụ hardening (javascript-obfuscator, ProGuard, ConfuserEx, v.v.) cần cài đặt riêng cho từng dự án

## Tuyên bố miễn trách nhiệm

**Antirea được cung cấp nguyên trạng, không có bảo đảm dưới bất kỳ hình thức nào.**

- Antirea không đảm bảo rằng việc dịch ngược dự án của bạn là không thể. Nó tăng đáng kể chi phí và độ phức tạp của phân tích hỗ trợ AI, nhưng một nhà phân tích có kinh nghiệm với quyền truy cập vật lý và thời gian không giới hạn vẫn có thể dịch ngược.
- Tác giả của antirea không chịu trách nhiệm về bất kỳ thiệt hại, tổn thất hoặc hậu quả pháp lý nào phát sinh từ việc sử dụng hoặc lạm dụng công cụ này.
- Bạn có trách nhiệm xác minh rằng các biện pháp bảo vệ của antirea được áp dụng đúng cách trước khi phân phối.
- Antirea không cấu thành tư vấn pháp lý. Nếu bạn cần bảo vệ pháp lý cho tài sản trí tuệ, hãy tham khảo luật sư có trình độ.

**Bằng cách sử dụng antirea, bạn chấp nhận hoàn toàn chịu trách nhiệm về kết quả.**

## Đóng góp

Tìm thấy lỗ hổng bảo vệ? Mở issue hoặc pull request.

## Giấy phép

MIT