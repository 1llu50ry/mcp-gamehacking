# @vheins/local-memory-mcp

[![npm version](https://img.shields.io/npm/v/@vheins/local-memory-mcp.svg)](https://www.npmjs.com/package/@vheins/local-memory-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@vheins/local-memory-mcp.svg)](https://www.npmjs.com/package/@vheins/local-memory-mcp)
[![npm total downloads](https://img.shields.io/npm/dt/@vheins/local-memory-mcp.svg)](https://www.npmjs.com/package/@vheins/local-memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**MCP Local Memory Service** adalah server [Model Context Protocol (MCP)](https://modelcontextprotocol.io) berkinerja tinggi yang menyediakan memori jangka panjang dan bersinyal tinggi untuk AI Agent (seperti Claude Desktop, Cursor, atau Windsurf).

Dibangun dengan filosofi **Local-First**, layanan ini menyimpan keputusan arsitektur, pola kode, dan fakta kritis secara lokal di mesin Anda menggunakan SQLite dan Pencarian Semantik berbasis AI.

## 🚀 Fitur Utama

- 🧠 **Pencarian Semantik (V2):** Temukan memori berdasarkan makna, bukan hanya kata kunci, menggunakan model `all-MiniLM-L6-v2` secara lokal dengan peringkat hibrida TF-IDF + vektor.
- 🔄 **Tech-Stack Affinity:** Bagikan pengetahuan antar repositori secara cerdas berdasarkan tag teknologi.
- 🛡️ **Pengaman Anti-Hallusinasi:** Ambang batas kemiripan yang ketat dan deteksi konflik keputusan.
- 🧩 **Knowledge Graph:** Entitas, relasi, dan observasi terstruktur dengan ekstraksi otomatis via NLP offline.
- 🕰️ **Time Tunnel:** Kueri memori dengan tanggal berbahasa alami ("kemarin", "minggu lalu").
- 📉 **Soul Maintenance:** Decay memori bergaya biologis dengan imunitas tag — otomatis mengarsipkan memori usang.
- 🤖 **Alat Agentic:** Konteks sesi sekali-panggil (`agent-context`), pencatatan keputusan terstruktur via `memory-write` (`type: "decision"`), sintesis pengetahuan berbasis LLM (`synthesize`), dan ringkasan proyek per-repo (`repo-summarize`).
- 📊 **Dasbor Kaca (Glassy Dashboard):** Visualisasikan memori, tugas, handoff, knowledge graph, dan log interaksi melalui antarmuka Svelte 5 modern.
- 🔍 **Codebase Index:** Indeks dan kueri struktur kode sumber — cari fungsi, kelas, antarmuka, tipe, dan enum di seluruh proyek Anda. Menggunakan tree-sitter WASM untuk parsing cepat dengan pembaruan inkremental.
- 🧭 **Codebase Search & Trace:** Satu alat terpadu (`codebase-read`) dengan mode yang terdeteksi otomatis — cari simbol berperingkat (`query`), telusuri definisi dan situs pemanggilan simbol (`name`), daftar simbol yang dideklarasikan dalam berkas (`filePath`), atau jelajahi ikhtisar arsitektur (`depth`). `codebase-index` membangun dan memperbarui indeks tree-sitter.

## 🔌 Penggunaan & Konfigurasi MCP

Tambahkan layanan ini ke AI Agent Anda (Claude Desktop, Cursor, Windsurf, dll.) menggunakan salah satu metode di bawah.

> 💡 **Rekomendasi:** Jika MCP Anda sering berjalan (agen, CI, otomatisasi), hindari `npx` dan gunakan instalasi global atau lokal. Ini mengurangi unduhan NPM yang tidak perlu dan mempercepat startup Agent.

### 🚀 Quick Start (Tanpa Setup)

Cocok untuk **pengguna pertama** atau **pengujian cepat**. Ini menggunakan `npx` untuk menjalankan server tanpa setup permanen.

```json
"local-memory": {
  "command": "npx",
  "args": ["-y", "@vheins/local-memory-mcp"],
  "type": "stdio"
}
```

- **Menggunakan `npx`**: Otomatis menangani eksekusi.
- **Tradeoff**: Mungkin mengunduh ulang paket di beberapa lingkungan dan tidak optimal untuk eksekusi yang sering.

### ⚡ Direkomendasikan untuk Produksi / Penggunaan Sering

Metode ini memastikan waktu startup tercepat dan keandalan maksimal untuk penggunaan harian.

1. **Instal secara global:**

   ```bash
   npm install -g @vheins/local-memory-mcp
   ```

2. **Tambahkan ke konfigurasi Anda:**
   ```json
   "local-memory": {
     "command": "local-memory-mcp",
     "type": "stdio"
   }
   ```

- **Startup lebih cepat**: Tanpa pemeriksaan jaringan setiap kali dimulai.
- **Tanpa unduhan berulang**: Menghemat bandwidth dan menghindari ketergantungan pada registry NPM.
- **Lebih baik untuk otomatisasi**: Lebih stabil untuk alur kerja Agent yang berat.

### 🌐 Mode Daemon (Transport Bersama — Direkomendasikan)

Secara default, setiap jendela editor membuka proses `local-memory-mcp` tersendiri. Jika kamu membuka banyak jendela atau menjalankan beberapa agen sekaligus, akan ada N × M proses yang berebut akses ke database SQLite yang sama — menyebabkan CPU tinggi dan error `SQLITE_BUSY`.

**Mode daemon** menyelesaikan ini: jalankan **satu** proses latar belakang yang melayani endpoint MCP HTTP dan dashboard di satu port, lalu arahkan semua klien ke sana.

#### Quick start

```bash
# Install global dulu (direkomendasikan)
npm install -g @vheins/local-memory-mcp

# Jalankan daemon di background
local-memory-mcp daemon

# Cek status
local-memory-mcp daemon status
# → Daemon is running (pid 12345) on http://127.0.0.1:3456

# Hentikan
local-memory-mcp daemon stop
```

Atau tanpa install global:

```bash
npx -y @vheins/local-memory-mcp@latest daemon
```

#### Auto-start saat sistem restart

```bash
# Daftarkan sebagai service sistem (otomatis pilih mekanisme yang sesuai)
local-memory-mcp daemon install

# Hapus service
local-memory-mcp daemon uninstall
```

| Platform | Mekanisme                | Lokasi file service                                              |
| :------- | :----------------------- | :--------------------------------------------------------------- |
| Linux    | systemd user service     | `~/.config/systemd/user/local-memory-mcp.service`                |
| macOS    | launchd LaunchAgent      | `~/Library/LaunchAgents/io.github.vheins.local-memory-mcp.plist` |
| Windows  | Task Scheduler (ONLOGON) | Nama task: `local-memory-mcp-daemon`                             |

#### Arahkan klien MCP ke daemon

Ganti entri `stdio` di konfigurasi klienmu dengan entri HTTP (tidak perlu token — loopback only):

**OpenCode (`~/.config/opencode/opencode.json`)**

```json
"local-memory": {
  "url": "http://127.0.0.1:3456/mcp",
  "type": "http"
}
```

**Claude Desktop (`claude_desktop_config.json`)**

```json
{
	"mcpServers": {
		"local-memory": {
			"url": "http://127.0.0.1:3456/mcp"
		}
	}
}
```

Dashboard tersedia di `http://127.0.0.1:3456` — port yang sama, tidak perlu proses terpisah.

> Klien yang belum mendukung HTTP MCP (versi lama) bisa tetap menggunakan entri `stdio` bersamaan dengan daemon — keduanya berbagi database SQLite yang sama.

#### Subcommand daemon

| Perintah           | Keterangan                                                  |
| :----------------- | :---------------------------------------------------------- |
| `daemon`           | Jalankan daemon (fork ke background, tulis PID file)        |
| `daemon stop`      | Hentikan daemon yang sedang berjalan                        |
| `daemon status`    | Tampilkan apakah daemon berjalan dan di port berapa         |
| `daemon install`   | Daftarkan sebagai service sistem untuk auto-start saat boot |
| `daemon uninstall` | Hapus service sistem                                        |

#### Environment variables

| Variabel                    | Default | Keterangan                                   |
| :-------------------------- | :------ | :------------------------------------------- |
| `PORT`                      | `3456`  | Port untuk daemon gabungan (MCP + dashboard) |
| `MEMORY_DB_BUSY_TIMEOUT_MS` | `30000` | Timeout busy SQLite dalam ms                 |
| `LOCAL_MEMORY_DISPLAY_TZ`   | —       | Zona IANA (mis. `Asia/Jakarta`) untuk timestamp di output teks tool, ditampilkan sebagai `YYYY-MM-DD HH:mm:ss ±HH:MM`. Jika kosong/tidak valid, tetap ISO-8601 UTC mentah. Penyimpanan tetap UTC. |

#### Catatan

- Daemon terikat ke `127.0.0.1` (loopback) — tidak bisa diakses dari mesin lain.
- Semua sesi berbagi satu database SQLite; penulisan concurrent menggunakan retry jittered terbatas sehingga error `SQLITE_BUSY` tidak lagi muncul di bawah beban multi-klien.
- Log ditulis ke `~/.config/local-memory-mcp/daemon.log`.

### 🧠 Cara Kerjanya (Wawasan Penting)

- **Penggunaan npx**: Saat Anda menggunakan `npx`, ia sering melakukan permintaan jaringan untuk memeriksa versi terbaru atau mengunduh ulang paket jika tidak ada di cache. Karena klien MCP sering memulai dan menghentikan alat, ini dapat menyebabkan ratusan unduhan yang tidak perlu.
- **Biner terinstal**: Dengan menginstal paket, Anda menyimpan salinan permanen di disk. Agen menggunakan ulang versi lokal ini secara instan, memberikan pengalaman yang jauh lebih mulus.

### Database Maintenance: Reclaim Disk Space

After pruning or large data cleanups, SQLite can retain freed pages in its **freelist** for reuse instead of shrinking the database file. `VACUUM_ON_STARTUP` (default: `false`) opts into a one-time conversion to `auto_vacuum=INCREMENTAL`, followed by a full `VACUUM` that reclaims those pages before the MCP server accepts requests.

#### One-off CLI startup

Close other MCP clients and dashboard processes using the same database first: a full `VACUUM` needs a write lock and can delay startup. Use the same `MEMORY_DB_PATH` setting as your normal server if you have overridden the database location.

Run **one** of these commands in a POSIX shell (macOS/Linux):

```bash
# With the globally installed package
VACUUM_ON_STARTUP=true local-memory-mcp

# Alternatively, without a global install
VACUUM_ON_STARTUP=true npx @vheins/local-memory-mcp
```

The variable applies only to that invocation. This is **not a maintenance-and-exit command**: after the pass, the normal stdio MCP server continues running. Check the `[Server] VACUUM_ON_STARTUP ran` log and its `changed`, `skipped`, and `reason` fields; stop the standalone server with Ctrl+C after the pass finishes, then restart your normal client.

#### Claude Desktop / Cursor configuration

For Claude Desktop, open **Settings → Developer → Edit Config** (`claude_desktop_config.json`). Merge this entry into your existing `mcpServers` object; preserve other servers and any existing `env` values such as `MEMORY_DB_PATH`:

```json
{
	"mcpServers": {
		"local-memory": {
			"command": "npx",
			"args": ["-y", "@vheins/local-memory-mcp"],
			"env": {
				"VACUUM_ON_STARTUP": "true"
			}
		}
	}
}
```

For Cursor, use the same configuration in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global), adding `"type": "stdio"` inside the `local-memory` entry. For a global package install in either client, use `"command": "local-memory-mcp"` and remove `args`.

Restart the client to apply the setting. **Enable it for one planned reclamation startup, then remove/unset `VACUUM_ON_STARTUP` (or set it to `"false"`)** so ordinary startups stay fast and do not retry an expensive conversion or encounter unnecessary write-lock contention.

#### Safety and limitations

- **Disk headroom:** with the default guard, available space on the database filesystem must be at least **2 × database size + 16 MiB**. Database size is `page_count × page_size`; the temporary rewrite and WAL need extra room. Insufficient space produces `skipped: true`, `reason: "insufficient_disk"`. If the filesystem free-space probe is unavailable, the implementation proceeds rather than blocking, so verify headroom yourself.
- **Idempotent:** an already-INCREMENTAL database returns `changed: false`, `reason: "already_incremental"`; it does **not** run another full `VACUUM` or reclaim newly freed pages through this flag. Subsequent bounded incremental reclamation is part of the startup maintenance sweep in the `full` runtime profile.
- **Never-throw startup pass:** conversion errors are logged and returned as `skipped: true`, `reason: "error"`, rather than aborting startup. In-memory databases are skipped with `reason: "in_memory"`. This is not a guarantee that unrelated server startup operations cannot fail.
- **Scope:** the flag applies to normal MCP server startup in every runtime profile, not the standalone dashboard. It does not impose a maintenance timeout or remove the cost of a full database rewrite.

## 📊 Dasbor Kaca (Glassy Dashboard)

Visualisasikan dan kelola memori Agent Anda melalui antarmuka web modern.

|                                                 Ikhtisar Dasbor                                                 |                                                Manajemen Memori                                                 |
| :-------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------: |
| ![Dashboard Overview](https://raw.githubusercontent.com/wiki/vheins/local-memory-mcp/screenshots/dashboard.png) | ![Memories Management](https://raw.githubusercontent.com/wiki/vheins/local-memory-mcp/screenshots/memories.png) |

|                                            Pelacakan Tugas                                             |                                               Referensi Alat yang Tersedia                                               |
| :----------------------------------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------------------------------------: |
| ![Task Tracking](https://raw.githubusercontent.com/wiki/vheins/local-memory-mcp/screenshots/tasks.png) | ![Available Tools & Reference](https://raw.githubusercontent.com/wiki/vheins/local-memory-mcp/screenshots/reference.png) |

### Cara Menjalankan

```bash
local-memory-mcp dashboard
```

_Jika tidak terinstal global, gunakan:_ `npx @vheins/local-memory-mcp dashboard`

### Alur Kerja Pengembang (UI Dasbor)

UI dasbor dibangun dengan **Svelte 5 + Vite**. Berkas sumber berada di `src/dashboard/ui/`.

```bash
# Mulai server API (port 3456)
npm run dashboard

# Di terminal terpisah, mulai dev server Svelte (port 5173)
npm run dashboard:dev
# → Buka http://localhost:5173 (proxy /api ke :3456)

# Build UI Svelte untuk produksi (output → dist/dashboard/public/)
npm run dashboard:build

# Build produksi lengkap (Svelte + TypeScript)
npm run build
```

> Server menyajikan build Svelte terkompilasi dari `dist/dashboard/public/` di produksi.

### Auto-Start Dasbor di IDE

Dasbor bisa otomatis menyala saat Anda membuka project di VS Code, Cursor, Windsurf, Zed, atau IDE JetBrains.

📖 **[Lihat panduan auto-start →](https://github.com/vheins/local-memory-mcp/wiki/id/Auto-Start-Dashboard)**

## 📖 Dokumentasi

- [Memulai & Pengaturan](https://github.com/vheins/local-memory-mcp/wiki/id/Getting-Started) — Instalasi & konfigurasi klien
- [Referensi Alat & Panduan Penggunaan](https://github.com/vheins/local-memory-mcp/wiki/id/Tools-Reference) — Dokumentasi alat lengkap dengan contoh dan alur kerja
- [Panduan Pemecahan Masalah](https://github.com/vheins/local-memory-mcp/wiki/id/Troubleshooting) — Mengatasi masalah umum
- [Fitur & Cara Kerja](https://github.com/vheins/local-memory-mcp/wiki/id/Features) — Pencarian semantik, anti-halusinasi, decay memori
- [Logika Pencarian Hibrida](https://github.com/vheins/local-memory-mcp/wiki/id/Hybrid-Search) — Cara kerja skoring pencarian
- [Panduan Dasbor](https://github.com/vheins/local-memory-mcp/wiki/id/Dashboard-Guide) — UI web untuk manajemen memori & tugas
- [Codebase Index — Ikhtisar Fitur](https://github.com/vheins/local-memory-mcp/wiki/features/Codebase-Index) — Mengindeks, mencari, dan menelusuri simbol kode sumber
- [Codebase Index — Referensi API](.agents/documents/application/api/codebase-index/api-codebase.md) — Dokumentasi lengkap alat MCP untuk 2 alat Codebase Index terpadu (`codebase-index` + `codebase-read`)
- [Referensi Protokol MCP](https://github.com/vheins/local-memory-mcp/wiki/id/MCP-Concepts) — Detail teknis protokol
- [Integrasi dengan Claude Code](https://github.com/vheins/local-memory-mcp/wiki/id/Claude-Code-Integration) — Panduan setup untuk Claude Code CLI
- [Integrasi dengan Codex (OpenAI)](https://github.com/vheins/local-memory-mcp/wiki/id/Codex-Integration) — Panduan setup untuk Codex CLI
- [Integrasi dengan Kiro](https://github.com/vheins/local-memory-mcp/wiki/id/Kiro-Integration) — Panduan setup untuk Kiro IDE
- [Auto-Start Dasbor di IDE](https://github.com/vheins/local-memory-mcp/wiki/id/Auto-Start-Dashboard) — tasks.json untuk VS Code, Cursor, Windsurf, Zed, JetBrains
- [Changelog](CHANGELOG.md) — Riwayat rilis dan catatan versi

> Dokumentasi untuk pengguna (consumer) kini berada di **GitHub Wiki** (`https://github.com/vheins/local-memory-mcp/wiki/Home`). Dokumentasi kontributor & pengembang (standar pengujian, referensi API, runbook ops, desain/optimasi, audit) berada di `.agents/documents/`.

> 🇬🇧 **Versi bahasa Inggris tersedia:** [`README.md`](README.md) & dokumentasi di Wiki pada [`en/`](https://github.com/vheins/local-memory-mcp/wiki/en/Getting-Started)

### 🤝 Komunitas & Dukungan

- [Panduan Kontribusi](CONTRIBUTING.md) — Cara melaporkan masalah dan berkontribusi kode
- [Kode Etik](CODE_OF_CONDUCT.md) — Standar komunitas bagi semua kontributor
- [Kebijakan Keamanan](SECURITY.md) — Cara melaporkan kerentanan keamanan
- [Dukungan](SUPPORT.md) — Tempat mendapatkan bantuan (dokumentasi, isu, integrasi)

## 🌱 Proyek Terkait

- [opencode-9router](https://github.com/vheins/opencode-9router) — Plugin OpenCode yang mendaftarkan 9Router sebagai provider dengan penemuan model otomatis dan caching.
- [RustaSea framework](https://github.com/rustasea/framework) — Framework web Rust yang ekspresif dan terinspirasi Laravel, dengan keamanan, performa, dan konkurensi khas Rust.
- [RustaSea skeleton](https://github.com/rustasea/rustasea) — Kerangka aplikasi RustaSea (varian Blade), dibuat dengan `cargo rustasea new`.

## ⚠️ Penyangkalan

**PERANGKAT LUNAK INI DISEDIAKAN "SEBAGAIMANA ADANYA", TANPA JAMINAN DALAM BENTUK APAPUN**, baik tersurat maupun tersirat, termasuk namun tidak terbatas pada jaminan kepatutan, kesesuaian untuk tujuan tertentu, dan tidak melanggar hak pihak ketiga. Dalam hal apa pun penulis atau pemegang hak cipta tidak bertanggung jawab atas klaim, kerusakan, atau kewajiban lainnya, baik dalam tindakan kontrak, gugatan, atau lainnya, yang timbul dari, di luar, atau sehubungan dengan perangkat lunak ini.

## ⚖️ Lisensi

MIT © Muhammad Rheza Alfin — lihat teks lengkap di [LICENSE](LICENSE).

## 🙏 Ucapan Terima Kasih

- **Knowledge Graph** terinspirasi [Beledarian/mcp-local-memory](https://github.com/Beledarian/mcp-local-memory) — konsep grafik entitas/relasi terstruktur dibangun di atas proyek ini, diimplementasikan ulang dengan skema sendiri dan ekstraksi NLP offline.

- **Codebase Index** terinspirasi [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) — kemampuan pengindeksan, pencarian, dan penelusuran kode dibangun di atas konsep ini, diimplementasikan ulang dengan tree-sitter WASM dan alat yang terpadu.
