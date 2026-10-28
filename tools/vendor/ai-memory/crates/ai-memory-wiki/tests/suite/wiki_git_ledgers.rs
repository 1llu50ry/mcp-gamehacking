//! The raw hook event ledgers must stay out of the wiki's git history.
//!
//! Every checkpoint used to stage every changed file, so each hook append to a
//! `log-YYYY-MM.md` of hundreds of megabytes wrote a new whole-file blob, and
//! nothing ever packed them: one install's `wiki/.git` reached 3.49 GB. A
//! ledger is recognized by name *and* content (an ordinary page can be named
//! `log-2026-09.md` and must stay versioned), and the file itself is never
//! touched: only the git index entry goes.

use std::path::{Path, PathBuf};

use ai_memory_core::{PagePath, ProjectId, WorkspaceId};
use ai_memory_store::Store;
use ai_memory_wiki::Wiki;
use git2::{ObjectType, Oid, Repository, Signature, Time};
use tempfile::TempDir;

const LEDGER: &str = "log-2026-09.md";

/// A ledger line exactly as the hooks append it.
fn ledger_line(n: usize) -> String {
    format!(
        "## [2026-09-05T00:00:{:02}Z] tool Bash: cargo test\n",
        n % 60
    )
}

/// The same ledger after the OKF v0.2 migration stamped frontmatter on it.
fn conformed_ledger() -> String {
    format!(
        "---\ntype: Note\ntitle: Log 2026-09\n---\n\n{}",
        ledger_line(0)
    )
}

/// An ordinary page that merely wears the ledger's filename.
const PROSE: &str =
    "# Log 2026-09\n\nA hand-written page that happens to be named like the ledger.\n";

struct Fixture {
    _tmp: TempDir,
    _store: Store,
    wiki: Wiki,
    ws: WorkspaceId,
    proj: ProjectId,
}

async fn fixture() -> Fixture {
    let tmp = TempDir::new().unwrap();
    let store = Store::open(tmp.path()).unwrap();
    let ws = store
        .writer
        .get_or_create_workspace("default")
        .await
        .unwrap();
    let proj = store
        .writer
        .get_or_create_project(ws, "scratch", None)
        .await
        .unwrap();
    let wiki = Wiki::new(tmp.path(), store.writer.clone())
        .unwrap()
        .with_store_reader(store.reader.clone());
    Fixture {
        _tmp: tmp,
        _store: store,
        wiki,
        ws,
        proj,
    }
}

impl Fixture {
    fn root(&self) -> &Path {
        self.wiki.git().root()
    }

    /// Path of `name` inside the project, as git names it.
    fn rel(&self, name: &str) -> PathBuf {
        PathBuf::from(format!("{}/{}/{name}", self.ws, self.proj))
    }

    /// Append through the hook ledger's own entry point, which reports the
    /// write to the next checkpoint.
    fn append(&self, name: &str, text: &str) -> PathBuf {
        self.wiki
            .append_under_project(self.ws, self.proj, name, text.as_bytes())
            .unwrap()
    }

    /// Write a page the way the adapter's callers do, reporting the path.
    fn write_page(&self, name: &str, text: &str) -> PathBuf {
        let path = PagePath::new(name).unwrap();
        let abs = self.wiki.abs_path(self.ws, self.proj, &path);
        self.wiki.git().write_atomic(&abs, text.as_bytes()).unwrap();
        abs
    }

    fn commit(&self, message: &str) -> Oid {
        self.wiki
            .commit_all(message)
            .unwrap()
            .expect("the checkpoint had something to commit")
    }

