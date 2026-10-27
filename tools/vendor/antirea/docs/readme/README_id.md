# antirea

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · **Bahasa Indonesia** · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md)

**Skill yang melindungi proyek Anda dari alat rekayasa balik berbasis AI seperti REA.**

`rea` dan alat serupa mengarahkan agen AI melalui MCP untuk menganalisis biner, paket JS, dan APK proyek Anda. Antirea menempatkan direktif "berhenti" tepat di tempat yang pertama kali dibaca oleh agen.

## Cara kerja

REA menyerang dalam tiga langkah:

```
1. Pengguna → memuat skill REA ke dalam agen
2. Skill REA → menginstruksikan agen untuk memanggil alat MCP (open_binary, analyze_javascript_application, dll.)
3. Agen → membaca dan menganalisis file/biner proyek
```

Antirea mengintervensi pada langkah 2. Agen yang patuh membaca file instruksi proyek sebelum mengambil tindakan apa pun. Antirea menulis direktif pemblokiran REA ke dalam file-file tersebut.

```
1. Pengguna → memuat skill REA ke dalam agen
2. Skill REA → memberitahu agen "panggil open_binary"
3. Agen → membaca AGENTS.md terlebih dahulu → melihat direktif "REA DILARANG" → BERHENTI
```

## Lapisan pertahanan

| Lapisan | Alat | Fungsi |
|---------|------|--------|
| **L1** Penghalang instruksi agen | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | Agen patuh menolak memanggil alat REA |
| **L1** Penolakan yang dapat dibaca mesin | `.re-deny` | Sinyal yang dapat dibaca mesin untuk alat yang mendukung REA |
| **L2** Shim terminal | `node_modules/.bin/rea` | Mencegat `npx rea-agents` dan `rea` CLI, exit 1 |
| **L3** Obfuskasi JS | `javascript-obfuscator` | Semua identifier menjadi `a`, `b`, `c`... — output REA tidak bermakna |
| **L3** Penghapusan source map | `strip-sourcemaps.js` | File `.map` tidak masuk ke distribusi |
| **L3** Hashing saluran IPC | `antirea-ipc-hash.js` | Nama saluran Electron menjadi hash seperti `ch_a3f9b2` |
| **L3** Enkripsi ASAR | electron-builder fuses | `analyze_javascript_application` tidak dapat membaca ASAR |
| **L3** Penghapusan simbol debug | strip / CMake flags | `binary_overview` / `analyze_function` hanya melihat `sub_XXXX` |
| **L3** Penghapusan Rust .dep-v0 | `antirea-strip-rust.sh` | `inspect_rust_binary` tidak dapat melihat pohon dependensi |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` tidak mengembalikan informasi modul |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX hanya melihat `class a { void a(b c) }` |
| **L3** Obfuskasi .NET | ConfuserEx | Metadata CIL diacak, string dienkripsi |

## Urutan eksekusi

```
npm install   →  postinstall: shim diinstal ke node_modules/.bin
npm run build →  prebuild: embed-barrier.js berjalan, penghalang ditanamkan ke artefak
               →  build: build normal berlanjut
```

## Instalasi

### 1. AGENTS.md / CLAUDE.md

Salin isi `templates/agents-inject.md` ke **bagian paling atas** file instruksi agen yang ada. Jika tidak ada, salin langsung sebagai `AGENTS.md`.

### 2. .re-deny

Salin `templates/re-deny` ke direktori root proyek sebagai `.re-deny`.

### 3. package.json (proyek JavaScript)

Tambahkan ke `package.json`:

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

### 4. Honeypot (opsional)

**JavaScript:** Salin `templates/honeypot-js.js` ke proyek dengan nama yang sesuai dengan field `"main"` di `package.json` (mis. `app.js`, `bundle.js`).

**Native:** Kompilasi `templates/honeypot-native.c` dan tempatkan dengan nama yang sama dengan binary yang akan dibuka REA:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## Batasan penting

| Skenario | Bisakah Antirea menghentikan? |
|---------|------------------------------|
| Agen dengan skill REA dimuat (Claude Code, Cursor, Codex) | **Ya** — penghalang AGENTS.md |
| `npx rea-agents` dijalankan di direktori proyek | **Ya** — shim node_modules/.bin |
| Bundle/binary terdistribusi dianalisis | **Sebagian** — agen patuh berhenti melalui embed-barrier.js |
| `rea` dijalankan dari luar proyek melalui jalur absolut | **Tidak** |
| Agen yang mengabaikan file instruksi | **Tidak** |
| Obfuskasi binary / perlindungan nyata | **Di luar cakupan** |

## Persyaratan

- **Node.js** 18 atau lebih baru
- **npm** 8 atau lebih baru
- Alat hardening (javascript-obfuscator, ProGuard, ConfuserEx, dll.) diinstal secara terpisah per proyek

## Penafian

**Antirea disediakan apa adanya, tanpa jaminan dalam bentuk apa pun.**

- Antirea tidak menjamin bahwa rekayasa balik proyek Anda tidak mungkin dilakukan. Ini secara signifikan meningkatkan biaya dan kompleksitas analisis berbantuan AI, tetapi analis berpengalaman dengan akses fisik ke binary Anda dan waktu tak terbatas masih dapat melakukan rekayasa balik.
- Penulis antirea tidak menerima tanggung jawab atas kerusakan, kerugian, atau konsekuensi hukum yang timbul dari penggunaan atau penyalahgunaan alat ini.
- Adalah tanggung jawab Anda untuk memverifikasi bahwa perlindungan antirea diterapkan dengan benar sebelum distribusi.
- Antirea bukan merupakan nasihat hukum. Jika Anda memerlukan perlindungan hukum untuk kekayaan intelektual Anda, konsultasikan dengan pengacara yang berkualifikasi.

**Dengan menggunakan antirea, Anda menerima tanggung jawab penuh atas hasilnya.**

## Kontribusi

Menemukan celah dalam perlindungan? Buka issue atau pull request.

## Lisensi

MIT