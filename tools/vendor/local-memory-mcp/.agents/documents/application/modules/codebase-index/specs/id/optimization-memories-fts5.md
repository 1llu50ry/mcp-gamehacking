# Desain: Pencarian Teks Lengkap FTS5 untuk Memori

> **Status: ✅ DIIMPLEMENTASIKAN (terverifikasi 2026-08-08).** Desain ini dirilis melalui migrasi **`v10-memories-fts`** (TASK-014) — indeks skema kini di **`SCHEMA_VERSION 24`** (`src/mcp/storage/migrations/index.ts`). Header "belum diimplementasikan" asli di bawah dipertahankan sebagai catatan historis; catatan inline menandai di mana rilis menyimpang dari desain (terutama: migrasi mendarat sebagai **v10**, bukan v8 yang diusulkan).

- **Task**: TASK-003 (optimization) · **Memori keputusan**: MEM-367 · **Implementasi**: TASK-014
- **Repo**: vheins/local-memory-mcp · **Scope**: desain + catatan implementasi yang dirilis

## 1. Ikhtisar

Pencarian memori saat ini melakukan pemindaian penuh `LIKE '%q%'` pada `content`/`title`/`tags` di dua jalur panas:

| Jalur                      | Lokasi                                               | Masalah                                                                                                                          |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `searchByRepo`             | `src/mcp/entities/memory/entity.ts:173-191`          | `(content LIKE ? OR title LIKE ? OR tags LIKE ?)` — pemindaian tabel penuh per panggilan (dipakai oleh `agent-context.ts:53-69`) |
| `listMemoriesForDashboard` | `entity.ts:404-496` (pencarian di :480, tag di :464) | `(title LIKE ? OR content LIKE ?)` + `tags LIKE ?` — pemindaian penuh per permintaan dashboard/resource                          |

Codebase sudah memiliki pola FTS5 yang mapan untuk diikuti: `codebase_symbols_fts` (tabel konten-eksternal + trigger, `migrations.ts:330-350`) dan `coding_standards_fts` (pola lengkap termasuk backfill, `migrations.ts:672-706`). Tabel `memories_fts` **pernah ada dan dihapus** di migrasi v1 (`dropObsoleteMemoriesFts`, `migrations.ts:760-776`) — jadi ekstensi FTS5 terkonfirmasi terkompilasi ke dalam SQLite ter-bundle (better-sqlite3), dan nama tabel/trigger lama bebas digunakan ulang pada basis data baru maupun yang sudah di-upgrade.

Desain ini membuat ulang `memories_fts` sebagai migrasi aditif, menghubungkan dua jalur baca ke tabel tersebut dengan fallback LIKE permanen (mencerminkan `codebase-symbol.ts:69-256`), dan memasukkan skor `bm25()` yang dinormalisasi ke dalam campuran hibrida SPEC-001 yang ada di `src/mcp/tools/memory.read.ts` (bobot 0.40/0.30/0.15/0.15, `memory.read.ts:49-54`) dengan cara yang sama seperti `standard-read/search.ts:229-251` memasukkan skor kata kunci teksnya.

> **Diimplementasikan (terverifikasi terhadap `src/`):** `memories_fts` berada di migrasi **v10** (`src/mcp/storage/migrations/v10-memories-fts.ts`); `buildFtsMatchQuery` ada di `src/mcp/utils/fts.ts`; `searchByFts` / `searchByFtsScored` / jalur cepat FTS dashboard ada di `src/mcp/entities/memory/search.ts`; skor bm25 ternormalisasi min-max memberi nilai pada bobot kata kunci 0.30 di `src/mcp/tools/memory.read.ts` (hits khusus-FTS juga digabung sebagai kandidat tambahan). Filter `tags` dashboard tetap predikat LIKE (desain §5.3).

## 2. Skema

```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  title, content, tags,
  content='memories',
  content_rowid='rowid'
);
```

### Keputusan pemetaan kolom

