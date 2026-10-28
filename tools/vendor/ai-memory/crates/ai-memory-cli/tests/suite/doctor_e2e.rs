//! Use-case end-to-end test for `ai-memory doctor` (capture-coverage check).
//!
//! Doctor exists to make one silent failure visible: a harness that ran in this
//! project but has no ai-memory hook installed still writes its own local
//! session transcripts, yet nothing reaches the server. The operator believes
//! every harness feeds one memory and is quietly wrong (audit finding F1). For
//! the current project doctor enumerates each known harness's local native
//! sessions, asks the server how many it actually captured per agent
//! (`GET /admin/sessions/by-agent`), and warns — with the exact
//! `install-hooks --agent <agent> --apply` remediation — about any harness that
//! ran here recently but captured zero.
//!
//! The pure verdict logic (`build_rows`) and the local detector (`scan_local`)
//! are unit-tested in the command module. The UNTESTED half is the whole live
//! flow against a real server: does the shipped `doctor` subcommand, driven
//! exactly as an operator would, actually reconcile the local side against the
//! server's captured counts and print the right verdict? This drives that flow:
//!
//! 1. **Gap detected.** A planted Claude transcript for this cwd with an empty
//!    store (server captured zero) → doctor flags `claude-code` as uncaptured
//!    and prints its `install-hooks --agent claude-code --apply` fix.
//! 2. **Healthy control.** After `backfill` imports that same transcript through
//!    `/hook`, the server has captured sessions for `claude-code` → doctor no
//!    longer flags it, and reports every harness as captured. This control is
//!    what stops a blanket "everything is uncaptured" warning from passing #1
//!    for the wrong reason.
//!
//! Unix-gated: the fixture uses the POSIX-encoded `~/.claude/projects/<enc-cwd>/`
//! native layout (as the sibling `backfill_e2e` test and the `scan_local` unit
//! test do); cross-platform native-store discovery is owned by
//! `ai-memory-workstream`.

#![cfg(unix)]

/// Spawns a server and several subprocesses: seconds, not milliseconds, so this
/// lives in the slow tier (`cargo tf` / CI), not the everyday loop.
mod slow {
    use std::fs;
    use std::time::{Duration, Instant};

    use serde_json::{Value, json};

    use crate::e2e_support::{hermetic, run_cli, session_count, start_serve, write_jsonl};

    const BIN: &str = env!("CARGO_BIN_EXE_ai-memory");
    const WORKSPACE: &str = "doctor-e2e-ws";
    const PROJECT: &str = "doctor-e2e-proj";