    /// What an earlier version did: put the file in a commit of its own, behind
    /// the adapter's back. The signature is fixed and libgit2 never signs, so a
    /// contributor's global `commit.gpgsign` cannot reach the fixture.
    fn commit_tracking(&self, rel: &Path) {
        let repo = Repository::open(self.root()).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(rel).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::new("fixture", "fixture@local", &Time::new(0, 0)).unwrap();
        let parents: Vec<_> = repo
            .head()
            .ok()
            .and_then(|h| h.target())
            .map(|oid| repo.find_commit(oid).unwrap())
            .into_iter()
            .collect();
        let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "fixture: ledger tracked by an earlier version",
            &tree,
            &parent_refs,
        )
        .unwrap();
    }

    /// The file's content in HEAD's tree, `None` when HEAD does not name it.
    fn at_head(&self, rel: &Path) -> Option<Vec<u8>> {
        let repo = Repository::open(self.root()).unwrap();
        let tree = repo.head().unwrap().peel_to_tree().unwrap();
        let entry = tree.get_path(rel).ok()?;
        Some(repo.find_blob(entry.id()).unwrap().content().to_vec())
    }

    /// Whether a blob with exactly this content exists anywhere in the object
    /// database, loose or packed: the cost the fix is about.
    fn blob_stored(&self, bytes: &[u8]) -> bool {
        let repo = Repository::open(self.root()).unwrap();
        let oid = Oid::hash_object(ObjectType::Blob, bytes).unwrap();
        repo.odb().unwrap().exists(oid)
    }
}

#[tokio::test]
async fn a_checkpoint_after_a_ledger_append_does_not_commit_the_ledger() {
    let fx = fixture().await;
    fx.write_page("notes/a.md", "first\n");
    let abs = fx.append(LEDGER, &ledger_line(0));

    // The first checkpoint walks the whole tree.
    fx.commit("walk");
    assert!(
        fx.at_head(&fx.rel("notes/a.md")).is_some(),
        "control: the page is committed"
    );
    assert!(
        fx.at_head(&fx.rel(LEDGER)).is_none(),
        "the walk staged the ledger"
    );
    assert!(
        !fx.blob_stored(ledger_line(0).as_bytes()),
        "the ledger was read into a blob even though it was left out of the tree"
    );

    // The next one stages only the reported paths.
    let grown = format!("{}{}", ledger_line(0), ledger_line(1));
    fx.append(LEDGER, &ledger_line(1));
    fx.write_page("notes/a.md", "second\n");
    fx.commit("paths");
    assert_eq!(fx.at_head(&fx.rel("notes/a.md")).unwrap(), b"second\n");
    assert!(
        fx.at_head(&fx.rel(LEDGER)).is_none(),
        "a reported ledger append was staged"
    );
    assert!(!fx.blob_stored(grown.as_bytes()));
    assert_eq!(
        std::fs::read_to_string(abs).unwrap(),
        grown,
        "the ledger on disk is the hooks' file, untouched"
    );
}

#[tokio::test]
async fn a_ledger_alone_leaves_nothing_to_commit() {
    let fx = fixture().await;
    fx.write_page("notes/a.md", "first\n");
    fx.commit("walk");

    fx.append(LEDGER, &ledger_line(0));

    assert!(
        fx.wiki.commit_all("ledger only").unwrap().is_none(),
        "a hook append alone must not produce a checkpoint"
    );
}

#[tokio::test]
async fn every_shape_of_ledger_is_left_out() {
    let fx = fixture().await;
    fx.write_page("notes/a.md", "first\n");
    fx.append("log.md", &ledger_line(0));
    fx.append("log-2026-08.md", &conformed_ledger());
    fx.append(LEDGER, &ledger_line(0));

    fx.commit("walk");

    for name in ["log.md", "log-2026-08.md", LEDGER] {
        assert!(fx.at_head(&fx.rel(name)).is_none(), "{name} was committed");
    }
}

#[tokio::test]
async fn a_ledger_an_earlier_version_committed_leaves_the_index_but_not_the_disk() {
    let fx = fixture().await;
    let abs = fx.append(LEDGER, &ledger_line(0));
    fx.commit_tracking(&fx.rel(LEDGER));
    let old = ledger_line(0);
    assert_eq!(fx.at_head(&fx.rel(LEDGER)).unwrap(), old.as_bytes());

    // It keeps growing, as it does in production.
    fx.append(LEDGER, &ledger_line(1));
    let grown = format!("{old}{}", ledger_line(1));
    fx.write_page("notes/a.md", "first\n");
    fx.commit("after upgrade");

    assert!(
        fx.at_head(&fx.rel(LEDGER)).is_none(),
        "the tracked ledger is still in the tree"
    );
    assert!(fx.at_head(&fx.rel("notes/a.md")).is_some());
    assert_eq!(
        std::fs::read_to_string(abs).unwrap(),
        grown,
        "dropping it from the index must not delete or alter the file"
    );
    assert!(
        !fx.blob_stored(grown.as_bytes()),
        "the grown ledger was hashed into git"
    );
}