| Kolom FTS | Sumber (`memories`)                       | Tipe                    | Catatan                                                                                                                                                       |
| --------- | ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`   | `title TEXT` (nullable)                   | di-tokenisasi, diindeks | NULL → tanpa token (oke)                                                                                                                                      |
| `content` | `content TEXT NOT NULL`                   | di-tokenisasi, diindeks | Permukaan pencarian utama                                                                                                                                     |
| `tags`    | `tags TEXT` (string array JSON, nullable) | di-tokenisasi, diindeks | `unicode61` memperlakukan `[`, `]`, `"`, `,` sebagai pemisah → setiap tag menjadi token yang dapat diindeks (mis. `["data","pipeline"]` → `data`, `pipeline`) |
| _(rowid)_ | `memories.rowid`                          | kunci join              | `content_rowid='rowid'`; `memories` memiliki PK TEXT sehingga `rowid` tersembunyi tersedia — sama seperti `codebase_symbols` (`migrations.ts:331`)            |

### Opsi yang ditolak (beserta alasannya)

- **Kolom `repo`/`owner`/`type`/`status` sebagai `UNINDEXED`**: **Tidak.** Setiap kolom filter/tampilan sudah diambil atau difilter melalui `JOIN memories m ON m.rowid = fts.rowid` (sama seperti `codebase-symbol.ts:180-187` dan `standard.ts:220-227`). Indeks yang ada (`idx_memories_owner_repo_type`, `idx_memories_status`, … `migrations.ts:714-720, 542`) membuat join tetap murah. Kolom yang tidak diindeks akan menggandakan data, menyimpang saat `memories` bertambah kolom, dan tidak memberi manfaat pada query plan.
- **Tokenizer `trigram`**: **Tidak (default ke `unicode61`).** Pembenarannya di bawah.

### Pilihan tokenizer: `unicode61` (default) + prefiks `*` per istilah

Pola pencarian yang teramati: kata kunci tunggal, multi-kata kunci, kata parsial, tag, pengenal teknis (konteks MEM-365, TASK-003). Alasan:

1. **Konsistensi**: simbol dan standar sama-sama menggunakan `unicode61` default (`migrations.ts:330-332, 672-676`). Satu perilaku tokenizer di ketiga tabel FTS.
2. **Paritas `LIKE %q%`**: pola recall dominan adalah substring _awal token_ (`"vec"` → `"vector"`, `"fts"` → `"fts5"`). `unicode61` + menambahkan `*` pada setiap istilah (`vec*`) mereproduksi ini melalui indeks prefiks — idiom FTS5 standar.
3. **Biaya `trigram`**: mencocokkan substring _di tengah_ kata mana pun (paritas LIKE sejati) tetapi (a) tidak dapat melakukan semantik frasa seluruh-token/stemmed, (b) memperbesar ukuran indeks kira-kira dua kali lipat, (c) tidak mengubah cerita CJK secara fundamental (memberikan pencocokan substring CJK, tetapi lihat §7), dan (d) akan menjadi satu-satunya tabel di DB yang menggunakannya — pemisahan pemeliharaan. Tunda sebagai evaluasi lanjutan jika paritas recall pada substring di tengah kata menjadi kebutuhan nyata; desain ini terisolasi oleh fallback LIKE permanen.
4. **CJK**: `unicode61` mempertahankan rangkaian CJK yang berdekatan sebagai satu token (tanpa segmentasi), tetapi pencocokan prefiks tetap berfungsi (`数*` cocok dengan token yang dimulai `数`). Dapat diterima untuk v1, didokumentasikan di §7; `trigram` adalah jalur eskalasi yang didokumentasikan jika recall CJK terbukti tidak memadai.

## 3. Trigger

Cerminkan bentuk persis trigger simbol (`migrations.ts:334-349`) dan trigger standar (`migrations.ts:678-693`): `{table}_ai/_ad/_au`, menggunakan `new.rowid`/`old.rowid`, hapus-lalu-sisipkan untuk pembaruan.

```sql
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;

CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, tags)
  VALUES('delete', old.rowid, old.title, old.content, old.tags);
END;

CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, tags)
  VALUES('delete', old.rowid, old.title, old.content, old.tags);
  INSERT INTO memories_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;
```

