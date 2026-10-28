//! Subprocess tests for `.ai-memory.toml` scope resolution in client commands.
//!
//! The unit tests in `commands::tests` cover the precedence table directly.
//! What needs a real process is the env-var wiring — `AI_MEMORY_IGNORE_MARKER`
//! is read from the process environment, and `$HOME` bounds the marker walk,
//! so both have to be set before the binary starts.
//!
//! Search tests use an unreachable server to inspect the resolution notice.
//! Mutation tests use a local HTTP stub to inspect the scope sent on the wire.

use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_ai-memory")
}

/// The tempdir's real path. `TempDir` hands back `/var/folders/…` on macOS
/// while the child's `getcwd()` reports the resolved `/private/var/folders/…`
/// — without canonicalising, `$HOME` never equals any directory the walk
/// visits and the marker search escapes all the way to `/`.
fn real_path(dir: &TempDir) -> PathBuf {
    dir.path().canonicalize().expect("canonicalising tempdir")
}

/// Run `search` from `cwd` with a deliberately dead server and return stderr.
///
/// `$HOME` is pinned to `cwd` so the marker walk cannot reach the developer's
/// real `~/.ai-memory.toml`, and the data dir is redirected for the same
/// reason — neither test should read or write the machine's actual install.
fn search_stderr(cwd: &Path, data_dir: &Path, extra_env: &[(&str, &str)], args: &[&str]) -> String {
    let mut cmd = Command::new(bin());
    cmd.arg("search")
        .arg("anything")
        .args(args)
        .current_dir(cwd)
        .env("HOME", cwd)
        .env("AI_MEMORY_DATA_DIR", data_dir)
        // A dead endpoint: the command resolves its scope, prints the notice,
        // then fails on connect.
        .env(
            "AI_MEMORY_SERVER_URL",
            ai_memory_test_support::dead_http_endpoint(),
        )
        // `AI_MEMORY_HOME` outranks `$HOME` in `path_util::home_dir`, so an
        // exported one on the developer's machine would unpin the walk.
        .env_remove("AI_MEMORY_HOME")
        .env_remove("AI_MEMORY_HOST_CWD")
        .env_remove("AI_MEMORY_SCOPE_CWD")
        .env_remove("AI_MEMORY_IGNORE_MARKER")
        .env_remove("AI_MEMORY_PROJECT_STRATEGY");
    for (key, value) in extra_env {
        cmd.env(key, value);
    }
    let output = cmd.output().expect("running ai-memory search");
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn marker_tree(body: &str) -> (TempDir, TempDir) {
    let cwd = TempDir::new().expect("tempdir for cwd");
    let data = TempDir::new().expect("tempdir for data dir");
    std::fs::write(cwd.path().join(".ai-memory.toml"), body).expect("writing marker");
    (cwd, data)
}

#[test]
fn marker_workspace_is_used_and_announced() {
    let (cwd, data) = marker_tree("workspace = \"acme\"\n");

    let stderr = search_stderr(&real_path(&cwd), &real_path(&data), &[], &[]);

    assert!(
        stderr.contains("scope acme/"),
        "the resolved scope must come from the marker and be announced: {stderr}"
    );
    assert!(
        stderr.contains(".ai-memory.toml"),
        "the notice names the marker that decided it: {stderr}"
    );
    assert!(
        stderr.contains("workspace + project from"),
        "a workspace-only marker also selects hook-compatible basename(cwd): {stderr}"
    );
}

#[test]
fn ignore_marker_env_restores_the_default_workspace() {
    let (cwd, data) = marker_tree("workspace = \"acme\"\n");

    let stderr = search_stderr(
        &real_path(&cwd),
        &real_path(&data),
        &[("AI_MEMORY_IGNORE_MARKER", "1")],
        &[],
    );

    assert!(
        !stderr.contains("scope acme/"),
        "AI_MEMORY_IGNORE_MARKER=1 must skip the marker entirely: {stderr}"
    );
}

/// `search --global` spans every project, so it resolves no scope: the
/// marker that `marker_workspace_is_used_and_announced` sees from the same
/// tree is never read, and no scope notice is printed (#1253).
#[test]
fn global_search_resolves_no_scope() {
    let (cwd, data) = marker_tree("workspace = \"acme\"\n");

    let stderr = search_stderr(&real_path(&cwd), &real_path(&data), &[], &["--global"]);

    assert!(
        !stderr.contains("scope acme/") && !stderr.contains(".ai-memory.toml"),
        "a global search must not resolve or announce a scope: {stderr}"
    );
}

#[test]
fn explicit_workspace_flag_beats_the_marker() {
    let (cwd, data) = marker_tree("workspace = \"acme\"\n");

    let stderr = search_stderr(
        &real_path(&cwd),
        &real_path(&data),
        &[],
        &["--workspace", "default"],
    );

    assert!(
        !stderr.contains("scope acme/"),
        "an explicit --workspace wins, so no marker notice: {stderr}"
    );
}

#[test]
fn a_tree_without_a_marker_is_unchanged() {
    let cwd = TempDir::new().expect("tempdir for cwd");
    let data = TempDir::new().expect("tempdir for data dir");

    let stderr = search_stderr(&real_path(&cwd), &real_path(&data), &[], &[]);

    assert!(
        !stderr.contains("ai-memory: scope "),
        "no marker means no scope notice and no behaviour change: {stderr}"
    );
}

#[test]
fn mounted_scope_cwd_reads_marker_while_host_cwd_keeps_project_identity() {
    let root = TempDir::new().expect("scope root");
    let data = TempDir::new().expect("data dir");
    std::fs::write(
        root.path().join(".ai-memory.toml"),
        "workspace = \"acme\"\n",
    )
    .unwrap();
    let mounted_cwd = root.path().join("crates/cli");
    std::fs::create_dir_all(&mounted_cwd).unwrap();
    let mounted_cwd = mounted_cwd.canonicalize().unwrap();
    let root = real_path(&root);
    let data = real_path(&data);
    let stderr = search_stderr(
        &mounted_cwd,
        &data,
        &[
            ("AI_MEMORY_HOST_CWD", "/host/repo/crates/cli"),
            ("AI_MEMORY_SCOPE_CWD", mounted_cwd.to_str().unwrap()),
            ("HOME", root.to_str().unwrap()),
        ],
        &[],
    );

    assert!(
        stderr.contains("scope acme/cli"),
        "lookup must use the mounted path and naming must use host cwd: {stderr}"
    );
}

/// An explicitly empty scope in a restore script must not silently target
/// the same page path in the checkout's project.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restore_page_refuses_empty_scope_flags_without_sending_a_mutation() {
    let (cwd, data) = marker_tree("workspace = \"checkout-ws\"\nproject = \"checkout-project\"\n");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::<serde_json::Value>::new()));
    let seen = requests.clone();
    let app = axum::Router::new().route(
        "/admin/restore-page",
        axum::routing::post(move |axum::Json(body): axum::Json<serde_json::Value>| {
            seen.lock().unwrap().push(body);
            async {
                axum::Json(serde_json::json!({
                    "page_id": "0193e7a1-0000-7000-8000-000000000001",
                    "path": "notes/shared.md",
                    "restored_from": "HEAD~1"
                }))
            }
        }),
    );
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let restore = |args: &[&str]| {
        crate::e2e_support::hermetic(bin())
            .args([
                "restore-page",
                "--path",
                "notes/shared.md",
                "--from",
                "HEAD~1",
            ])
            .args(args)
            .current_dir(real_path(&cwd))
            .env("HOME", real_path(&cwd))
            .env("AI_MEMORY_DATA_DIR", real_path(&data))
            .env("AI_MEMORY_SERVER_URL", &base)
            .output()
            .expect("running ai-memory restore-page")
    };

    for flag in ["--workspace", "--project"] {
        for empty in ["", " \t "] {
            let output = restore(&[flag, empty]);
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert!(
                !output.status.success(),
                "{flag} {empty:?} restored a page instead of refusing; requests: {:?}",
                requests.lock().unwrap()
            );
            assert!(
                stderr.contains(&format!("{flag} was passed empty")),
                "{stderr}"
            );
            assert!(
                requests.lock().unwrap().is_empty(),
                "an invalid scope reached the server"
            );
        }
    }

    // Omitting scope still intentionally restores in the checkout's project;
    // naming it explicitly still overrides the marker.
    for (args, workspace, project) in [
        (vec![], "checkout-ws", "checkout-project"),
        (
            vec!["--workspace", "named-ws"],
            "named-ws",
            "checkout-project",
        ),
        (
            vec!["--project", "named-project"],
            "checkout-ws",
            "named-project",
        ),
        (
            vec!["--workspace", "named-ws", "--project", "named-project"],
            "named-ws",
            "named-project",
        ),
    ] {
        let output = restore(&args);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let request = requests.lock().unwrap().pop().unwrap();
        assert_eq!(request["workspace"], workspace);
        assert_eq!(request["project"], project);
        assert_eq!(request["path"], "notes/shared.md");
        assert_eq!(request["rev"], "HEAD~1");
    }
    server.abort();
}