/// A closed month nobody appends to is not offered to the staging walk (its
/// stat data is unchanged), so only a scan of the index can untrack it.
#[tokio::test]
async fn an_unchanged_tracked_ledger_is_untracked_too() {
    let fx = fixture().await;
    let abs = fx.append("log-2026-07.md", &ledger_line(0));
    fx.commit_tracking(&fx.rel("log-2026-07.md"));

    fx.write_page("notes/a.md", "first\n");
    fx.commit("after upgrade");

    assert!(fx.at_head(&fx.rel("log-2026-07.md")).is_none());
    assert_eq!(std::fs::read_to_string(abs).unwrap(), ledger_line(0));
}

/// Adversarial control: the name alone must never keep a page out of git.
#[tokio::test]
async fn a_page_wearing_a_ledgers_name_is_still_committed() {
    let fx = fixture().await;
    fx.append(LEDGER, PROSE);
    fx.append("log.md", "# Log\n\nNot a hook ledger either.\n");
    fx.append(
        "log-2026-08.md",
        "---\ntitle: Notes\n---\n\nprose, not a log entry\n",
    );

    fx.commit("walk");
    assert_eq!(
        fx.at_head(&fx.rel(LEDGER)).unwrap(),
        PROSE.as_bytes(),
        "an ordinary page named like a ledger was dropped from git"
    );
    assert!(fx.at_head(&fx.rel("log.md")).is_some());
    assert!(fx.at_head(&fx.rel("log-2026-08.md")).is_some());

    // And its edits keep being versioned through the path-scoped checkpoint.
    let edited = format!("{PROSE}\nMore.\n");
    fx.append(LEDGER, "\nMore.\n");
    fx.commit("paths");
    assert_eq!(fx.at_head(&fx.rel(LEDGER)).unwrap(), edited.as_bytes());
}

/// The other half of the gate: a ledger body under a name that is not a ledger
/// filename is an ordinary file.
#[tokio::test]
async fn ledger_content_under_another_name_is_still_committed() {
    let fx = fixture().await;
    fx.append("log-2026-09-15.md", &ledger_line(0));
    fx.append("notes.md", &ledger_line(0));

    fx.commit("walk");

    assert!(fx.at_head(&fx.rel("log-2026-09-15.md")).is_some());
    assert!(fx.at_head(&fx.rel("notes.md")).is_some());
}

/// A directory named like a ledger is a directory: its files are pages like
/// any other.
#[tokio::test]
async fn a_directory_named_like_a_ledger_keeps_its_files_versioned() {
    let fx = fixture().await;
    fx.write_page("log.md/inner.md", "inside\n");

    fx.commit("walk");

    assert_eq!(fx.at_head(&fx.rel("log.md/inner.md")).unwrap(), b"inside\n");
}

#[tokio::test]
async fn restoring_a_page_from_a_checkpoint_still_works_beside_a_ledger() {
    let fx = fixture().await;
    let path = PagePath::new("sessions/restored.md").unwrap();
    fx.write_page(path.as_str(), "---\ntitle: Restored\n---\nold");
    fx.append(LEDGER, &ledger_line(0));
    let rev = fx.commit("checkpoint").to_string();

    fx.write_page(path.as_str(), "---\ntitle: Restored\n---\nnew");
    fx.append(LEDGER, &ledger_line(1));
    fx.commit("later");
    assert_eq!(fx.wiki.git().recent_checkpoints(10).unwrap().len(), 2);

    fx.wiki
        .restore_page_from_checkpoint(fx.ws, fx.proj, path.clone(), &rev)
        .await
        .unwrap();

    let md = fx.wiki.read_page(fx.ws, fx.proj, &path).unwrap();
    assert_eq!(md.body.trim(), "old");
}