**Keamanan nama trigger**: `memories_ai/_ad/_au` + `memories_fts` lama dihapus tanpa syarat di migrasi v1 (`dropObsoleteMemoriesFts`, `migrations.ts:760-776`), yang berjalan sebelum migrasi baru mana pun di setiap basis data (baru maupun di-upgrade). Nama-nama tersebut terbukti bebas. Pertahankan nama konvensional untuk konsistensi.

**Cakupan jalur tulis** — trigger berada di level DB, jadi mencakup setiap mutasi secara otomatis, termasuk:

- `insert`/`update`/`bulkInsertMemories`/`bulkUpdateMemories` (`entity.ts:7-94, 193-293`)
- `archiveExpiredMemories`/`archiveLowScoreMemories` (status `UPDATE`, `memory.archive.ts:19-39`) — indeks ulang dengan konten identik; baris yang diarsipkan tetap di FTS tetapi dikecualikan saat kueri melalui join (lihat §4)
- `bulkDeleteMemories` (`memory.archive.ts:4-17`) — trigger hapus menghapus dari FTS

**Penting**: FTS tidak boleh memfilter `status='active'`/`expires_at` — itu tetap berada di predikat `JOIN`, sehingga baris yang diarsipkan/kedaluwarsa tidak terlihat oleh pencarian namun tetap dapat diindeks jika diaktifkan kembali.

## 4. Migrasi & Backfill

### 4.1 Migrasi aditif — **dirilis sebagai v10** (diusulkan sebagai v8)

> `MigrationManager` kini berada di `src/mcp/storage/migrations/index.ts` dengan satu file per versi (`vNN-*.ts`); `SCHEMA_VERSION = 24`. Migrasi yang dirilis adalah **`v10-memories-fts`**, bukan v8 yang diusulkan di bawah (v8 dipakai untuk indeks `observations`, v9 untuk tabel antrean `queue_jobs` embedding).

- `SCHEMA_VERSION` bergerak 7 → **10** saat rilis (`src/mcp/storage/migrations/index.ts:29` — kini 24).
- Entri baru ditambahkan ke larik `MIGRATIONS`. **Jangan pernah mengedit** entri yang ada — rantai bersifat append-only dan `MigrationManager` melewati versi yang sudah diterapkan.
- Guard `up()` mencerminkan v4 (`v04-coding-standards-fts.ts`):

```ts
{
  version: 8, // ⚠️ DIRILIS SEBAGAI VERSION 10 — lihat v10-memories-fts.ts
  name: "memories-fts",
  up: (db) => {
    const ftsExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'"
    ).get();
    if (ftsExists) { logger.debug("[Migration] memories_fts already exists, skipping"); return; }
    db.exec(`<CREATE VIRTUAL TABLE ... > <CREATE TRIGGER memories_ai ...> <CREATE TRIGGER memories_ad ...> <CREATE TRIGGER memories_au ...>`);
    // backfill (di bawah)
  }
}
```

### 4.2 Backfill

Yang disukai — **backfill pernyataan tunggal di dalam transaksi migrasi**, persis seperti v4 (`v04-coding-standards-fts.ts`):

```sql
INSERT INTO memories_fts(rowid, title, content, tags)
SELECT rowid, title, content, tags FROM memories;
```

- Pelari migrasi membungkus setiap `up()` dalam `db.transaction` (`src/mcp/storage/migrations/index.ts`), sehingga pembuatan-tabel + trigger + backfill + baris `_schema_version` di-commit secara atomik. Crash di tengah migrasi di-rollback; saat restart versi tidak ada dan migrasi dijalankan ulang (guard `ftsExists` membuatnya idempoten).
- **Interaksi ukuran-batch / kunci** (`storage/write-lock.ts`): migrasi berjalan di konstruktor `SQLiteStore` (`sqlite.ts:91-92`), **di luar** kunci file lintas-proses (`withWrite`, `write-lock.ts:62-69`; kunci bersifat per-operasi-tulis, bukan per-startup). Ini adalah properti yang sudah ada yang dibagikan oleh migrasi v1–v7 — bukan risiko baru. Mitigasi, secara berurutan:
  - Backfill adalah **satu pernyataan atomik** (better-sqlite3 + WAL + `busy_timeout = 30000`, `sqlite.ts:76-79` men-serialisasi penulis bersamaan; tulis proses lain memblokir ≤30 dtk, lalu commit, lalu pernyataan ini melihatnya — trigger pada tulis proses lain menjaga FTS tetap sinkron apa pun).
  - Skala tipikal: memori berjumlah ribuan baris → pernyataan tunggal sudah cukup.
  - **Hanya jika** basis data melebihi ~50k memori: potong backfill dalam rentang `rowid` 500 (`WHERE rowid > ? AND rowid <= ?` di dalam transaksi yang sama) — setiap potongan tetap atomik; masalah kunci tulis identik dengan pola chunked `bulkUpdateMemories` (`entity.ts:280-292`).
