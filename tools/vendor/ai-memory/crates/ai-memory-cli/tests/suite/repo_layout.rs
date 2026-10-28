//! Repository layout rules that cargo does not enforce on its own.

use std::fs;
use std::path::{Path, PathBuf};

fn crates_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate lives under crates/")
        .to_path_buf()
}

/// Every test binary is a link and, on macOS and Windows, a first-run malware
/// scan, so each crate gets at most one. Integration tests live in
/// `tests/suite/` and are compiled either into the lib's own harness (entry
/// `mod.rs`, included from `src/lib.rs`) or, only where they must drive the
/// built executable, into a single `suite` target (entry `main.rs`). Cargo
/// compiles a sibling file only if the entry declares it, so an undeclared
/// file's tests silently never run, and a top-level `tests/*.rs` quietly
/// becomes a binary of its own.
#[test]
fn integration_tests_cost_at_most_one_binary_per_crate() {
    let mut problems = Vec::new();
    let crate_dirs = fs::read_dir(crates_dir())
        .expect("read crates/")
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir());
    for crate_dir in crate_dirs {
        let tests_dir = crate_dir.join("tests");
        if !tests_dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&tests_dir).expect("read tests dir").flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().is_some_and(|ext| ext == "rs") {
                problems.push(format!(
                    "{} would build as its own test binary; move it into tests/suite/ and declare it there",
                    path.display()
                ));
            }
        }

        let suite_dir = tests_dir.join("suite");
        if !suite_dir.is_dir() {
            continue;
        }
        let main = suite_dir.join("main.rs");
        let module = suite_dir.join("mod.rs");
        let entry = match (main.is_file(), module.is_file()) {
            (true, false) => main,
            (false, true) => {
                let lib = fs::read_to_string(crate_dir.join("src/lib.rs")).unwrap_or_default();
                if !lib.contains("#[path = \"../tests/suite/mod.rs\"]") {
                    problems.push(format!(
                        "{} exists but src/lib.rs never includes it, so none of its tests run",
                        module.display()
                    ));
                }
                module
            }
            (true, true) => {
                problems.push(format!(
                    "{} has both main.rs and mod.rs; pick one entry",
                    suite_dir.display()
                ));
                continue;
            }
            (false, false) => {
                problems.push(format!(
                    "{} has no main.rs or mod.rs entry",
                    suite_dir.display()
                ));
                continue;
            }
        };
        let declared = fs::read_to_string(&entry).expect("read suite entry");
        for sibling in fs::read_dir(&suite_dir).expect("read suite dir").flatten() {
            let path = sibling.path();
            if path.extension().is_none_or(|ext| ext != "rs") {
                continue;
            }
            let stem = path.file_stem().unwrap_or_default().to_string_lossy();
            if stem == "main" || stem == "mod" {
                continue;
            }
            let is_declared = declared
                .lines()
                .any(|line| line == format!("mod {stem};") || line == format!("pub mod {stem};"));
            if !is_declared {
                problems.push(format!(
                    "{} is not declared in {} (add `mod {stem};`)",
                    path.display(),
                    entry.display()
                ));
            }
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

/// Every function a CodeQL model under `.github/codeql/extensions` names must
/// still exist where its path says. A renamed or moved function would leave
/// the model matching nothing, and the alerts it clears would silently return.
#[test]
fn codeql_model_targets_exist() {
    let repo_root = crates_dir()
        .parent()
        .expect("crates/ lives in the repository root")
        .to_path_buf();
    // Crate name in a model path -> that crate's source root.
    let crate_roots = [
        ("ai_memory_cli", crates_dir().join("ai-memory-cli/src")),
        (
            "ai_memory_importer",
            repo_root.join("companions/ai-memory-importer/src"),
        ),
        (
            "ai_memory_client",
            repo_root.join("companions/ai-memory-client/src"),
        ),
        ("ai_memory_wiki", crates_dir().join("ai-memory-wiki/src")),
    ];
    let models_dir = repo_root.join(".github/codeql/extensions/ai-memory-models/models");
    let mut targets = 0;
    let mut problems = Vec::new();
    for entry in fs::read_dir(&models_dir)
        .expect("read the CodeQL model dir")
        .flatten()
    {
        let text = fs::read_to_string(entry.path()).expect("read model file");
        for token in text.split('"') {
            let mut segments: Vec<&str> = token.split("::").collect();
            let Some((_, src)) = crate_roots
                .iter()
                .find(|(name, _)| segments.len() > 1 && segments[0] == *name)
            else {
                continue;
            };
            targets += 1;
            segments.remove(0);
            let function = segments.pop().expect("a path names a function");
            let module = segments.join("/");
            // A crate-root function lives in `lib.rs`; a module is either
            // `name.rs` or `name/mod.rs`.
            let candidates = if module.is_empty() {
                vec!["lib.rs".to_string()]
            } else {
                vec![format!("{module}.rs"), format!("{module}/mod.rs")]
            };
            let source = candidates
                .iter()
                .find_map(|file| fs::read_to_string(src.join(file)).ok())
                .unwrap_or_default();
            if !source.contains(&format!("fn {function}(")) {
                problems.push(format!(
                    "{token}: no `fn {function}(` in {}/{module}{{.rs,/mod.rs}}",
                    src.display()
                ));
            }
        }
    }
    assert!(targets > 0, "the model dir names no modeled function");
    assert!(
        problems.is_empty(),
        "stale CodeQL model targets:\n{}",
        problems.join("\n")
    );
}

/// Advanced CodeQL setup does not reliably auto-load repository-local model
/// packs. Keep the explicit Rust analysis path wired to the checked-in pack.
#[test]
fn codeql_workflow_loads_local_models() {
    let workflow = fs::read_to_string(
        crates_dir()
            .parent()
            .expect("crates/ lives in the repository root")
            .join(".github/workflows/codeql.yml"),
    )
    .expect("read CodeQL workflow");
    for required in [
        "skip-queries: ${{ matrix.language == 'rust' }}",
        "--additional-packs=.github/codeql/extensions",
        "--model-packs=akitaonrails/ai-memory-models",
        "--ram=\"$CODEQL_RAM\"",
        "--threads=\"$CODEQL_THREADS\"",
        "codeql/rust-queries:codeql-suites/rust-code-scanning.qls",
    ] {
        assert!(
            workflow.contains(required),
            "CodeQL workflow omitted {required}"
        );
    }
}
