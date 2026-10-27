# Optimization Roadmap

> **Status (terverifikasi 2026-08-04)**: SEMUA temuan `OPT-*` telah **SELESAI** dan terverifikasi di kode — DRY (01-07), Kualitas Kode (01-04), Performance (01-11), Struktur (01-05), Fitur/Flow (01-04, FLOW-01..03), Observability (01). Modul bersama: `utils/hybrid-search.ts`, `utils/purge-entity-cleanup.ts`, `utils/mcp-error.ts`, `utils/coordination.ts`, `utils/auto-infer.ts`, `utils/mcp-response.ts`, `utils/action-log.ts` (POLICY 2), `utils/scoring.ts`, `utils/chunk.ts`; migrasi dipecah ke file versi `vNN-*.ts`; layer `services/` dashboard lengkap (termasuk `statsCache.ts`); endpoint list KG dipaginasi + probe truncated; polling Arena digate visibility. Sisa keputusan: loop serial worker OPT-PERF-03 ditunda (bukan bottleneck — lihat memory), jalur delete tunggal dashboard masih melewati `purgeEntityAndCleanup` (terdokumentasi di kode).
>
> **Ruang lingkup**: `vheins/local-memory-mcp` — TypeScript MCP memory server (`src/mcp/`, 385 file TS) + Svelte dashboard (`src/dashboard/`, 88 file svelte). Total 559 file, 6064 symbol (codebase index).
> **Metode**: Analisis kode berbasis bukti (codebase index + pembacaan sumber). Semua temuan bersifat struktural — terlihat langsung di kode. Klaim runtime ditandai `[benchmark]` jika belum terverifikasi.
> **Dibuat**: 2026-08-02 · **Task**: 35 task implementasi terdaftar di MCP pada fase `optimize-*` (kode `OPT-*`).

---

## 1. Ringkasan Eksekutif

Arsitektur codebase ini sehat — ADR Simplification (44→15 tools saat digabung, kini **20 alat kanonik (19 + prompt-read)** — `codebase-index` dan `codebase-read` masuk ke set terpadu belakangan; lihat `buildExecutors` di `src/mcp/tools/index.ts` — SPEC-001 hybrid scoring, KG atomic writes) sudah terpasang rapi. Peluang optimisasi mengelompok dalam lima tema:

| Tema                | Jumlah    | Dampak Tertinggi                                                                                              |
| :------------------ | :-------- | :------------------------------------------------------------------------------------------------------------ |
| **Pelanggaran DRY** | 7 temuan  | Hybrid search ditriplikasi 3×, lifecycle claim diduplikasi, skeleton delete ditriplikasi                      |
| **Performance**     | 11 temuan | O(N²) transaksi KG per dokumen, polling dashboard tanpa syarat, full-scan enrichment KG pada jalur baca panas |
| **Struktur**        | 5 temuan  | Layer `services/` dashboard tidak ada, pemisahan entity tidak konsisten, file kebesaran                       |
| **Kualitas kode**   | 4 temuan  | Error envelope tidak konsisten, `handoff.manage.ts` mati (435 baris), celah type-safety                       |
| **Fitur / Flow**    | 7 temuan  | Shim koordinasi legacy di UI, list KG tanpa pagination, tanpa bulk action task/standard                       |

**Urutan eksekusi yang disarankan** (dependensi dihormati — lihat §6): ekstraksi DRY dulu (menghilangkan duplikasi yang nantinya direplikasi task lain), lalu pembersihan kualitas kode, lalu performance, lalu fitur — dengan observability (`OPT-OBS-01`) dipasang lebih awal agar setiap perbaikan perf terukur.

---

## 2. Temuan DRY