- **Utilitas rebuild** (juga jalur pemulihan backfill jika indeks korup dicurigai): `INSERT INTO memories_fts(memories_fts) VALUES('rebuild');` — mengisi ulang dari `memories` (konten eksternal). Dapat tinggal di file migrasi sebagai komentar atau diekspos nanti oleh alat ops; tidak dihubungkan ke alat mana pun dalam scope ini.

**Verifikasi pasca-migrasi**: `SELECT COUNT(*) FROM memories` vs `SELECT COUNT(*) FROM memories_fts` harus sama (baris dengan `title`/`tags` NULL tetap menghasilkan entri rowid dengan token kosong).

## 5. Pengalihan Kueri

### 5.1 Helper pembangun kueri — `buildFtsMatchQuery(raw: string): string`

✅ **Diimplementasikan** di `src/mcp/utils/fts.ts` (dengan `sanitizeFtsTerm` dan konstanta `FTS_MAX_TERMS = 8` / `FTS_CANDIDATE_CAP = 100`). Semantik:

1. Trim. Kosong → kembalikan `""` (pemanggil jatuh ke jalur non-FTS).
2. Ekstrak frasa bertanda kutip ganda yang seimbang: `/"([^"]+)"/g` → pertahankan masing-masing sebagai token frasa apa adanya (divalidasi: isi frasa hanya boleh berisi huruf/angka/spasi/`_` setelah sanitasi, jika tidak buang).
3. Untuk setiap istilah tersisa yang dipisahkan spasi: buang karakter meta FTS5 (kelas karakter `[^\p{L}\p{N}_]` → dihapus), tambahkan `*` untuk pencocokan prefiks, buang hasil kosong.
4. Gabungkan token frasa + istilah berprefiks dengan `AND` eksplisit. Batasi 8 istilah (penjaga terhadap kueri patologis).
5. Hasil kosong → kembalikan `""` (fallback ke LIKE).

Contoh: `"data pipeline"` → `"data pipeline"`; `optimize query` → `optimize* AND query*`; `fts5` → `fts5*`; `"data" etl` → `"data" AND etl*`.

### 5.2 `searchByRepo` (`entity.ts:173-191`)

Struktur mencerminkan `codebase-symbol.ts:69-79` (`tryFtsSearch` → fallback `likeSearch`):

```
if (query.trim() === "")  → SQL non-FTS yang ada, tanpa klausa LIKE
                            (owner/repo/status/expiry/type, ORDER BY importance DESC, created_at DESC)
else:
  coba jalur cepat FTS → jika baris dikembalikan, gunakan; saat throw atau kosong → fallback LIKE (SQL yang ada tidak berubah)
```

Jalur cepat FTS (mempertahankan filter saat ini persis — test memori kedaluwarsa `sqlite.test.ts:225-241` harus tetap lulus):

```sql
SELECT m.*
FROM memories_fts fts
JOIN memories m ON m.rowid = fts.rowid
WHERE memories_fts MATCH ?                 -- buildFtsMatchQuery(query)
  AND (m.owner = ? AND) m.repo = ?         -- ownerClause opsional (entity.ts:175)
  AND m.status = 'active'
  AND (m.expires_at IS NULL OR m.expires_at > ?)
  AND m.type = ?                           -- opsional
ORDER BY bm25(memories_fts)                -- paling relevan lebih dulu
LIMIT ?;
```

