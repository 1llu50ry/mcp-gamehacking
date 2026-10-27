# Agent Arena Dashboard — UI/UX & Developer-Friendliness Audit

> **Follow-up (2026-09-06, v0.44.1):** Queue view bundle fix shipped (PRs #104–106, 9 primitives, lazy split). Focus-restore & a11y re-verify pending. Original findings below are historical.

**Tanggal:** 2026-08-11
**Repo:** vheins/local-memory-mcp
**Baseline:** STD-002 (Dashboard UI baseline: a11y, focus, contrast, sim-freeze, polling)
**Metodologi:** Chrome 150 headless via CDP (screenshots, console/network capture, AX tree, computed-style probes, real mouse/key events) + codebase index map (TASK-393) + source verification
**Screenshots:** `~/.local/share/opencode/tool-output/arena-audit/` (17 file)

---

## 1. Ringkasan Eksekutif

Dashboard **sehat secara teknis** — 0 error JS, 0 request 4xx/5xx di seluruh 11 view, tidak ada horizontal scroll di viewport 390px, dan 9/11 view memenuhi aturan "satu h1 per tab". Namun ada **3 masalah P1** yang menghalangi kualitas: bundle produksi **stale** (Queue view unreachable), dan 2 view (Reference, Codebase empty state) melanggar hierarki heading.

| View            | User (1-5) | Dev (1-5) | Status STD-002            |
| :-------------- | :--------- | :-------- | :------------------------ |
| Arena           | 4          | 4         | Sim-freeze FAIL           |
| Dashboard       | 4          | 4         | aria-live gap             |
| Activity        | 4          | 3.5       | aria-live gap             |
| Memories        | 4          | 3.5       | Label FAIL x2             |
| Tasks           | 4          | 4         | aria-live gap             |
| Standards       | 3.5        | 3.5       | First-load 2.3s           |
| Codebase        | 3          | 3         | **h1 FAIL** (empty state) |
| Handoffs        | 4          | 4         | OK                        |
| Queue           | **1**      | **1**     | **BROKEN** (stale bundle) |
| Knowledge Graph | 4          | 4         | OK (source freeze)        |
| Reference       | 3          | 3         | **h1 FAIL**               |

---

## 2. Temuan Per-View

### 2.1 ARENA — 4/4

- ✅ Satu h1 "Agent Arena"; aria-live sr-only scoped; tablist 6 tab; konsol/network bersih; no h-scroll di 390px.
- ❌ **Sim-freeze FAIL (STD-002):** probe rAF = 37 ticks/1.5s ≈ **25-26fps terus-menerus saat idle**. Renderer arena tidak punya settle-detection/freeze (hanya KG renderer yang punya, TASK-277).
- ❌ Nav model inkonsisten: arena/dashboard/standards/reference tersembunyi di hamburger sidebar (`display:none`), 6 tab lain di top nav.

### 2.2 DASHBOARD — 4/4

- ✅ Satu h1 "Global Command Center" + hierarki h2 bagus; kontras semua teks inti PASS (body 18.13:1, label 6.08:1, stat 5.02-7.90:1).
- ❌ 0 aria-live region (stats async tidak diumumkan).
- ❌ P3: repo count sidebar collapsed `#0EA5E9` @9.92px = **2.77:1** (gagal WCAG AA).
- ⚠️ Attention Board menampilkan baris "unknown-repo" sebelum repo dipilih.

### 2.3 ACTIVITY — 4/3.5

- ✅ Satu h1 "Recent Activity"; no h-scroll.
- ❌ 0 aria-live; icon button tanpa nama.

### 2.4 MEMORIES — 4/3.5

- ✅ Satu h1 "Memory Explorer"; tab selected ✓; kontras PASS.
- ❌ **Label FAIL (STD-002 x2):** input search "Search memories..." nama aksesibelnya hanya dari placeholder (tanpa aria-label/label); `<select>` filter tipe **tanpa nama**.
- ❌ 390px: 22 tombol < 32px (ikon 28x28).

### 2.5 TASKS — 4/4

- ✅ Satu h1 "Task Overview"; kanban render; konsol bersih; 390px ok.

### 2.6 STANDARDS — 3.5/3.5

- ✅ Satu h1 "CODING STANDARDS".
- ❌ **First-load lambat:** GET /api/standards = **2288ms** (satu-satunya request >2s di sesi).

### 2.7 CODEBASE — 3/3

- ✅ Empty state ("No codebase index found" + CTA "Index Now") = copy jelas + aksi.
- ❌ **h1 FAIL (STD-002):** saat repo belum di-index, h1 "Codebase Overview" **hilang** — pesan empty state berupa `DIV` tebal tanpa role heading. Screen reader tidak dapat heading halaman.

### 2.8 HANDOFFS — 4/4

- ✅ Satu h1 "HANDOFFS & CLAIMS"; konsol bersih.

### 2.9 QUEUE — 1/1 BROKEN

- ❌ **tab-queue tidak muncul di DOM** (6 tab render, source punya 7). `activeTab=queue` + reload → **konten blank total** (tanpa h1/guard/error).
- 🎯 **Root cause: bundle stale** — `dist/dashboard/public/assets/index-dqloGaES.js` dibangun 2026-08-08, lebih tua dari source (QueuePage + tab-queue ada di `App.svelte:189-196, 347-348` tapi tidak ter-compile).

### 2.10 KNOWLEDGE GRAPH — 4/4

- ✅ Satu h1 "Knowledge Graph"; canvas render; KGModal focus trap PASS; no h-scroll.
- ✅ Sim freeze [source]: `kg-neural-renderer` punya settle-detect + freeze + O(1) wake (camera.ts:89-99, index.ts:103-120) — tidak bisa diverifikasi di bundle lama.
- ❌ 390px: 3 tap target kecil (zoom "−" dll).

### 2.11 REFERENCE — 3/3

- ❌ **h1 FAIL (STD-002):** "MCP Reference" adalah **SPAN tebal**, bukan heading → 0 h1 di view ini.
- ❌ Placeholder-as-label pada search; item kategori sidebar berupa SPAN (cek role).
- ⚠️ ReferenceDrawer: focus restore gagal (ke BODY).

---

## 3. Focus Trap (STD-002)

| Drawer              | Focus-into | Tab-wrap            | Escape | Restore         |
| :------------------ | :--------- | :------------------ | :----- | :-------------- |
| KGModal             | ✅         | ✅                  | ✅     | ✅ (ke trigger) |
| DetailDrawer (task) | ✅         | ✅ (4 Tab di dalam) | ✅     | ❌ → BODY       |
| MemoryDrawer        | ✅         | —                   | ✅     | ❌ → BODY       |
| ReferenceDrawer     | ✅         | —                   | ✅     | ❌ → BODY       |

- **Edge case P2:** setelah drawer ditutup via Escape (focus → BODY), navigasi Tab **macet pada satu tombol** sampai reload — dugaan: overlay selalu-mounted (FloatingChat?) menyimpan listener trap aktif di container tersembunyi.
- Catatan: restore row `tabindex=-1` ada di source (TASK-278) tapi **tidak ada di bundle lama** — perlu verifikasi pasca-rebuild.

---

## 4. Cross-Cutting

- **Console:** 0 error/warning app JS di seluruh 11 view + reload. **Network:** 0 4xx/5xx; 1 request lambat (standards 2288ms). Baseline dev-friendly sangat baik.
- **aria-live:** hanya ARENA yang punya live region; semua view async lain (dashboard, memories, tasks, codebase, queue, kg) **tidak punya** — aturan "aria-live scoped" kurang diterapkan.
- **Label:** pola placeholder-as-label berulang (memories, reference); select tanpa nama (memories); icon button tanpa nama.
- **Responsiveness:** no h-scroll di 390px di mana pun ✓; tapi kepadatan tombol ikon <32px (memories 22, KG 3) — di bawah kenyamanan 44px.
- **Hierarki heading:** 9/11 satu h1; FAIL di codebase (0 saat empty) & reference (0).
- **Legacy/unused [source]:** `QuickCreateFAB` tidak dipakai (digantikan FloatingChat); `useApp.TABS` (8-entry) tidak di-render; endpoint `GET /unified-graph` tanpa consumer UI.
- **Design system:** light theme konsisten (card/btn token); heading uppercase; dua permukaan nav inkonsisten; tablist tanpa accessible name.

---

## 5. Status STD-002 Per-Rule

| #   | Rule                                            | Status                                                                                     |
| :-- | :---------------------------------------------- | :----------------------------------------------------------------------------------------- |
| 1   | Satu h1 per tab                                 | **FAIL** (codebase 0 / reference 0; 9 lain PASS)                                           |
| 2   | aria-live scoped                                | **PARTIAL** (arena ✓; tidak ada live region lain)                                          |
| 3   | Focus trap (into/wrap/Escape/restore)           | **PARTIAL** (into/wrap/Escape PASS; restore FAIL x3 drawer)                                |
| 4   | WCAG AA contrast                                | **PASS** teks inti; P3 sidebar count 2.77:1                                                |
| 5   | Sim freeze                                      | **FAIL/UNVERIFIED** (arena kontinu ~26fps; KG ada [source])                                |
| 6   | Polling (skip-on-inflight/backoff/pause-hidden) | **[SOURCE] PASS** (createVisibilityPoller; TopBar backoff; arena single-flight; KG manual) |
| 7   | Real labels (placeholder ≠ label)               | **FAIL** (placeholder-as-label + select unnamed)                                           |

---

## 6. Prioritas Perbaikan

### P1 (rusak/blocking)

1. **Rebuild bundle UI** (`npm run dashboard:build`) → Queue view unreachable, focus-restore fix & mem-row tabindex hilang dari bundle.
2. **Reference view:** tambah h1 (ubah SPAN → `h1`) di `ReferenceTab.svelte`.
3. **Codebase empty state:** pertahankan h1 "Codebase Overview" saat index kosong (heading role pada pesan empty state) di `CodebasePage.svelte`.

### P2 (kualitas UX)

4. **Focus restore** ke trigger row pada DetailDrawer/ReferenceDrawer (+ verifikasi TASK-278 pasca-rebuild).
5. **Post-drawer Tab-freeze:** investigasi listener trap tersembunyi (FloatingChat?).
6. **aria-live regions** untuk view async (dashboard stats, memories table, tasks, codebase, queue).
7. **Real labels:** aria-label pada search (memories, reference) + label/nama pada select filter tipe.

### P3 (polish)

8. **Arena sim settle-freeze** saat idle (26fps burn) — ikuti pola KG renderer (TASK-277).
9. **Tap targets ≥32px** di 390px (memories 22, KG 3).
10. **Kontras sidebar repo-count** (#0EA5E9 2.77:1 → minimal 4.5:1).
11. **Standards first-load 2.3s** — audit query/halaman.
12. **Nav model unification** (sidebar vs top tabs) + accessible name pada tablist.

---

## 7. Tindak Lanjut yang Disarankan

1. **Rebuild + re-verify** (P1-1): jalankan `npm run dashboard:build`, lalu re-audit Queue view, focus-restore, dan mem-row tabindex.
2. Fix P1-2 & P1-3 (heading) → cepat, berisiko rendah.
3. Fix P2 batch (focus restore, labels, aria-live) → dampak aksesibilitas besar.
4. Re-audit STD-002 setelah fix.

_Laporan disusun oleh orchestrator dari temuan TASK-393 (structural map), TASK-394 (browser audit), TASK-395 (RCA queue global) — detail per-view di komentar task MCP._