| Kode         | Severity | Effort | Masalah                                                                                                                      | Bukti                                                                                                                                                                                                                       |
| :----------- | :------- | :----- | :--------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPT-DRY-01` | tinggi   | M      | Orkestrasi hybrid search di-copy-paste 3 engine (magic fetchLimit, vector fallback, catch+rescore, sort, guarantee-1, slice) | `tools/memory.read.ts:88-358` · `tools/task-read/search.ts:52-281` · `tools/standard-read/search.ts:169-407`                                                                                                                |
| `OPT-DRY-02` | tinggi   | M      | Lifecycle claim/release/list diimplementasikan 2× (claim.manage vs handoff.manage legacy); salinan sudah divergen            | `tools/claim.manage.ts:44-83,109-125,194-214` · `tools/handoff.manage.ts:37-49,261-343,388-434` _(historis — file dihapus di OPT-CODE-02)_                                                                                  |
| `OPT-DRY-03` | tinggi   | S      | Skeleton delete identik byte-per-byte + purge queue + cleanup KG ditriplikasi                                                | `tools/memory.delete.ts:85-129` · `standard.delete.ts:81-124` · `task.delete.ts:84-125`                                                                                                                                     |
| `OPT-DRY-04` | sedang   | S      | Tiga implementasi domain-score, dua recency, dua confidence (denominator/ambang berbeda)                                     | `utils/scoring.ts:48,68` vs `task-read/search.ts:26-31` vs `standard-read/search.ts:118-159`                                                                                                                                |
| `OPT-DRY-05` | sedang   | S      | Ekstraksi action-log diduplikasi antar transport + membaca `structuredData` yang tidak ada (metadata hilang diam-diam)       | `tools/index.ts:84-100` · `router.ts:195-213` · `utils/mcp-response.ts:40,117-119`                                                                                                                                          |
| `OPT-DRY-06` | sedang   | M      | Dispatch mode auto-infer ditulis manual ~7× dengan semantik menyimpang                                                       | `memory.read.ts:71-82` · `task-read/index.ts:55-90` · `standard-read/index.ts` · `handoff.read.ts:244-278` · `codebase.read.ts`                                                                                             |
| `OPT-DRY-07` | rendah   | S      | Envelope tabel `{schema, columns, rows, count, total, offset, limit}` dibangun 7+ kali                                       | `memory.read.ts:333-340` · `task-read/search.ts:220-231` · `task-read/list.ts:47-60` · `standard-read/search.ts:377-389` · `handoff.read.ts:177-212` · `handoff.manage.ts:146-181` _(historis)_ · `claim.manage.ts:194-214` |

---

## 3. Temuan Kualitas Kode

| Kode          | Severity | Effort | Masalah                                                                                                                                  | Bukti                                                                                                                                                                           |
| :------------ | :------- | :----- | :--------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPT-CODE-01` | tinggi   | M      | Kegagalan yang sama menghasilkan 3 bentuk error (hasil isError vs exception dilempar vs isError buatan tangan) tergantung transport/tool | `tools/index.ts:260-266` · `router.ts:78-81` · `task-read/index.ts:25-36` · `handoff.manage.ts:120-132` _(historis)_ · `memory.read.ts:72`                                      |
| `OPT-CODE-02` | tinggi   | S      | `handoff.manage.ts` (435 baris) tidak direferensikan sama sekali — bobot mati yang membuat logika duplikat tampak hidup                  | `tools/handoff.manage.ts:51-434` _(historis — file dihapus oleh perbaikan ini)_                                                                                                 |
| `OPT-CODE-03` | sedang   | S      | Sentinel id `""`, asersi `!`, cast `as` pasca-parse yang membuang narrowing Zod                                                          | `memory.delete.ts:22-24` · `standard.delete.ts:21-23` · `task.delete.ts:16-26` · `handoff.manage.ts:296,417` _(historis)_ · `memory.read.ts:72` · `memory-write/helpers.ts:157` |
| `OPT-CODE-04` | sedang   | S      | Semantik delete not-found berbeda antar 3 tool delete                                                                                    | `memory.delete.ts:69-75` · `standard.delete.ts:67-71` · `task.delete.ts:16-26`                                                                                                  |

---

## 4. Temuan Performance