- **Keputusan pengurutan**: kode saat ini mengurutkan dengan `importance DESC, created_at DESC` terlepas dari kualitas kecocokan. Untuk jalur _pencarian_ (pengambilan konteks agen), relevansi (`bm25`) adalah kunci utama yang benar, dengan opsi `ORDER BY bm25(memories_fts), m.importance DESC, m.created_at DESC` untuk memadukan. Jika paritas perilaku yang ketat diperlukan oleh reviewer, `ORDER BY m.importance DESC, m.created_at DESC` adalah pengganti langsung — dicatat sebagai pilihan satu-baris saat implementasi.
- Jalur kueri-kosong tetap berupa pemindaian terindeks biasa (`idx_memories_owner_repo`), sehingga kueri tanpa pencarian tidak pernah menyentuh FTS.

### 5.3 `listMemoriesForDashboard` (`entity.ts:404-496`)

Saat `options.search` ada, ganti klausa `(title LIKE ? OR content LIKE ?)` (`:480`) dengan join FTS; semua filter lain (`owner/repo/type/isGlobal/importance`) tetap sebagai predikat `m.*` pada join. Filter `tag` (`:464`) **tetap sebagai `m.tags LIKE ?`** — itu adalah filter substring yang hampir-tepat dan pencocokan token FTS pada array JSON akan mengubah semantik (`tags LIKE '%my-tag%'` dapat mencocokkan substring multi-kata yang akan dipecah oleh FTS).

```sql
-- count (paritas: total = jumlah terfilter penuh, bukan hanya halaman yang dikembalikan)
SELECT COUNT(*) FROM memories_fts fts
JOIN memories m ON m.rowid = fts.rowid
WHERE memories_fts MATCH ? AND <predikat owner/repo/type/is_global/importance/tag>;

-- data
SELECT m.*, CASE WHEN m.hit_count > 0 THEN CAST(m.recall_count AS REAL) / m.hit_count ELSE 0 END AS recall_rate
FROM memories_fts fts
JOIN memories m ON m.rowid = fts.rowid
WHERE memories_fts MATCH ? AND <predikat yang sama>
ORDER BY m.<sortBy> <sortOrder>           -- allowlist sudah ditegakkan (:438-448)
LIMIT ? OFFSET ?;
```

### 5.4 Bentuk kueri MATCH (referensi)

| Maksud                                 | Input pengguna      | Ekspresi `MATCH`           |
| -------------------------------------- | ------------------- | -------------------------- |
| Kata kunci tunggal                     | `fts5`              | `fts5*`                    |
| AND multi-kata kunci (default)         | `data pipeline`     | `data* AND pipeline*`      |
| AND eksplisit                          | `data AND pipeline` | `data* AND pipeline*`      |
| OR                                     | `data or pipeline`  | `data* OR pipeline*`       |
| Frasa                                  | `"data pipeline"`   | `"data pipeline"`          |
| Prefiks (kata parsial)                 | `opti`              | `opti*`                    |
| Hanya tag (jika suatu saat diperlukan) | —                   | `tags:data*`               |
| Tag digabung dengan teks               | —                   | `data* AND tags:pipeline*` |

### 5.5 Di luar cakupan (terverifikasi — **jangan** dialihkan)

- `memory.vector.ts:44` `tags LIKE ?` — _pra-filter_ kandidat vektor, bukan pencarian teks bebas; biarkan.
- `task/entity.ts:215,258,305,344` — tugas (jalur LIKE sendiri, entitas berbeda; tugas terpisah di masa depan).
- `code-generator.ts:34`, `dashboard/controllers/KGController.ts:23` — situs LIKE yang tidak terkait.
- Fallback LIKE `codebase-symbol.ts:217-256` — biarkan apa adanya (ini adalah _pola_ yang sedang disalin).

## 6. Integrasi Skor Hibrida

### 6.1 Skor kata kunci FTS — `bm25()` dinormalisasi

`bm25(memories_fts)` mentah bersifat tanpa unit, **non-positif, lebih besar = lebih buruk** (paling negatif = terbaik). Normalisasi ke 0..1 per kueri di atas himpunan kandidat top-k (k = 100):

```sql
SELECT fts.rowid, bm25(memories_fts) AS b25
FROM memories_fts fts
JOIN memories m ON m.rowid = fts.rowid
WHERE memories_fts MATCH ?
  AND m.owner = ? AND m.repo = ?        -- scope repo (+ penanganan is_global = 1, seperti di searchBySimilarity)
  AND m.status = 'active'
ORDER BY b25
LIMIT 100;
```

