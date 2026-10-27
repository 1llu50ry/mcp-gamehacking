# Desain: Memindahkan Embedding ONNX + Ekstraksi KG dari Jalur Kritis Tulis

> **Status: ✅ DIIMPLEMENTASIKAN (terverifikasi 2026-08-08).** Antrean outbox dirilis sebagai migrasi **`v09-embedding-queue-jobs`** (desain mengusulkan v8) dengan modul `embedding-queue` (`outbox.ts` / `enqueue.ts` / `worker.ts`) dan worker di **kedua** proses — server MCP (`src/mcp/server.ts`) dan dashboard (`src/dashboard/server.ts`). Idempotensi observasi (P2: indeks unik `(entity_name, observation)`) dirilis di dalam v9. Endpoint admin status antrean ada di `/api/queue/status` (`src/dashboard/routes/queue.routes.ts:7`); permukaan admin job gagal (daftar/jalankan-ulang/hapus) dirilis kemudian di TASK-296 (lihat §7 P3). Header "belum diimplementasikan" asli dipertahankan sebagai catatan historis; catatan inline menandai penyimpangan.

> **Terverifikasi (2026-08-10).** Admin antrean sepenuhnya dirilis (TASK-296 backend + TASK-297 UI): `GET /api/queue/jobs` (berpaginasi, filter `?status=` literal opsional dengan default `pending,poison`, terbaru-dahulu), `POST /api/queue/jobs/:id/retry`, `POST /api/queue/jobs/:id/clear` (juga `DELETE /api/queue/jobs/:id`), dan `POST /api/queue/retry-all` — semuanya dipasang di bawah `/api/queue` (`src/dashboard/routes/queue.routes.ts:11-15`) dengan cakupan `?repo=` opsional (TASK-360) dan setiap mutasi di dalam `db.withWrite`. Dashboard memperoleh tab **Queue** (App.svelte — setelah Handoffs, sebelum Knowledge Graph; total 11 tab) dengan kartu status (pending/claimed/done/failed dari `GET /api/queue/status`) dan tabel "Failed jobs" yang terhubung ke Re-run/Clear per baris plus Re-run all. Kekhawatiran metrik terkait `/health` terjawab: `GET /api/health` (`system.routes.ts:7` — connected/uptime/version/memoryCount/repoCount/pendingRequests/dbPath) dan `GET /api/metrics` (`system.routes.ts:10` — kolom `worker` = snapshot worker embedding termasuk kedalaman antrean + penghitung processed/failed/poisoned) keduanya ada dan teruji-integrasi.

- **Task**: TASK-002 (optimization) · **Memori keputusan**: MEM-368 · **Implementasi**: TASK-013
- **Repo**: local-memory-mcp · **Scope**: desain + catatan implementasi yang dirilis

## 1. Ikhtisar

**Masalah (terverifikasi terhadap sumber):**