| Kode          | Severity | Effort | Masalah                                                                                                             | Bukti                                                                                                           |
| :------------ | :------- | :----- | :------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------- |
| `OPT-PERF-01` | tinggi   | M      | O(N²) transaksi `BEGIN IMMEDIATE` terpisah per dokumen KG (N obs + N(N−1)/2 relations)                              | `kg-archivist/extract.ts:412-436` · `entities/knowledge-graph/entity.ts:119-157,171-200`                        |
| `OPT-PERF-02` | tinggi   | M      | Agent Arena mengirim 5 req/repo setiap 2,5 dtk tanpa syarat; tanpa SSE; berjalan saat tab tersembunyi               | `dashboard/ui/src/lib/composables/useAgentArena.ts:82-92,169`                                                   |
| `OPT-PERF-03` | sedang   | M      | Worker melakukan 1 baca DB per job yang diklaim (32/batch) + tulis KG serial                                        | `embedding-queue/worker.ts:240-252,255-273`                                                                     |
| `OPT-PERF-04` | sedang   | M      | Enrichment KG-context menjalankan full-scan `INSTR` tak terbatas pada setiap task-read/baca memory                  | `kg-archivist/query.ts:34-51` · `entities/knowledge-graph/queries.ts:150-178` · `memory.read.ts:343-351`        |
| `OPT-PERF-05` | sedang   | S      | Baris `action_log` ditulis pada setiap pemanggilan tool termasuk baca; pertumbuhan tak terbatas                     | `tools/index.ts:273` · `utils/action-log.ts:42-54`                                                              |
| `OPT-PERF-06` | sedang   | M      | Statistik dashboard global dihitung ulang (16+ query agregat) pada setiap pilih repo/refresh, invarian antar mutasi | `entities/system/entity.ts:218-326` · `dashboard/ui/src/lib/composables/useApp.ts:148`                          |
| `OPT-PERF-07` | sedang   | M      | Filter tag/stack memakai `LIKE '%…%'` (full scan tak berindeks); FTS tidak mencakup tags                            | `entities/memory.vector.ts:70-72` · `entities/memory/entity.ts:402,459` · `entities/standard/entity.ts:133-140` |
| `OPT-PERF-08` | sedang   | M      | Mode ARCHITECTURE codebase mematerialkan semua file+symbol per permintaan (O(symbols))                              | `tools/codebase.read.ts:228-231` · `entities/codebase-symbol.ts:98-121`                                         |
| `OPT-PERF-09` | rendah   | S      | Eksklusi tulis dua lapis redundan per panggilan tulis `[benchmark]`                                                 | `storage/write-lock.ts:38-62,83-107` · `storage/base.ts:27`                                                     |
| `OPT-PERF-10` | rendah   | S      | Query fallback kedua ketika kandidat < 5 (menggandakan biaya pencarian korpus kecil)                                | `entities/memory.vector.ts:130-151`                                                                             |
| `OPT-PERF-11` | rendah   | S      | `db.prepare()` per panggilan + IN-list dinamis meleset dari cache prepare pada loop panas                           | `storage/base.ts:30-48` · `entities/memory/entity.ts:170-186`                                                   |

---

## 5. Temuan Struktur, Fitur & Flow

### Struktur