Normalisasi (di `memory.read.ts` atau helper di `utils/fts.ts`):

```
minB = min(b25 atas himpunan); maxB = max(b25 atas himpunan)
score = (maxB == minB) ? 1.0 : 1 - (b25 - minB) / (maxB - minB)
```

Kecocokan terbaik (paling negatif) → 1.0; terburuk dalam himpunan → ≈ 0. Mandiri per kueri — tanpa statistik global, tanpa penyimpangan kalibrasi. Id yang hilang → 0 (sama seperti `vectorScoreMap.get(id) ?? 0` saat ini, `memory.read.ts:174`).

### 6.2 Tempatnya terhubung ke `memory.read.ts` (cerminkan `standard-read/search.ts`)

`standard-read/search.ts` menghitung `keywordScore = scoreKeywordRelevance(...)` (pemindaian teks) dan mengalikannya dengan `HYBRID_WEIGHTS.keyword = 0.30` (`search.ts:231-240`); kemiripan vektor masuk melalui `candidate.similarity` dan rerank ONNX dikalikan dengan **0** di cabang utama (`search.ts:237`) — vektor hanyalah sumber kandidat fallback ketika kemiripan kosong (`search.ts:252-281`).

Cerminkan itu di `memory.read.ts`:

1. **Sumber kueri**: gunakan `effectiveQuery` (pasca-time-tunnel, `memory.read.ts:110`) untuk `MATCH` FTS — **bukan** output `expandQuery(...)` (`:111`). Ekspansi menyuntikkan sinonim (`query-expander.ts:5-14`) yang akan membatasi kecocokan kata kunci secara keliru. Pertahankan `searchQuery` (yang diekspansi) untuk jalur vektor/kemiripan dan `queryTerms` (`:165`).
2. **Cabang utama** (`candidates.length > 0`, `:172-190`): ganti `keywordScore = vectorScoreMap.get(c.memory.id) ?? 0` (`:174`) dengan `keywordScore = ftsScoreMap.get(c.memory.id) ?? 0`. Semua yang lain — `recencyScore`, `domainScore`, matematika bobot `:177-181` — tidak berubah. Secara opsional lipat rerank ONNX sebagai istilah `* 0` agar situs panggilan tetap jujur, persis seperti `search.ts:237`.
3. **Cabang fallback** (`:191-213`): ketika kemiripan mengembalikan nol kandidat, ambil kandidat dari top-k FTS (join ke `getByIds` seperti cabang vectorResults yang ada) dengan `keywordScore = ftsScoreMap.get(id)`, `similarityScore = 0`, dan redistribusi bobot yang sama (pola `remainingWeight`, `search.ts:262-268`).
4. **Fallback error** (`:214-231`): tidak berubah (keywordScore = 0, bobot dilipat ke kemiripan) — panggilan FTS dibungkus dalam `try/catch` yang sama seperti pencarian vektor saat ini.
5. Logika ambang/paginasi (`:233-247`) tidak disentuh. Bobot tidak disentuh.

Efek bersih: bobot kata kunci `0.30` menjadi sinyal **leksikal** nyata (bm25 atas title+content+tags) alih-alih skor vektor ONNX, yang sesuai dengan maksud SPEC-001 dan implementasi standard-read.

## 7. Kasus Tepi