| Situs                                                          | Pekerjaan inline di bawah `store.withWrite` (proper-lockfile)                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tools/index.ts:291`                                           | Setiap alat dalam `WRITE_TOOLS` menjalankan executor-nya di dalam `store.withWrite` → kunci file lintas-proses dipegang untuk _seluruh_ eksekusi alat, termasuk titik `await`. |
| `memory-write/create.ts:69,76`                                 | `vectors.upsert` (inferensi ONNX, 150–500ms) + `saveExtractions` (NLP compromise + tulis KG)                                                                                   |
| `memory-write/update.ts:93`                                    | `vectors.upsert` saat konten berubah                                                                                                                                           |
| `memory-write/bulk.ts:132,231,237`                             | N `vectors.upsert` serial + N `saveExtractions`                                                                                                                                |
| `standard-write/create.ts:104,111,120`                         | `vectors.upsert` + `saveExtractions` + `saveStandardRelations`                                                                                                                 |
| `standard-write/update.ts:122`, `bulk.ts:95`                   | `vectors.upsert`                                                                                                                                                               |
| `task-write/effects.ts:33`                                     | `tryVectorEmbedding`                                                                                                                                                           |
| `dashboard/controllers/StandardsController.ts:216,226,293,334` | Pola yang sama di **proses dashboard** (proses terpisah, `memory.db` yang sama)                                                                                                |

**Tujuan**: memindahkan inferensi ONNX dan ekstraksi KG NLP keluar dari jalur permintaan dan keluar dari kunci file, menjaga semantik tulis tetap atomik dan pemeriksaan konflik tetap benar. Embedding/KG sudah non-kritis (try/catch di sekelilingnya, hanya warn) — ini memformalkan itu.

**Dua fakta terverifikasi yang membentuk desain:**

1. **`checkConflicts` tidak bergantung pada ONNX.** `memory-write/helpers.ts:197 → entities/memory.vector.ts:93-106` memanggil `searchBySimilarity` yang menggunakan `computeVector` — vektor frekuensi-token JS murni di atas tabel `memories`. Parameter `_vectors`/`_type` tidak digunakan. Ia **tetap sinkron** (lihat §4).
2. **Pembacaan sudah mentoleransi vektor yang hilang.** `memory.read.ts:115` membangun kandidat melalui `searchBySimilarity` (JS murni di atas `memories`), dan `vectors.search` ONNX (baris 169) hanya memasok komponen `keywordScore` dari peringkat hibrida. **Catatan (digantikan):** saat desain, memori **tidak memiliki fallback FTS** — `memories_fts` dihapus di migrasi sebelumnya (`migrations.ts:760-776`). Sejak itu **migrasi v10 menambahkan kembali `memories_fts`** dan bobot kata kunci 0.30 kini diberi makan `bm25()` ternormalisasi min-max (`src/mcp/entities/memory/search.ts`, `src/mcp/tools/memory.read.ts`), sehingga jendela ketercarian lebih kecil dari asumsi desain. Standar masih memiliki FTS5 (`coding_standards_fts`).

## 2. Keputusan Arsitektur

**Rekomendasi: tabel job outbox berbasis SQLite (`queue_jobs`, migrasi v9 — dirilis) + worker berbasis lease dalam-proses yang dihosting oleh kedua proses.**

| Opsi                                            | Putusan | Mengapa                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Antrean async dalam-proses                      | ❌      | Job hilang saat proses crash; hanya-server-MCP — tulis dashboard (StandardsController) masih memblokir; tanpa status bersama antar proses.                                                                                                                                 |
| Tabel job berbasis SQLite + worker dalam-proses | ✅      | Tahan-crash (job bertahan; kedaluwarsa lease + rekonsiliasi memulihkan); menangkap enqueue dari **kedua** server MCP dan dashboard; enqueue adalah `INSERT` ~µs di dalam transaksi tulis yang ada; worker menggunakan ulang model ONNX yang sudah dimuat di setiap proses. |
| Proses worker khusus                            | ❌      | Permukaan deployment ekstra dan jejak model kedua untuk alat pengguna-tunggal lokal; proses dashboard/MCP sudah merupakan host berumur panjang.                                                                                                                            |

**Model konkurensi**: _kedua_ proses dapat menghosting worker (ketahanan: jika klien MCP terputus, dashboard terus menguras). Saling eksklusi melalui **klaim lease** (`UPDATE … WHERE status='pending'` atomik), bukan kunci file — inferensi tidak pernah terjadi di bawah `withWrite`. Pemrosesan duplikat tambahan dibuat tidak berbahaya oleh tulis idempoten (upsert vektor; `entities`/`relations` `INSERT OR IGNORE`; `observations` dibuat idempoten di Fase 2).

**Yang tetap persis seperti sekarang:**

- `checkConflicts` (memori & standar) — sinkron, pra-insert, di dalam kunci (fitur kebenaran, tidak bergantung ONNX).
- `vectors.search` jalur-baca (embedding kueri) — sinkron (`memory.read.ts:169`, `standard-read/search.ts:224`, `task-read/search.ts:100`, `agent-context.ts:26`, `codebase vector-ranking.ts:33`, `synthesize`).
- **Ambang dan semantik** pemeriksaan-konflik (TF memori 0.85, standar 0.82).

## 3. Desain Antrean

### 3.1 Skema (dirilis sebagai migrasi v9)

> Tabel yang dirilis adalah `queue_jobs` di migrasi **v9** (`v09-embedding-queue-jobs.ts`), bukan v8 yang diusulkan di bawah — v8 dipakai untuk indeks `observations`. DDL final memakai `id TEXT PRIMARY KEY` (bukan INTEGER AUTOINCREMENT), menambah kolom `entity_repo`/`locked_by`/`backoff_until`, menyimpan payload snapshot, dan menyertakan indeks unik dedup observasi (`idx_observations_dedup` pada `(entity_name, observation)`) yang diminta P2.

```sql
CREATE TABLE IF NOT EXISTS queue_jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_kind     TEXT NOT NULL CHECK (entity_kind IN ('memory','standard','task')),
  entity_id       TEXT NOT NULL,
  job_kind        TEXT NOT NULL CHECK (job_kind IN ('embed','embed_kg')),
  payload         TEXT NOT NULL,      -- JSON: { content, title?, owner, repo }
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','done','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  enqueued_at     TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at      TEXT,
  lease_until     TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at    TEXT,
  last_error      TEXT
);
CREATE INDEX idx_queue_jobs_due ON queue_jobs(status, next_attempt_at);
CREATE UNIQUE INDEX idx_queue_jobs_pending_entity
  ON queue_jobs(entity_kind, entity_id) WHERE status = 'pending';