| Kode         | Severity | Effort | Masalah                                                                                                  | Bukti                                                                                                                                                     |
| :----------- | :------- | :----- | :------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPT-STR-01` | sedang   | M      | Dashboard mendeklarasikan `services/` tapi tidak ada; controller gemuk + menyentuh db langsung           | `dashboard/controllers/*.ts` (→ `lib/context.ts:7`) · `CodebaseController.ts` (387 baris)                                                                 |
| `OPT-STR-02` | rendah   | S      | `unifiedGraph.routes.ts` melanggar konvensi kebab-case                                                   | `dashboard/routes/unifiedGraph.routes.ts`                                                                                                                 |
| `OPT-STR-03` | sedang   | M      | Pemisahan entity dir hanya 3 entity; standard/KG/system monolitik (KG = 637 baris)                       | `entities/memory/entity.ts:4` + `entities/memory/entity.ts:758` · `entities/standard/entity.ts:436` · `entities/knowledge-graph/entity.ts:637`            |
| `OPT-STR-04` | sedang   | L      | 10 file >400 baris; `migrations.ts` = 1274 mencampur domain                                              | `storage/migrations/` (terpecah menjadi `index.ts` + `vNN-*.ts` ber-versi) · `entities/memory/entity.ts` · `tools/memory.read.ts` (561 → kini 435) · dst. |
| `OPT-STR-05` | rendah   | S      | Entri skema tiga lapis (`schemas.ts` → `schemas/` → `schemas/index.ts`); handler bertitik tetap terbesar | `tools/schemas.ts:2` · `tools/memory.read.ts` (561 → kini 435 setelah split OPT-DRY-06) · `tools/codebase.read.ts:451`                                    |

### Fitur / Flow / Observability

| Kode          | Severity | Effort | Masalah                                                                                                             | Bukti                                                                                                                                                               |
| :------------ | :------- | :----- | :------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OPT-FEAT-01` | tinggi   | M      | Dashboard mempertahankan 6 handler koordinasi legacy untuk nama tool yang tak lagi terdaftar; UI bergantung padanya | `dashboard/controllers/SystemController.ts:209-231` · `useAgentArena.ts:89` · `HandoffsPanel.svelte:51`                                                             |
| `OPT-FEAT-02` | sedang   | S      | Endpoint list KG tanpa pagination + tak terbatas                                                                    | `dashboard/controllers/KGController.ts:15,39` · `entities/knowledge-graph/entity.ts:368-388`                                                                        |
| `OPT-FEAT-03` | rendah   | S      | Flag `truncated` selalu false (dihitung setelah clip LIMIT)                                                         | `KGController.ts:58` vs `entities/knowledge-graph/entity.ts:436`                                                                                                    |
| `OPT-FEAT-04` | sedang   | M      | Tanpa bulk action untuk Tasks/Standards (hanya memories) — celah UX multi-round-trip                                | `dashboard/ui/src/lib/api.ts:170-175` · `MemoriesController.ts:147-174`                                                                                             |
| `OPT-FLOW-01` | sedang   | S      | Detail baca ber-alamat-kode membakar 2 query DB (ambiguitas id-or-code)                                             | `tools/memory.read.ts:433`                                                                                                                                          |
| `OPT-FLOW-02` | sedang   | M      | `memory-synthesize` melewati plumbing tool terpadu (nama tool legacy, data di-fetch ulang)                          | `tools/memory.synthesize.ts:84-88,202-248,250-304` _(historis: dirilis sebagai alat kanonik `synthesize` di `tools/index.ts` dengan opsi `sampleMessage`/`elicit`)_ |
| `OPT-FLOW-03` | rendah   | S      | Setiap update di-embed ulang + di-extract KG penuh, tanpa dedup content-diff                                        | `embedding-queue/types.ts` · `tools/memory-write/create.ts` · `kg-archivist/relations.ts`                                                                           |
| `OPT-OBS-01`  | sedang   | S      | Core dispatch tidak mencatat durasi; statistik worker tanpa latensi; tanpa endpoint metrics                         | `tools/index.ts:219-270` · `embedding-queue/worker.ts:82-88,401-413`                                                                                                |

---

## 6. Grafik Dependensi & Urutan Eksekusi

```
OPT-DRY-02 ──► OPT-CODE-02 ──► OPT-FEAT-01   (lifecycle claim: ekstrak → hapus → port UI)
OPT-DRY-03 ──► OPT-CODE-04                  (skeleton delete → semantik terpadu)
OPT-PERF-01 ──► OPT-PERF-03                 (batching KG → koalesensi worker)
OPT-FEAT-02 ──► OPT-FEAT-03                 (pagination → flag truncated)
OPT-OBS-01  (pasang lebih awal: membuat OPT-PERF-* terukur)
```

**Gelombang yang disarankan** (menghormati dependensi; aman paralel dalam satu gelombang):

1. **Gelombang 1 — Fondasi**: `OPT-DRY-01..03`, `OPT-CODE-01..02`, `OPT-OBS-01` (tanpa deps; menghapus duplikasi + kode mati + menambah pengukuran)
2. **Gelombang 2 — Konsolidasi**: `OPT-DRY-04..07`, `OPT-CODE-03`, `OPT-CODE-04` (setelah `OPT-DRY-03`), `OPT-STR-01..05`, `OPT-FLOW-01`
3. **Gelombang 3 — Performance**: `OPT-PERF-01`, `OPT-PERF-02`, `OPT-PERF-04`, `OPT-PERF-05`, `OPT-PERF-06`, `OPT-PERF-08`; lalu `OPT-PERF-03` (setelah 01), `OPT-PERF-07`, `OPT-PERF-09..11`
4. **Gelombang 4 — Fitur/Flow**: `OPT-FEAT-01` (setelah `OPT-CODE-02`), `OPT-FEAT-02`, `OPT-FEAT-04`, `OPT-FLOW-02`; lalu `OPT-FEAT-03` (setelah 02), `OPT-FLOW-03`

---

## 7. Quick Wins (effort rendah, sinyal tinggi)

| Task                                         | Effort | Kenapa duluan                                     |
| :------------------------------------------- | :----- | :------------------------------------------------ |
| `OPT-CODE-02` hapus `handoff.manage.ts` mati | S      | −435 baris, menghilangkan jangkar logika duplikat |
| `OPT-DRY-03` helper purge                    | S      | −3 skeleton delete hampir identik                 |
| `OPT-PERF-05` lewati action_log pada baca    | S      | menghapus tulis dari setiap jalur baca panas      |
| `OPT-FLOW-01` lookup detail tunggal          | S      | membagi dua biaya detail ber-alamat-kode          |
| `OPT-FEAT-03` perbaiki flag truncated        | S      | perbaikan sinyal mati satu baris                  |
| `OPT-STR-02` rename route                    | S      | pemulihan konvensi                                |

---

## 8. Kriteria Penerimaan Per-Task

Setiap task `OPT-*` di MCP membawa: masalah → bukti → usulan perbaikan → kriteria penerimaan. Verifikasi setiap task dengan pipeline: **impl → code-review → test → commit** (scope `tester` = modul terdampak; jangan pernah full suite). Task performance harus diukur sebelum/sesudah setelah `OPT-OBS-01` rilis (`/api/system/metrics`); `OPT-PERF-09` secara eksplisit menunggu benchmark sebelum implementasi.