| Kasus                                                                                  | Perilaku                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kueri kosong**                                                                       | `searchByRepo("")` → melewati FTS sepenuhnya; kueri terindeks biasa yang diurutkan berdasarkan importance (perilaku saat ini untuk `LIKE '%%'` dipertahankan). Dashboard: `search` tidak ada → tanpa cabang FTS.                                                                                                                                                                                                                                                 |
| **Kueri semua-stopword / sepenuhnya tersanitasi** (mis. `"the ?!?"`, tanda baca murni) | `buildFtsMatchQuery` → `""` → fallback LIKE (yang mengembalikan semua yang cocok dengan `%%`, yaitu semantik saat ini). FTS5 secara default **tidak memiliki daftar stopword** (tidak seperti FTS4), jadi perilaku stopword hanya apa yang dihilangkan sanitizer. Jika daftar stopword pernah ditambahkan, kueri semua-stopword secara alami mengembalikan 0 baris → fallback terpicu.                                                                           |
| **Karakter khusus: `"` `*` `-` `(` `)` `~` `:` `'`**                                   | Dihilangkan per-istilah oleh sanitizer sebelum `*` ditambahkan. `data-pipeline` → `data* AND pipeline*` (tanda hubung adalah pemisah `unicode61` — sama seperti LIKE hari ini, yang tidak akan mencocokkan tanda hubung literal kecuali ada). Kutip hanya dihormati sebagai grup frasa seimbang eksplisit; `"` yang tidak seimbang dihilangkan dan token di-AND-kan. `*` dari pengguna dihapus (`*` selalu milik kita — mencegah injeksi operator FTS arbitrer). |
| **Konten CJK / campuran latin**                                                        | `unicode61`: rangkaian CJK adalah satu token; prefiks per-istilah `数*` tetap cocok. Tanpa segmentasi CJK (tidak seperti trigram). Dapat diterima untuk v1; eskalasi yang didokumentasikan: evaluasi `trigram` jika recall CJK terukur tidak memadai (indeks tumbuh ~2×).                                                                                                                                                                                        |
| **`title` / `tags` NULL**                                                              | Diizinkan — tidak menghasilkan token, entri rowid tetap ada (trigger INSERT meneruskan NULL; `content` adalah NOT NULL).                                                                                                                                                                                                                                                                                                                                         |
| **Array JSON `tags`**                                                                  | Di-tokenisasi menjadi token tag individual (`unicode61` memperlakukan `[",:]` sebagai pemisah). Digunakan untuk kecocokan teks bebas; filter tag dashboard sengaja tetap di `m.tags LIKE` (§5.3).                                                                                                                                                                                                                                                                |
| **Baris diarsipkan / kedaluwarsa**                                                     | Tetap diindeks (trigger UPDATE mengindeks ulang), dikecualikan oleh predikat join — tanpa filter di sisi FTS, sehingga reaktivasi tidak memerlukan pengindeksan ulang.                                                                                                                                                                                                                                                                                           |
| **Error FTS saat runtime** (MATCH salah format, tabel hilang)                          | Catch gaya `tryFtsSearch` → fallback LIKE (`codebase-symbol.ts:155-215` membuktikan pola ini). Tidak ada kegagalan keras pada alat.                                                                                                                                                                                                                                                                                                                              |

## 8. Rencana Rollback

Data FTS bersifat **turunan** — tidak ada yang tahan lama yang hilang karena penghapusan; tabel `memories` adalah sumber kebenaran.

1. **Kode**: fallback LIKE permanen secara desain (persis seperti `codebase-symbol.ts:77-78`). Membalik = menghapus cabang jalur-cepat FTS dari `searchByRepo`/`listMemoriesForDashboard` dan skor kata kunci bm25 dari `memory.read.ts` (kembali ke `vectorScoreMap`).
2. **Basis data** (skrip manual — tidak perlu migrasi tambahan karena tabel yang dirilis adalah v10):

```sql
DROP TRIGGER IF EXISTS memories_ai;
DROP TRIGGER IF EXISTS memories_ad;
DROP TRIGGER IF EXISTS memories_au;
DROP TABLE IF EXISTS memories_fts;
```

3. **Urutan**: drop trigger lebih dulu, lalu tabel (menghindari kasus tepi FK/trigger yang menggantung). Tidak perlu backfill terbalik. Jika revert parsial diinginkan (kueri tetap berfungsi tetapi FTS dihapus), langkah 2 saja sudah cukup — semua jalur kueri otomatis jatuh ke LIKE.
4. **Jalur pemulihan** (jika diaktifkan kembali nanti): jalankan ulang v8 (atau `INSERT INTO memories_fts(memories_fts) VALUES('rebuild')` pada tabel kosong yang ada).

## 9. Rencana Bertahap