```

- `job_kind`: `embed` (tugas) vs `embed_kg` (memori, standar — ekstraksi KG + relasi standar).
- `entity_kind`/`entity_id` mencerminkan kunci tabel vektor (`memory_vectors.memory_id`, `standard_vectors.standard_id`, `task_vectors.task_id`) dan digunakan untuk penggabungan. Tanpa FK — worker membaca ulang baris langsung berdasarkan id, jadi job yang entitasnya dihapus menjadi no-op.
- Sistem migrasi (`MigrationManager`, tabel `_schema_version` per-versi, penerapan transaksional) — v9 murni **aditif**, jadi sepele untuk dibalik (§8). Nomor "v8" pada proposal asli di bawah adalah versi yang diusulkan; migrasi yang dirilis adalah v9.

### 3.2 State machine

```
pending ──claim──▶ processing ──success──▶ done
   ▲                    │
   │ kedaluwarsa lease  │ kegagalan (attempts < max)
   └────────────────────┴──▶ pending (next_attempt_at = now + backoff)
   │                    └ kegagalan (attempts >= max) ──▶ failed (racun)
```

> **Terverifikasi (2026-08-10):** nama status yang dirilis adalah enum literal `QueueJobStatus` — `pending | claimed | done | poison` (`src/mcp/embedding-queue/types.ts:46`). **Tidak ada status baris `failed`**: `failed` hanya ada sebagai penghitung runtime (`src/mcp/embedding-queue/worker.ts:92-95`), dan `poison` (attempts >= `EMBEDDING_QUEUE_POISON_THRESHOLD` = 5, `src/mcp/utils/constants.ts:151`) adalah status gagal terminal. Respons API memakai nilai enum literal; UI menampilkan `poison` sebagai label "Failed"/"Failed (poison)" — enum tidak pernah diganti nama.

- **Batch klaim** (atomik, tanpa kunci file — satu pernyataan SQLite):
  ```sql
  UPDATE queue_jobs SET status='processing', claimed_at=datetime('now'),
         lease_until=datetime('now','+60 seconds'), attempts = attempts + 1
  WHERE id IN (SELECT id FROM queue_jobs
               WHERE status='pending' AND next_attempt_at <= datetime('now')
               ORDER BY id LIMIT 32);
  ```
  Dilanjutkan dengan `SELECT … WHERE status='processing' AND claimed_at = <timestamp klaim ini>`.
- **Reaper lease**: pada setiap tick worker, `UPDATE queue_jobs SET status='pending', lease_until=NULL WHERE status='processing' AND lease_until < datetime('now')` — memulihkan job yang menjadi yatim karena proses crash. Lease = 60dtk >> satu batch.

### 3.3 Loop worker (dalam-proses, kooperatif, di kedua proses)

```
tick:
  panen lease yang kedaluwarsa
  klaim batch (K=32)
  jika kosong → tidur 50ms → ulangi
  [TANPA kunci file di sini] Inferensi batch ONNX atas payload yang diklaim (dikelompokkan per model)
  [kunci file, ~ms] db.withWrite(transaction {
      per job: upsertVectorEmbedding (idempoten)        // tabel vektor
      per job: tandai done ATAU (gagal → pending+backoff / failed)
  })
  jika job_kind == embed_kg:
     [tanpa kunci] compromise extractEntities
     [kunci file, ~ms] transaction { INSERT OR IGNORE entities/relations; INSERT observations; tandai done }
  ulangi segera jika masih ada pending
