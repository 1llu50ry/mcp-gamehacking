//! On Windows the canonical data dir carries a `\\?\` verbatim prefix. `init`
//! and `auth` print paths under it in their output and errors, and an operator
//! copies them from there into `cmd` or a script, which cannot use that form.

#![cfg(windows)]

use std::process::Output;

use crate::e2e_support::hermetic;

const BIN: &str = env!("CARGO_BIN_EXE_ai-memory");

fn run(data_dir: &std::path::Path, args: &[&str]) -> (Output, String) {
    let out = hermetic(BIN)
        .arg("--data-dir")
        .arg(data_dir)
        .args(args)
        .output()
        .unwrap();
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    (out, text)
}

#[test]
fn init_and_auth_status_print_plain_paths() {
    let tmp = tempfile::tempdir().unwrap();
    let data_dir = tmp.path().join("data");
    for args in [&["init"][..], &["auth", "status"]] {
        let (out, text) = run(&data_dir, args);
        assert!(out.status.success(), "{args:?} failed:\n{text}");
        assert!(text.contains(r":\"), "{args:?} printed no path:\n{text}");
        assert!(
            !text.contains(r"\\?\"),
            "{args:?} printed a verbatim path:\n{text}"
        );
    }
}

#[test]
fn init_error_names_a_plain_path() {
    let tmp = tempfile::tempdir().unwrap();
    // A file where the data dir's parent should be: the parent canonicalises,
    // so the data dir keeps the prefix, and creating it fails.
    let blocker = tmp.path().join("not-a-dir");
    std::fs::write(&blocker, b"").unwrap();
    let (out, text) = run(&blocker.join("data"), &["init"]);
    assert!(
        !out.status.success(),
        "init succeeded under a file:\n{text}"
    );
    assert!(
        text.contains("creating data root"),
        "unexpected error:\n{text}"
    );
    assert!(
        !text.contains(r"\\?\"),
        "init error printed a verbatim path:\n{text}"
    );
}
