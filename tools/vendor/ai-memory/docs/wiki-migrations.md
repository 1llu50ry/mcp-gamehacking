# Wiki-structure migrations

SQL schema migrations are handled automatically by `refinery` at server
startup. This document covers the parallel mechanism for *filesystem-level*
changes to the wiki directory.

## When to write a wiki migration

Write a wiki migration any time a new version of ai-memory requires an
on-disk wiki directory that was created by an older version to be
restructured. Examples that require a migration:

- The path scheme changes (e.g. `<wiki_root>/<page>.md` → `<wiki_root>/<workspace>/<project>/<page>.md`).
- A directory is renamed, split, or merged.
- Every page of a certain kind gets a new required frontmatter field added.
- Log rotation changes the filename pattern for `log.md` backups.

Do **not** write a migration for changes that are purely additive and
backward-compatible (e.g. a new optional frontmatter field that defaults to
`null`).

## How to write a wiki migration

### 1. Create the migration file

Add a new file in `crates/ai-memory-wiki/src/migrations/`. Use the naming
convention:

```
m<YYYY>_<MM>_<DD>_<HH><MM>_<descriptive_name>.rs
```

For example: `m2026_06_01_1200_rename_logs_dir.rs`.

### 2. Implement the `WikiMigration` trait

```rust
use std::path::Path;
use ai_memory_store::WriterHandle;
use crate::error::WikiResult;
use crate::migrations::WikiMigration;

pub struct RenameLogs2026;

#[async_trait::async_trait]
impl WikiMigration for RenameLogs2026 {
    fn name(&self) -> &'static str {
        // Must be unique and sortable. Choose once and never change.
        "2026_06_01T12_00_rename_logs_dir"
    }

    fn description(&self) -> &'static str {
        "rename _logs/ to _log/ for consistency with log.md"
    }

    async fn up(&self, _writer: &WriterHandle, wiki_root: &Path) -> WikiResult<()> {
        let old = wiki_root.join("_logs");
        let new = wiki_root.join("_log");

        // Idempotency: if the work is already done, return Ok immediately.
        if !old.exists() {
            return Ok(());
        }

        std::fs::rename(&old, &new)?;
        Ok(())
    }
}
```

### 3. Register it

Open `crates/ai-memory-wiki/src/migrations/mod.rs` and append to the
`registry()` function:

```rust
pub fn registry() -> Vec<Box<dyn WikiMigration>> {
    vec![
        // existing entries...
        Box::new(super::m2026_06_01_1200_rename_logs_dir::RenameLogs2026),
    ]
}
```

Also add `mod m2026_06_01_1200_rename_logs_dir;` near the top of `mod.rs`.

**Never reorder or remove entries.** The runner uses the registration order
together with the `wiki_migrations` table.

### 4. Add a unit test

Every migration module must include a `#[cfg(test)]` block that:

- Exercises the migration against a `tempfile::TempDir`.
- Verifies the pre-condition (old layout present), post-condition (new layout
  present, old absent), and idempotency (running twice is a no-op).

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use ai_memory_store::Store;

    #[tokio::test]
    async fn renames_logs_dir() {
        let dir = TempDir::new().unwrap();
        let store = Store::open(dir.path()).unwrap();
        let wiki_root = dir.path().join("wiki");
        std::fs::create_dir_all(&wiki_root).unwrap();

        // Pre-condition.
        std::fs::create_dir(wiki_root.join("_logs")).unwrap();

        let m = RenameLogs2026;
        m.up(&store.writer, &wiki_root).await.unwrap();

        assert!(wiki_root.join("_log").exists());
        assert!(!wiki_root.join("_logs").exists());

        // Idempotent: running again does not error.
        m.up(&store.writer, &wiki_root).await.unwrap();
    }
}
```

## How NOT to write a migration

### No destructive deletes without a graveyard step

If a migration removes files (moves them), copy or move them to
`<wiki_root>/_graveyard/<migration_name>/<original_path>` first. This lets
operators recover accidentally-deleted data for at least one release cycle.

```rust
// BAD — data is gone forever on upgrade.
std::fs::remove_dir_all(wiki_root.join("_tmp"))?;

// GOOD — data lands in the graveyard, recoverable.
let graveyard = wiki_root.join("_graveyard").join(self.name());
std::fs::create_dir_all(&graveyard)?;
std::fs::rename(wiki_root.join("_tmp"), graveyard.join("_tmp"))?;
```

### No LLM calls

Migrations run on every server start. They must be fast and free. Any
transformation that requires a language model belongs in a one-time CLI
command or a consolidation job, not a migration.

### No direct SQL outside the writer actor

If a migration needs to update the SQLite index alongside the file moves, use
`WriterHandle` methods. Never open a second `Connection`; never call
`ops::*` directly from a migration. This upholds invariant #2 (single-writer
actor) from `AGENTS.md`.

## Tracking

Applied migrations are recorded in the `wiki_migrations` SQLite table:

```sql
SELECT name, datetime(applied_at / 1000000, 'unixepoch') AS applied
FROM wiki_migrations
ORDER BY name;
```

The table is created by `V06__wiki_migrations.sql` (a `refinery` migration
that runs before any wiki migrations). The server bails with a clear error
message if a migration fails; re-starting the server retries the failed
migration automatically.