```

- **Inferensi tidak pernah memegang kunci.** Hanya fase tulis-DB ~ms (K upsert vektor dalam satu transaksi) yang masuk `withWrite`, menghormati kontrak "tulis hanya di bawah kunci".
- **Inferensi batch** (Fase 3, tetapi dirancang sejak awal): `@xenova/transformers` `pipeline("feature-extraction", …)` menerima `string[]` → `extractor(texts, { pooling:"mean", normalize:true })` mengembalikan `[N, 384]` — satu panggilan ONNX per batch K alih-alih N panggilan serial. Dikelompokkan per model (satu model `all-MiniLM-L6-v2` hari ini → satu grup; hook pengelompokan ada untuk multi-model di masa depan).
- **API enqueue** (dipanggil _di dalam_ transaksi tulis alat — lihat §4):
  ```ts
  enqueueJob(db, { entityKind, entityId, jobKind, payload }); // INSERT … ON CONFLICT (entity_kind, entity_id) WHERE status='pending'
  ```
  `ON CONFLICT … DO UPDATE SET payload=excluded.payload, attempts=0, enqueued_at=…` — aturan **penggabungan/debounce**: paling banyak satu job pending per entitas, selalu payload terbaru.
- **Interaksi hapus**: penghapusan entitas mengalir ke tabel vektor (`memory_vectors`, `standard_vectors`, `task_vectors` semuanya memiliki `ON DELETE CASCADE`). Worker tambahan membersihkan `DELETE FROM queue_jobs WHERE entity_id=? AND status='pending'` saat penghapusan — sepele, menghindari inferensi sia-sia. Tombstone tidak diperlukan.

### 3.4 Pemulihan crash (proses mati di tengah antrean)

1. Job dalam `pending` bertahan (SQLite, WAL, `synchronous=FULL`).
2. Job dalam `processing` diklaim ulang setelah kedaluwarsa lease 60dtk oleh worker hidup mana pun.
3. Job yang _di-enqueue tetapi tidak pernah di-commit_ tidak mungkin ada — enqueue atomik dengan commit baris (§4).
4. **Rekonsiliasi/backfill** (startup + alat manual): enqueue ulang semua yang kekurangan vektor:
   ```sql
   SELECT m.id, m.content, m.title, m.repo, m.owner FROM memories m
   LEFT JOIN memory_vectors mv ON mv.memory_id = m.id
   WHERE mv.memory_id IS NULL AND m.status='active';   -- sama untuk standar, tugas
   ```
   Ini adalah jaminan pamungkas bahwa jendela ketercarian (§5) tertutup bahkan setelah pembunuhan tanpa izin atau bug yang menjatuhkan job.

## 4. Konsistensi & Penanganan Kegagalan

### 4.1 Commit baris SEBELUM enqueue — atomik, tanpa status parsial

Setiap mutasi menjadi **satu** transaksi better-sqlite3: `db.transaction(() => { insert/update baris entitas; enqueueJob(...); })` — dieksekusi di dalam `withWrite` yang ada. Entah keduanya mendarat atau tidak. Enqueue ~µs (`INSERT`), jadi kunci dipegang hanya untuk commit, tidak pernah untuk inferensi. **Jangan pernah** enqueue-lalu-commit (akan membuat job yatim saat crash); jangan pernah commit-lalu-enqueue dalam tulis terpisah (akan membuat jendela di mana baris yang di-commit tidak memiliki job — job rekonsiliasi mencakup itu sebagai jaring pengaman).

Penggantian situs panggilan:

- `memory-write/create.ts` — bungkus `db.memories.insert(entry)` + enqueue `embed_kg`.
- `memory-write/update.ts` / `bulk.ts` — enqueue `embed_kg` hanya saat `content` berubah (pertahankan perilaku saat ini: `update.ts:92` upsert hanya saat konten berubah). Bulk: satu enqueue per entri yang dibuat/diperbarui; penggabungan per-entitas menjaga antrean tetap datar bahkan untuk bulk 1000 item.
- `standard-write/create|update|bulk` — enqueue `embed_kg` (worker menjalankan `saveExtractions` + `saveStandardRelations`).
- `task-write/effects.ts` — enqueue `embed`.
- `dashboard/StandardsController.ts:216,226,293,334` — ganti `vectors.upsert` inline dengan enqueue (modul helper yang sama; kedua proses mengimpornya).

### 4.2 Kegagalan permanen → pesan racun

- Kebijakan retry: backoff eksponensial `next_attempt_at = now + min(2^attempts s, 300 s)`, `max_attempts = 5`, lalu `status='failed'` dengan `last_error` dipertahankan.
- Penanganan racun: embedding yang gagal **tidak berbahaya secara desain** — baris sudah di-commit dan tetap dapat ditemukan melalui kemiripan-TF/FTS; embedding adalah peningkatan peringkat. Job yang gagal disajikan melalui tampilan admin status-antrean (§7 P3) dan dapat dijalankan ulang (`UPDATE status='pending'` manual) atau hanya ditutup kembali oleh job rekonsiliasi. Mereka tidak pernah memblokir job lain (klaim per-batch, kegagalan per-job). **Catatan (digantikan 2026-08-10):** pemulihan `UPDATE` manual kini diekspos sebagai API admin — `POST /api/queue/jobs/:id/retry` mengatur ulang `poison`/`done` → `pending` (attempts=0, `last_error`/backoff dibersihkan), `POST /api/queue/retry-all` membalik-bulk setiap baris racun — ditampilkan di tab Queue sebagai Re-run / Re-run all (TASK-296/297).
- Kegagalan KG berperilaku persis seperti hari ini (warn + lanjutkan) — `saveExtractions`/`saveStandardRelations` sudah menelan error.

### 4.3 At-least-once aman (audit idempotensi)

| Target                                                 | Mekanisme                                                 | Idempoten?                                                                                                                                             |
| ------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `memory_vectors` / `standard_vectors` / `task_vectors` | `INSERT … ON CONFLICT DO UPDATE` (satu baris per entitas) | ✅                                                                                                                                                     |
| `entities` (PK nama)                                   | `INSERT OR IGNORE`                                        | ✅                                                                                                                                                     |
| `relations` (PK dari/ke/tipe)                          | `INSERT OR IGNORE`                                        | ✅                                                                                                                                                     |
| `observations` (PK UUID acak)                          | `INSERT` biasa                                            | ❌ **sampai P2**: tambahkan indeks unik `(entity_name, observation, repo, owner)` + id deterministik (hash dari 4 kolom tersebut) → `INSERT OR IGNORE` |

Saling eksklusi lease membuat duplikat tidak mungkin bahkan sebelum P2; indeks unik membuatnya mustahil setelahnya.

### 4.4 `checkConflicts` — keputusan & interaksi dengan embedding asinkron

- **Tetap sinkron, di dalam kunci, pra-insert.** Ini adalah fitur _kebenaran_: respons (`MEMORY_CONFLICT` penolakan dengan memori yang bertentangan) dihitung sebelum baris ada, dan murni JS (tanpa ONNX) sehingga murah (~ms pada jalur TF yang di-tokenisasi).
- **Interaksi dengan embedding asinkron dari baris BARU: tidak ada.** `checkConflicts` hanya membaca tabel `memories` dan tidak pernah menyentuh `memory_vectors` — tulis worker nanti atas vektor baris baru tidak dapat menyebabkan konflik-diri palsu. Tulis sudah di-serialisasi oleh kunci file, jadi tidak ada ras lintas-proses baru yang diperkenalkan. (Parameter `vectors` yang diulirkan melalui `checkConflicts`/`checkCreateConflict` bersifat vestigial — aman untuk dibiarkan atau dihapus.)

## 5. Perilaku Jalur-Baca

- **Embedding kueri sinkron tetap.** `vectors.search` (embedding ONNX dari _kueri_) diperlukan pada setiap pencarian semantik; itu bukan bagian dari perubahan ini. Ini adalah satu-satunya panggilan ONNX yang harus tetap berada di jalur permintaan (modelnya sudah di-cache — cepat — dan ini pembacaan, tidak pernah di bawah kunci).
- **Jendela ketercarian**: setelah tulis di-commit tetapi sebelum worker memasang embedding (biasanya <1dtk; beberapa detik untuk bulk 1000 item), baris **tidak ada di `memory_vectors`**, sehingga `vectors.search` tidak menghasilkan skor untuknya (`keywordScore = 0`).
  - **Ia tetap dapat ditemukan**: tahap kandidat memory-read (`memory.read.ts:115` `searchBySimilarity`, TF JS murni di atas `memories`, diurutkan `importance DESC, created_at DESC` LIMIT 100) menyertakan baris baru — ia diberi peringkat dengan komponen `similarityScore` TF (bobot 0.4) alih-alih skor kata kunci ONNX. Standar tambahan memiliki FTS5. Pencarian detail berdasarkan id/kode tidak terpengaruh (SQL langsung).
  - **Perubahan perilaku yang didokumentasikan**: peringkat hibrida untuk baris yang baru ditulis untuk sementara diturunkan (tanpa kontribusi kata kunci) hingga vektor mendarat. Dapat diterima: ia konvergen dalam jendela, dan jalur inline saat ini _sudah_ kehilangan embedding sepenuhnya ketika model gagal — desain ini secara ketat lebih baik (konvergensi akhir + rekonsiliasi).
  - **Koreksi atas asumsi sebelumnya (digantikan oleh migrasi v10)**: saat desain, fallback memori adalah kemiripan-TF, **bukan FTS** — `memories_fts` dihapus (`migrations.ts:760-776`). Hal itu berubah setelah desain ini dirilis: **migrasi v10 menambahkan kembali `memories_fts`** dan bobot kata kunci 0.30 diberi makan FTS `bm25`, sehingga "peningkatan P3 opsional" (penambahan kembali FTS memori) kini **terimplementasi** — tidak lagi opsional/belum dirilis.

## 6. Pengurutan, Dedupe & Backpressure

### 6.1 Pengurutan: **last-write-wins per entitas** (bukan FIFO)

Tabel vektor adalah upsert satu-baris yang dikunci oleh id entitas — _pengurutan akhir apa pun_ konvergen ke payload yang terakhir diproses. Dua skenario yang sensitif terhadap urutan:

- **update(A) lalu update(B) untuk id yang sama**: penggabungan menjaga paling banyak satu job `pending` per entitas, selalu payload terbaru. Jika A sudah diklaim (`processing`) saat B di-enqueue, B memasukkan baris pending baru; worker memproses A lalu B → status akhir = B. Benar apa pun jalannya. **LWW benar secara semantik**: vektor basi salah, urutan tulis-lama-menang tidak berarti antar entitas.
- **Urutan lintas-entitas**: tidak relevan (baris independen). FIFO adalah best-effort melalui `ORDER BY id` pada klaim; tidak ada jaminan yang diperlukan.

### 6.2 Dedupe/debounce

- **Penggabungan sisi-enqueue** (indeks unik parsial + `ON CONFLICT DO UPDATE`) — satu job pending per `(entity_kind, entity_id)`, payload terbaru menang.
- **Batching sisi-batch** — K=32 teks melalui satu panggilan ONNX, dikelompokkan per model (satu model hari ini). Memperbaiki hotspot "N inferensi serial" di `bulk.ts` dan mengubah bulk 1000 item menjadi ~32 panggilan model.

### 6.3 Backpressure

- **Tanpa batas keras pada enqueue** — tulis tidak boleh gagal karena antrean penuh; antrean adalah peningkatan. Pertumbuhan dibatasi oleh laju permintaan (berirama-agen, rendah).
- **Penanda air tinggi lunak**: `pending > 1000` → `logger.warn` + naikkan batch K (32 → 64) dan hentikan tidur idle; worker menyesuaikan diri untuk menguras throughput.
- **Kebijakan pengurasan**: worker menjalankan klaim→proses→klaim terus menerus selama masih ada pekerjaan; tidur hanya saat kosong.
- **Shutdown anggun (SIGTERM/SIGINT)**: perluas handler yang ada di `server.ts:118-126` — berhenti mengklaim, selesaikan batch yang sedang berjalan (timeout 2dtk), lalu `db.close()`. Pembunuhan keras aman: job yang sedang berjalan memiliki lease 60dtk yang diklaim ulang oleh proses hidup mana pun; tidak ada yang hilang. Opsional `await worker.flush()` (proses sampai kosong, dibatasi) saat `MEMORY_QUEUE_FLUSH_ON_EXIT=true` untuk proses dashboard.
- **Higiene tabel**: sapuan berkala `DELETE FROM queue_jobs WHERE status IN ('done','failed') AND processed_at < datetime('now','-7 days')` (tick worker + startup).

## 7. Rencana Implementasi Bertahap

| Fase                                                      | Lingkup                                                                                                                                                                                                                                                                                                                                 | Kriteria penerimaan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Revert                                                                                                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1 — Substrat + jalur memori (minimal, aman)** ✅       | Migrasi v9 (`queue_jobs` + indeks penggabungan; diusulkan v8). Modul `embedding-queue` (`enqueueJob`, `EmbeddingQueueWorker`, `reconcileMissingVectors`). Pasang worker di `server.ts` MCP. Ganti `vectors.upsert` + `saveExtractions` inline memory-write create/update/bulk dengan enqueue transaksional.                             | Waktu pegang-kunci p50 memory-write < 20ms (sebelumnya 150–500ms). Baris baru memiliki embedding dalam 5dtk. Perilaku pencarian & konflik memori identik dengan hari ini. Rekonsiliasi mengisi baris yang dihapus dari `memory_vectors` pada boot berikutnya. ✅ dirilis (v9, TASK-013) — target waktu pegang-kunci terpenuhi dalam praktik; ukuran batch K dapat diatur via env (`EMBEDDING_QUEUE_BATCH_SIZE`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Diff terkecil: pulihkan panggilan `await` inline; biarkan/pertahankan tabel v9 (aditif). `DROP TABLE queue_jobs` + `DELETE FROM _schema_version WHERE version=9` untuk rollback penuh. |
| **P2 — Semua penulis + lintas-proses** ✅                 | Enqueue di standard-write (create/update/bulk termasuk `saveStandardRelations`), task-write (`embed`), dashboard StandardsController. Aktifkan worker di proses dashboard (saling eksklusi lease). Indeks unik `observations` + id deterministik (keamanan at-least-once). Rekonsiliasi startup untuk ketiga jenis entitas.             | Edit standar dashboard tidak pernah memblokir ONNX; tulis MCP+dashboard bersamaan menguras dengan nol observasi duplikat; kill -9 di tengah batch → job tersisa diproses ulang. ✅ dirilis — worker dashboard di `src/dashboard/server.ts`; indeks unik dedup `observations` di v9.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Worker di dashboard di belakang flag env `ENABLE_QUEUE_WORKER=false`; worker MCP terus menguras.                                                                                       |
| **P3 — Batching, backpressure, observabilitas, admin** ✅ | Inferensi batch K=32 dikelompokkan per model; penanda air tinggi + batch adaptif; metrik antrean (kedalaman, waktu proses p95, tingkat kegagalan) melalui log terstruktur + statistik terkait `/health`; admin job gagal (jalankan-ulang/hapus); sapuan purge; opsional penambahan kembali FTS memori untuk cakupan kata kunci jendela. | Bulk 1000 item menguras dalam <30dtk; antrean kosong setelah idle 60dtk; job racun terlihat & dapat dijalankan ulang; ukuran tabel antrean dibatasi oleh sapuan. — **Dirilis**: batching K=32 + backoff adaptif + purge + batas racun ada di `src/mcp/utils/constants.ts` + `embedding-queue/worker.ts`; observabilitas antrean diekspos di `/api/queue/status` (`queue.routes.ts:7`); **admin job gagal (TASK-296)** — `GET /api/queue/jobs` (daftar, filter `?status=` literal opsional, default `pending,poison`, terbaru-dahulu), `POST /api/queue/jobs/:id/retry`, `POST`/`DELETE /api/queue/jobs/:id` (hapus), `POST /api/queue/retry-all` (`queue.routes.ts:11-15`) — plus **UI tab Queue** (TASK-297: ringkasan status + tabel Failed jobs dengan Re-run/Clear per baris dan Re-run all; tab ke-11 setelah Handoffs). **Penambahan kembali FTS memori yang opsional dirilis terpisah sebagai migrasi v10** ("peningkatan P3 opsional" di §5). **NEXT PHASE** lama (admin GUI untuk job gagal jalankan-ulang/hapus; endpoint metrik antrean terkait `/health`) kini dirilis: `GET /api/health` (`system.routes.ts:7`) dan `GET /api/metrics` (`system.routes.ts:10` — kolom `worker` = snapshot worker embedding termasuk kedalaman antrean + penghitung processed/failed/poisoned) keduanya ada dan teruji-integrasi. | Murni tambahan — masing-masing dapat di-toggle secara independen.                                                                                                                      |

**Catatan keterbalikan**: P1 adalah satu-satunya fase yang mengubah jalur tulis memori; revert-nya adalah pemulihan satu-diff dari perilaku inline saat ini. P2/P3 bersifat aditif. Setiap fase dapat di-ship/rollback secara independen.

## 8. Risiko & Mitigasi

| #   | Mode kegagalan                                                 | Dampak                                                | Mitigasi                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Proses crash di tengah antrean**                             | Job `processing` yatim; baris kekurangan vektor       | Kedaluwarsa lease 60dtk + reaper; rekonsiliasi/backfill saat startup; enqueue atomik dengan commit → tanpa status enqueue-yatim; at-least-once aman oleh idempotensi                                                                  |
| 2   | **Kontensi DB (worker vs penulis)**                            | Tulis batch worker bersaing dengan tulis alat         | Tulis worker di-batch menjadi satu transaksi ~ms di bawah `withWrite`; `busy_timeout=30000` sudah disetel; inferensi (bagian lambat) tidak pernah menyentuh DB atau kunci                                                             |
| 3   | **Pertumbuhan memori (worker)**                                | Akumulasi tensor/array selama sesi panjang            | Batch terbatas K=32; buang referensi setelah setiap batch; model sudah berada di kedua proses (tanpa jejak baru jika worker berjalan dalam-proses); `--max-old-space-size` tidak berubah                                              |
| 4   | **Kegagalan model ONNX / env yang diturunkan**                 | Embedding tidak pernah mendarat                       | Semantik warn-dan-lanjutkan yang ada dipertahankan; racun pada 5 attempts; rekonsiliasi mencoba lagi pada boot berikutnya; pencarian kemiripan-TF tidak terpengaruh                                                                   |
| 5   | **Pemrosesan ganda (kedua worker)**                            | Observasi duplikat; inferensi sia-sia                 | Klaim lease atomik; indeks unik `observations` (P2) menghapus target non-idempoten terakhir; vektor/entitas/relasi sudah idempoten                                                                                                    |
| 6   | **Pertumbuhan antrean tak terbatas**                           | Pembengkakan tabel                                    | Penanda air tinggi lunak + pengurasan adaptif; sapuan purge 7-hari; enqueue µs sehingga tulis tidak pernah memblokir apa pun                                                                                                          |
| 7   | **Regresi: test yang menegaskan ketersediaan vektor langsung** | Asersi pasca-tulis pada `memory_vectors` menjadi racy | Test jalur-pencarian tidak terpengaruh (searchBySimilarity membaca `memories`); test jalur-tulis apa pun yang menegaskan keberadaan vektor harus diperbarui untuk polling atau memanggil worker — ditandai sebagai item penerimaan P1 |
| 8   | **Vektor basi setelah crash pembaruan**                        | Konten diperbarui, vektor lama bertahan               | Upsert vektor berjalan pada payload ter-commit terbaru (LWW); rekonsiliasi mencakup baris yang `updated_at` > `memory_vectors.updated_at` sebagai opsi pengerasan P3                                                                  |

## 9. Artefak terkait

- Memori keputusan: `MEM-368` (outbox embedding/KG asinkron: queue_jobs SQLite + worker lease)
- Task implementasi: `TASK-013` (Implementasi antrean offload embedding/KG sesuai desain TASK-002) ✅ **selesai**
