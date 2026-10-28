//! Runner that applies pending wiki-structure migrations in order.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use ai_memory_store::{ReaderPool, WriterHandle};
use tracing::{error, info};

use super::WikiMigration;
use crate::error::{WikiError, WikiResult};

/// Read the set of already-applied migration names from the database.
async fn applied_names(reader: &ReaderPool) -> WikiResult<Vec<String>> {
    reader
        .wiki_migration_names()
        .await
        .map_err(WikiError::Store)
}

/// Record one migration as successfully applied.
async fn mark_applied(writer: &WriterHandle, name: &str) -> WikiResult<()> {
    let micros = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros() as i64)
        .unwrap_or(0);
    writer
        .insert_wiki_migration(name.to_owned(), micros)
        .await
        .map_err(WikiError::Store)
}

/// Run all pending wiki-structure migrations.
///
/// Reads the `wiki_migrations` table to determine which names from
/// `registry` have not yet been applied, then runs each pending
/// migration in registration order.
///
/// A migration that returns [`Err`] causes this function to bail
/// immediately. The failed migration's name is **not** inserted into
/// `wiki_migrations`, so the next server start will retry it.
///
/// # Errors
///
/// Returns the error from the first failing migration, or any database
/// error that prevents reading/writing the `wiki_migrations` table.
pub async fn run_pending(
    writer: &WriterHandle,
    reader: &ReaderPool,
    wiki_root: &Path,
    registry: &[Box<dyn WikiMigration>],
) -> WikiResult<()> {
    if registry.is_empty() {
        return Ok(());
    }

    let applied = applied_names(reader).await?;

    // Generation guard (docs/okf.md): a name in `wiki_migrations` that
    // this binary's registry does not know means the wiki was migrated
    // by a NEWER ai-memory. Opening it read-write with an older binary
    // would mix formats silently; refuse with the recovery options.
    let known: Vec<&str> = registry.iter().map(|m| m.name()).collect();
    if let Some(unknown) = applied.iter().find(|n| !known.contains(&n.as_str())) {
        return Err(WikiError::NewerWikiFormat {
            migration: unknown.clone(),
        });
    }

    for migration in registry {
        let name = migration.name();
        if applied.iter().any(|n| n == name) {
            continue;
        }

        info!(
            migration = name,
            description = migration.description(),
            "running wiki migration"
        );

        if let Err(e) = migration.up(writer, wiki_root).await {
            error!(
                migration = name,
                error = %e,
                "wiki migration failed — server cannot start until this is resolved"
            );
            return Err(e);
        }

        mark_applied(writer, name).await?;
        info!(migration = name, "applied wiki migration");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tempfile::TempDir;

    use super::*;
    use crate::error::WikiResult;
    use crate::migrations::WikiMigration;

    // ── helpers ──────────────────────────────────────────────────────────────

    fn open_store(dir: &TempDir) -> ai_memory_store::Store {
        ai_memory_store::Store::open(dir.path()).expect("store open")
    }

    // ── synthetic migrations ──────────────────────────────────────────────────

    struct CountingMigration {
        name: &'static str,
        run_count: Arc<Mutex<u32>>,
    }

    #[async_trait::async_trait]
    impl WikiMigration for CountingMigration {
        fn name(&self) -> &'static str {
            self.name
        }
        fn description(&self) -> &'static str {
            "counting migration for tests"
        }
        async fn up(&self, _writer: &WriterHandle, _wiki_root: &Path) -> WikiResult<()> {
            *self.run_count.lock().unwrap() += 1;
            Ok(())
        }
    }

    struct FailingMigration;

    #[async_trait::async_trait]
    impl WikiMigration for FailingMigration {
        fn name(&self) -> &'static str {
            "2026_01_01T00_00_failing"
        }
        fn description(&self) -> &'static str {
            "always fails"
        }
        async fn up(&self, _writer: &WriterHandle, _wiki_root: &Path) -> WikiResult<()> {
            Err(WikiError::Io(std::io::Error::other(
                "synthetic migration failure",
            )))
        }
    }

    // ── tests ─────────────────────────────────────────────────────────────────

    /// Empty registry → no-op, no rows inserted.
    #[tokio::test]
    async fn empty_registry_is_noop() {
        let dir = TempDir::new().unwrap();
        let store = open_store(&dir);
        let wiki_root = dir.path().join("wiki");
        std::fs::create_dir_all(&wiki_root).unwrap();

        let result = run_pending(&store.writer, &store.reader, &wiki_root, &[]).await;
        assert!(result.is_ok());

        let names = store.reader.wiki_migration_names().await.unwrap();
        assert!(names.is_empty());
    }

    /// Migration runs once; second call is a no-op.
    #[tokio::test]
    async fn runs_once_then_skips() {
        let dir = TempDir::new().unwrap();
        let store = open_store(&dir);
        let wiki_root = dir.path().join("wiki");
        std::fs::create_dir_all(&wiki_root).unwrap();

        let count = Arc::new(Mutex::new(0u32));
        let migration: Box<dyn WikiMigration> = Box::new(CountingMigration {
            name: "2026_01_01T00_00_counting",
            run_count: count.clone(),
        });
        let registry: Vec<Box<dyn WikiMigration>> = vec![migration];

        run_pending(&store.writer, &store.reader, &wiki_root, &registry)
            .await
            .unwrap();
        assert_eq!(*count.lock().unwrap(), 1, "ran once");

        // Rebuild registry (can't clone Box<dyn>) and run again.
        let migration2: Box<dyn WikiMigration> = Box::new(CountingMigration {
            name: "2026_01_01T00_00_counting",
            run_count: count.clone(),
        });
        let registry2: Vec<Box<dyn WikiMigration>> = vec![migration2];

        run_pending(&store.writer, &store.reader, &wiki_root, &registry2)
            .await
            .unwrap();
        assert_eq!(*count.lock().unwrap(), 1, "still one — not re-run");
    }

    /// Failing migration → Err returned, row NOT inserted, next call retries.
    #[tokio::test]
    async fn failing_migration_not_marked_applied() {
        let dir = TempDir::new().unwrap();
        let store = open_store(&dir);
        let wiki_root = dir.path().join("wiki");
        std::fs::create_dir_all(&wiki_root).unwrap();

        let registry: Vec<Box<dyn WikiMigration>> = vec![Box::new(FailingMigration)];

        let result = run_pending(&store.writer, &store.reader, &wiki_root, &registry).await;
        assert!(result.is_err(), "must propagate the error");

        let names = store.reader.wiki_migration_names().await.unwrap();
        assert!(
            names.is_empty(),
            "failed migration must not be marked applied"
        );

        // Re-run → still errors, still not applied.
        let registry2: Vec<Box<dyn WikiMigration>> = vec![Box::new(FailingMigration)];
        let result2 = run_pending(&store.writer, &store.reader, &wiki_root, &registry2).await;
        assert!(result2.is_err());
        let names2 = store.reader.wiki_migration_names().await.unwrap();
        assert!(names2.is_empty());
    }

    /// Two migrations in registry → both run in order.
    #[tokio::test]
    async fn two_migrations_run_in_order() {
        let dir = TempDir::new().unwrap();
        let store = open_store(&dir);
        let wiki_root = dir.path().join("wiki");
        std::fs::create_dir_all(&wiki_root).unwrap();

        let order: Arc<Mutex<Vec<&'static str>>> = Arc::new(Mutex::new(vec![]));

        struct OrderMigration {
            name: &'static str,
            log: Arc<Mutex<Vec<&'static str>>>,
        }

        #[async_trait::async_trait]
        impl WikiMigration for OrderMigration {
            fn name(&self) -> &'static str {
                self.name
            }
            fn description(&self) -> &'static str {
                "order test"
            }
            async fn up(&self, _writer: &WriterHandle, _wiki_root: &Path) -> WikiResult<()> {
                self.log.lock().unwrap().push(self.name);
                Ok(())
            }
        }

        let registry: Vec<Box<dyn WikiMigration>> = vec![
            Box::new(OrderMigration {
                name: "2026_01_01T00_00_first",
                log: order.clone(),
            }),
            Box::new(OrderMigration {
                name: "2026_01_01T00_01_second",
                log: order.clone(),
            }),
        ];

        run_pending(&store.writer, &store.reader, &wiki_root, &registry)
            .await
            .unwrap();

        let ran = order.lock().unwrap().clone();
        assert_eq!(
            ran,
            vec!["2026_01_01T00_00_first", "2026_01_01T00_01_second"],
            "must run in registration order"
        );

        // Both names persisted.
        let mut names = store.reader.wiki_migration_names().await.unwrap();
        names.sort();
        assert_eq!(names.len(), 2);
    }
}