    /// The row for one agent kind in a `doctor --json` report, or `None`.
    fn find_row<'a>(report: &'a Value, agent: &str) -> Option<&'a Value> {
        report["rows"]
            .as_array()?
            .iter()
            .find(|r| r["agent"] == agent)
    }

    #[tokio::test]
    async fn doctor_flags_an_uncaptured_harness_then_clears_it_after_backfill() {
        let data_dir = tempfile::tempdir().expect("data dir");
        let home = tempfile::tempdir().expect("home");
        let project = tempfile::tempdir().expect("project cwd");
        // The child's `std::env::current_dir()` returns the canonical path, and
        // the native-session discovery matches the transcript's `cwd` header
        // against it — so plant and encode with the same canonical path.
        let cwd = fs::canonicalize(project.path()).expect("canonicalize project cwd");

        // Plant a Claude transcript for this cwd under the native layout. This
        // makes `claude-code` a harness that "ran here recently" for doctor,
        // while the server starts with zero captured — the F1 gap.
        let session_id = "11111111-2222-3333-4444-555555555555";
        let encoded = cwd.to_string_lossy().replace('/', "-");
        let session_dir = home.path().join(".claude").join("projects").join(encoded);
        fs::create_dir_all(&session_dir).expect("session dir");
        write_jsonl(
            &session_dir.join(format!("{session_id}.jsonl")),
            &[
                json!({ "sessionId": session_id, "cwd": cwd.to_string_lossy() }),
                json!({
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": [{ "type": "text", "text": "Record the doctor-e2e decision." }],
                    },
                }),
                json!({
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [{ "type": "text", "text": "Acknowledged the doctor-e2e plan." }],
                    },
                }),
            ],
        );

        // Start the real server (loopback, no auth, hermetic: no embedder, no
        // wiki watcher — a machine-global inotify instance concurrent server
        // children can exhaust, #745).
        let client = reqwest::Client::new();
        let (server, base) = start_serve(&client, &data_dir.path().join("serve.log"), |port| {
            let mut cmd = hermetic(BIN);
            cmd.args([
                "serve",
                "--transport",
                "http",
                "--bind",
                &format!("127.0.0.1:{port}"),
                "--workspace",
                WORKSPACE,
                "--project",
                PROJECT,
                "--no-watcher",
            ])
            .env("AI_MEMORY_DATA_DIR", data_dir.path())
            .env("AI_MEMORY_HOME", home.path())
            .env("AI_MEMORY_EMBEDDING_PROVIDER", "none");
            cmd.current_dir(&cwd);
            cmd
        })
        .await;

        // Precondition: nothing captured yet for this scope.
        assert_eq!(
            session_count(&client, &base, WORKSPACE, PROJECT).await,
            0,
            "a brand-new project store must start with no captured sessions",
        );

        // Phase 1 — gap detected. `--since-days 0` makes every on-disk session
        // count as recent, so the planted transcript is unambiguously "recent".
        let report: Value = serde_json::from_str(&run_cli(
            &[
                "doctor",
                "--workspace",
                WORKSPACE,
                "--project",
                PROJECT,
                "--since-days",
                "0",
                "--json",
            ],
            data_dir.path(),
            home.path(),
            Some(&cwd),
            &base,
        ))
        .expect("doctor --json report");
        assert_eq!(report["capture_owner_active"], false);
        assert_eq!(report["identity"]["level"], "anonymous");
        assert_eq!(
            report["auth_posture"], "none_loopback",
            "an open loopback server is reported with the `auth enable` fix"
        );
        assert_eq!(report["project_coordinate"]["server"]["status"], "exact");
        assert_eq!(
            report["project_coordinate"]["server"]["requested_name"],
            PROJECT
        );
        assert_eq!(
            report["project_coordinate"]["local"]["marker_status"],
            "bypassed_explicit_scope"
        );
        assert_eq!(report["identity"]["version"], env!("CARGO_PKG_VERSION"));

        let claude = find_row(&report, "claude-code")
            .unwrap_or_else(|| panic!("expected a claude-code row: {report}"));
        assert_eq!(
            claude["uncaptured"], true,
            "a harness that ran here with zero captured must be flagged: {report}"
        );
        assert!(
            claude["local_recent"].as_u64().unwrap_or(0) >= 1,
            "the planted session must count as recent: {report}"
        );
        assert_eq!(
            claude["captured"], 0,
            "the server captured nothing for it yet: {report}"
        );
        assert_eq!(
            report["uncaptured"]
                .as_array()
                .map(|a| a.iter().any(|v| v == "claude-code")),
            Some(true),
            "claude-code must appear in the top-level uncaptured list: {report}"
        );

        // Phase 1 — the human-readable output prints the exact remediation the
        // operator is meant to run, naming the specific agent.
        let human = run_cli(
            &[
                "doctor",
                "--workspace",
                WORKSPACE,
                "--project",
                PROJECT,
                "--since-days",
                "0",
            ],
            data_dir.path(),
            home.path(),
            Some(&cwd),
            &base,
        );
        assert!(
            human.contains("ai-memory install-hooks --agent claude-code --apply"),
            "doctor must print the exact install-hooks remediation: {human}"
        );
        assert!(
            human.contains("ran here but nothing was captured"),
            "doctor must explain the gap in prose: {human}"
        );
        assert!(
            human.contains("project coordinate: exact"),
            "doctor must render the coordinate diagnosis: {human}"
        );

        // Import the local history through the same `/hook` ingress live capture
        // uses, so the server now has captured sessions for claude-code.
        let backfill: Value = serde_json::from_str(&run_cli(
            &[
                "backfill",
                "--workspace",
                WORKSPACE,
                "--project",
                PROJECT,
                "--json",
            ],
            data_dir.path(),
            home.path(),
            Some(&cwd),
            &base,
        ))
        .expect("backfill --json report");
        assert_eq!(
            backfill["imported_sessions"], 1,
            "backfill must import the one planted session: {backfill}"
        );

        // The captured count is now nonzero (poll briefly for commit lag).
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if session_count(&client, &base, WORKSPACE, PROJECT).await >= 1 {
                break;
            }
            assert!(Instant::now() < deadline, "captured session never appeared");
            tokio::time::sleep(Duration::from_millis(150)).await;
        }

        // Phase 2 — healthy control. The same harness with the same local
        // transcript is now captured, so doctor must NOT flag it.
        let report2: Value = serde_json::from_str(&run_cli(
            &[
                "doctor",
                "--workspace",
                WORKSPACE,
                "--project",
                PROJECT,
                "--since-days",
                "0",
                "--json",
            ],
            data_dir.path(),
            home.path(),
            Some(&cwd),
            &base,
        ))
        .expect("second doctor --json report");

        let claude2 = find_row(&report2, "claude-code")
            .unwrap_or_else(|| panic!("expected a claude-code row after backfill: {report2}"));
        assert_eq!(
            claude2["uncaptured"], false,
            "one captured session must clear the flag: {report2}"
        );
        assert!(
            claude2["captured"].as_u64().unwrap_or(0) >= 1,
            "the backfilled session must be counted as captured: {report2}"
        );
        assert_eq!(
            report2["uncaptured"]
                .as_array()
                .map(|a| a.iter().any(|v| v == "claude-code")),
            Some(false),
            "claude-code must no longer be in the uncaptured list: {report2}"
        );

        // Phase 2 — the human output no longer nags for claude-code's hook.
        let human2 = run_cli(
            &[
                "doctor",
                "--workspace",
                WORKSPACE,
                "--project",
                PROJECT,
                "--since-days",
                "0",
            ],
            data_dir.path(),
            home.path(),
            Some(&cwd),
            &base,
        );
        assert!(
            !human2.contains("install-hooks --agent claude-code --apply"),
            "a captured harness must not get an install-hooks nag: {human2}"
        );

        // Backfill uses canonical user events and its own namespace for
        // assistant events. Mixed provenance alone does not mean duplication.
        assert_eq!(claude2["mixed_capture_sessions"], 1);
        let diagnostic_session = "doctor-native-external-control";
        let native_ack: Value = client.post(format!("{base}/hook/batch"))
            .json(&json!([{
                "url": format!("/hook?event=user-prompt-submit&agent=claude-code&workspace={WORKSPACE}&project={PROJECT}&ingest_key=doctor-native-prompt-1"),
                "body": {"session_id":diagnostic_session,"cwd":cwd,"prompt":"Native capture control"}
            }]))
            .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
        assert_eq!(native_ack["accepted"], 1);
        let ack: Value = client.post(format!("{base}/hook/batch"))
            .json(&json!([{
                "url": format!("/hook?event=user-prompt-submit&agent=claude-code&workspace={WORKSPACE}&project={PROJECT}&extension=example.runtime&source_event=user-prompt-submit&ingest_key=doctor-external-prompt-1"),
                "body": {"session_id":diagnostic_session,"cwd":cwd,"prompt":"External capture control"}
            }]))
            .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
        assert_eq!(ack["accepted"], 1);

        let output = hermetic(BIN)
            .args([
                "doctor",
                "--workspace",
                WORKSPACE,
                "--project",
                PROJECT,
                "--since-days",
                "0",
                "--json",
            ])
            .env("AI_MEMORY_DATA_DIR", data_dir.path())
            .env("AI_MEMORY_HOME", home.path())
            .env("AI_MEMORY_SERVER_URL", &base)
            .env("AI_MEMORY_CAPTURE_OWNER", "example.runtime")
            .env("AI_MEMORY_EMBEDDING_PROVIDER", "none")
            .current_dir(&cwd)
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        let mixed: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(mixed["capture_owner_active"], true);
        assert_eq!(
            find_row(&mixed, "claude-code").unwrap()["mixed_capture_sessions"],
            2
        );
        assert!(!String::from_utf8_lossy(&output.stdout).contains("example.runtime"));

        let human3 = run_cli(
            &[
                "doctor",
                "--workspace",
                WORKSPACE,
                "--project",
                PROJECT,
                "--since-days",
                "0",
            ],
            data_dir.path(),
            home.path(),
            Some(&cwd),
            &base,
        );
        assert!(human3.contains("multiple capture sources"), "{human3}");
        assert!(
            human3.contains("does not prove duplicate capture"),
            "{human3}"
        );

        drop(server);
    }

    #[tokio::test]
    async fn invalid_home_routes_refuse_before_any_server_request_but_explicit_pair_bypasses() {
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };

        let data_dir = tempfile::tempdir().expect("data dir");
        let home = tempfile::tempdir().expect("home");
        let project = tempfile::tempdir().expect("project cwd");
        fs::write(
            home.path().join(".ai-memory.toml"),
            "workspace=\"fallback\"\nproject=\"fallback\"\n[routes.path.\"~/..\"]\nroute_workspace=\"bad\"\nroute_project=\"bad\"\n",
        )
        .unwrap();
        let requests = Arc::new(AtomicUsize::new(0));
        let seen = requests.clone();
        let app = axum::Router::new().fallback(move || {
            let seen = seen.clone();
            async move {
                seen.fetch_add(1, Ordering::SeqCst);
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "unexpected request",
                )
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let first_data_dir = data_dir.path().to_path_buf();
        let first_home = home.path().to_path_buf();
        let first_cwd = project.path().to_path_buf();
        let first_base = base.clone();
        let output = tokio::task::spawn_blocking(move || {
            hermetic(BIN)
                .args(["doctor", "--json"])
                .env("AI_MEMORY_DATA_DIR", first_data_dir)
                .env("AI_MEMORY_HOME", first_home)
                .env("AI_MEMORY_SERVER_URL", first_base)
                .env("AI_MEMORY_EMBEDDING_PROVIDER", "none")
                .current_dir(first_cwd)
                .output()
                .unwrap()
        })
        .await
        .unwrap();
        assert!(!output.status.success(), "{output:?}");
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("invalid home route map"),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(requests.load(Ordering::SeqCst), 0);

        let second_data_dir = data_dir.path().to_path_buf();
        let second_home = home.path().to_path_buf();
        let second_cwd = project.path().to_path_buf();
        let explicit = tokio::task::spawn_blocking(move || {
            hermetic(BIN)
                .args([
                    "doctor",
                    "--workspace",
                    WORKSPACE,
                    "--project",
                    PROJECT,
                    "--json",
                ])
                .env("AI_MEMORY_DATA_DIR", second_data_dir)
                .env("AI_MEMORY_HOME", second_home)
                .env("AI_MEMORY_SERVER_URL", base)
                .env("AI_MEMORY_EMBEDDING_PROVIDER", "none")
                .current_dir(second_cwd)
                .output()
                .unwrap()
        })
        .await
        .unwrap();
        assert!(
            requests.load(Ordering::SeqCst) > 0,
            "explicit scope must reach the server"
        );
        assert!(
            !explicit.status.success(),
            "the deliberately failing server remains observable"
        );
        server.abort();
    }

    #[tokio::test]
    async fn ambiguous_coordinate_keeps_local_sessions_and_marks_capture_unavailable() {
        let data_dir = tempfile::tempdir().expect("data dir");
        let home = tempfile::tempdir().expect("home");
        let project = tempfile::tempdir().expect("project cwd");
        let cwd = fs::canonicalize(project.path()).expect("canonicalize project cwd");
        std::process::Command::new("git")
            .args(["init", "-q"])
            .arg(&cwd)
            .status()
            .expect("initialize git repository");
        std::process::Command::new("git")
            .args(["-C"])
            .arg(&cwd)
            .args([
                "remote",
                "add",
                "origin",
                "https://user:credential-sentinel@github.com/acme/api.git",
            ])
            .status()
            .expect("add git remote");

        let encoded = cwd.to_string_lossy().replace('/', "-");
        let session_dir = home.path().join(".claude").join("projects").join(encoded);
        fs::create_dir_all(&session_dir).expect("session dir");
        write_jsonl(
            &session_dir.join("ambiguous-coordinate.jsonl"),
            &[json!({
                "sessionId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                "cwd": cwd.to_string_lossy(),
                "type": "user",
                "message": {"role": "user", "content": "Local evidence remains visible."},
            })],
        );

        let client = reqwest::Client::new();
        let (server, base) = start_serve(&client, &data_dir.path().join("serve.log"), |port| {
            let mut cmd = hermetic(BIN);
            cmd.args([
                "serve",
                "--transport",
                "http",
                "--bind",
                &format!("127.0.0.1:{port}"),
                "--workspace",
                WORKSPACE,
                "--project",
                "server-default",
                "--no-watcher",
            ])
            .env("AI_MEMORY_DATA_DIR", data_dir.path())
            .env("AI_MEMORY_HOME", home.path())
            .env("AI_MEMORY_EMBEDDING_PROVIDER", "none");
            cmd.current_dir(&cwd);
            cmd
        })
        .await;

        for (index, (project_name, identity)) in [
            ("github-api", "github.com/acme/api"),
            ("gitlab-api", "gitlab.com/acme/api"),
        ]
        .into_iter()
        .enumerate()
        {
            let response = client
                .post(format!("{base}/hook"))
                .query(&[
                    ("event", "session-start"),
                    ("agent", "claude-code"),
                    ("workspace", WORKSPACE),
                    ("project", project_name),
                    ("identity", identity),
                    ("identity_src", "git_remote"),
                    ("identity_style", "host_path"),
                ])
                .json(&json!({
                    "session_id": format!("00000000-0000-4000-8000-0000000001{index:02x}"),
                    "cwd": cwd,
                }))
                .send()
                .await
                .expect("send identity hook");
            assert!(response.status().is_success(), "{response:?}");
        }
        for project_name in ["github-api", "gitlab-api"] {
            let deadline = Instant::now() + Duration::from_secs(10);
            while session_count(&client, &base, WORKSPACE, project_name).await == 0 {
                assert!(Instant::now() < deadline, "project was not created");
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }

        let output = run_cli(
            &[
                "doctor",
                "--workspace",
                WORKSPACE,
                "--project",
                "acme-api",
                "--since-days",
                "0",
                "--json",
            ],
            data_dir.path(),
            home.path(),
            Some(&cwd),
            &base,
        );
        let report: Value = serde_json::from_str(&output).expect("doctor report");
        assert_eq!(
            report["project_coordinate"]["server"]["status"],
            "ambiguous"
        );
        assert_eq!(
            report["project_coordinate"]["server"]["collision_reason"],
            "cross_forge_collision"
        );
        assert!(
            report["capture_coverage_problem"]["reason"]
                .as_str()
                .is_some_and(|reason| reason.contains("ambiguous"))
        );
        let claude = find_row(&report, "claude-code")
            .unwrap_or_else(|| panic!("local session row disappeared: {report}"));
        assert!(claude["local_recent"].as_u64().unwrap_or(0) >= 1);
        assert!(claude["captured"].is_null());
        assert!(claude["uncaptured"].is_null());
        assert!(!output.contains("credential-sentinel"), "{output}");
        assert!(!output.contains("github.com/acme/api"), "{output}");

        let human = run_cli(
            &[
                "doctor",
                "--workspace",
                WORKSPACE,
                "--project",
                "acme-api",
                "--since-days",
                "0",
            ],
            data_dir.path(),
            home.path(),
            Some(&cwd),
            &base,
        );
        assert!(human.contains("capture coverage: unavailable"), "{human}");
        assert!(human.contains("unavailable captured"), "{human}");
        assert!(human.contains("Capture verdict unavailable"), "{human}");
        assert!(!human.contains("nothing was captured"), "{human}");
        assert!(!human.contains("nothing captured yet"), "{human}");
        assert!(!human.contains("Every harness"), "{human}");

        let marker_path = cwd.join(".ai-memory.toml");
        fs::write(
            &marker_path,
            "[capture] private-toml-sentinel\nignore_paths = [\"**\"]\n",
        )
        .expect("write invalid marker");
        let malformed_json = run_cli(
            &[
                "doctor",
                "--workspace",
                WORKSPACE,
                "--project",
                "github-api",
                "--since-days",
                "0",
                "--json",
            ],
            data_dir.path(),
            home.path(),
            Some(&cwd),
            &base,
        );
        let malformed_report: Value =
            serde_json::from_str(&malformed_json).expect("malformed-marker doctor report");
        assert_eq!(
            malformed_report["marker_capture_problem"]["classification"],
            "settings_marker_invalid"
        );
        assert!(!malformed_json.contains(marker_path.to_str().unwrap()));
        assert!(!malformed_json.contains("private-toml-sentinel"));
        let malformed_human = run_cli(
            &[
                "doctor",
                "--workspace",
                WORKSPACE,
                "--project",
                "github-api",
                "--since-days",
                "0",
            ],
            data_dir.path(),
            home.path(),
            Some(&cwd),
            &base,
        );
        assert!(malformed_human.contains("settings_marker_invalid"));
        assert!(!malformed_human.contains(marker_path.to_str().unwrap()));
        assert!(!malformed_human.contains("private-toml-sentinel"));

        drop(server);
    }
}