| Fase                                               | Pekerjaan                                                                                                                                    | Kriteria penerimaan                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1 — Migrasi** ✅ dirilis (v10)                  | Tambahkan entri v10 (diusulkan v8): buat `memories_fts` + 3 trigger + backfill (guard/log `SELECT COUNT`).                                   | (a) DB baru: migrasi ke v10 dengan bersih; jumlah `memories_fts` == jumlah `memories`. (b) DB v7 yang ada di-upgrade di tempat; migrasi dilewati pada run kedua (idempoten). (c) Round-trip: insert → baris di FTS; update title → token lama hilang, yang baru ada; delete → baris dihapus. (d) Belum ada pengalihan LIKE — nol perubahan perilaku. |
| **P2 — Integritas backfill & utilitas rebuild** ✅ | Verifikasi paritas: untuk kueri sampel, himpunan kandidat FTS ⊇ hasil LIKE pada kecocokan awal-token; dokumentasikan penggunaan `'rebuild'`. | Paritas `SELECT COUNT(*)`; spot-check recall awal-token vs LIKE; rebuild mereproduksi indeks identik (hash dari himpunan rowid).                                                                                                                                                                                                                     |
| **P3 — Pengalihan kueri** ✅                       | Tambahkan `buildFtsMatchQuery`; alihkan `searchByRepo` + `listMemoriesForDashboard` dengan fallback LIKE.                                    | Test yang ada lulus: `sqlite.test.ts:225-241` (kedaluwarsa dikecualikan), `agent-context.test.ts:123`, `tasks.bulk.test.ts:488`; daftar dashboard mempertahankan filter + sort yang di-allowlist; jalur kueri-kosong tidak tersentuh; kueri karakter khusus jatuh dengan anggun.                                                                     |
| **P4 — Integrasi hibrida** ✅                      | Skor kata kunci FTS (bm25 min-max) menggantikan skor vektor dalam bobot kata kunci 0.30; hit khusus-FTS digabung sebagai kandidat tambahan.  | Pencarian `memory.read.ts` mengembalikan hasil dengan komponen kata kunci ≠ 0 untuk hit leksikal; kegagalan FTS → fallback error yang ada; bobot SPEC-001 tidak berubah; paritas `memory.search.test.ts` / `e2e.e2e.test.ts:35`.                                                                                                                     |
| **P5 — Pengerasan & dok rollback** 🔜 NEXT PHASE   | Opsional evaluasi `trigram` (ukur recall/`EXPLAIN QUERY PLAN` pada kueri lambat), dokumentasikan SQL rollback di header file migrasi.        | Skrip rollback diverifikasi terhadap DB snapshot; perbandingan performa (LIKE vs FTS) dicatat di komentar task. — **belum diimplementasikan, ditunda**.                                                                                                                                                                                              |

> **Status bertahap:** P1–P4 dirilis dan terverifikasi di `src/` (migrasi v10, `utils/fts.ts`, `entities/memory/search.ts`, `tools/memory.read.ts`). P5 (evaluasi tokenizer trigram + dokumentasi rollback) adalah **NEXT PHASE** — belum diimplementasikan.

**Jejak bukti** (ref baris `migrations.ts` historis — file sejak itu dipecah menjadi `storage/migrations/index.ts` + modul `vNN-*.ts`): `migrations.ts:330-350` (FTS+trigger simbol, kini `v01`), `migrations.ts:672-706` (FTS+trigger+backfill standar, kini `v04`), `migrations.ts:760-776` (drop lama — keamanan nama trigger, kini `v01-helpers`), `migrations.ts:1019-1022` (transaksi per-migrasi, kini `index.ts`), `codebase-symbol.ts:69-256` (pola FTS-first/fallback LIKE + `sanitizeFtsTerm`), `entity.ts:173-191, 404-496` (target pengalihan, kini `entities/memory/search.ts`), `memory.read.ts:49-54, 105-247` (hibrida), `standard-read/search.ts:229-305` (cermin skor kata kunci), `sqlite.ts:75-92` (pragma + bootstrap migrasi), `write-lock.ts` (semantik kunci).

## 10. Artefak terkait

- Memori keputusan: `MEM-367` (desain pencarian memori FTS5)
- Task implementasi: `TASK-014` (Implementasi pencarian memori FTS5 sesuai desain TASK-003)
