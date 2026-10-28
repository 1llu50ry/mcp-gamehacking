//! A transcript record over the per-record cap (an image in a Claude Code tool
//! result) is skipped, the rest of the session is imported, and the skip is
//! reported on stderr in every output mode (#1613).
#![cfg(unix)]
use std::sync::{Arc, Mutex};

use axum::{Json, Router, routing::post};
use serde_json::{Value, json};

#[tokio::test]
async fn an_oversized_record_is_skipped_and_reported_in_human_json_and_quiet_modes() {
    let home = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let cwd = std::fs::canonicalize(project.path()).unwrap();
    let transcripts = home
        .path()
        .join(".claude/projects")
        .join(cwd.to_string_lossy().replace('/', "-"));
    std::fs::create_dir_all(&transcripts).unwrap();
    let sid = "11111111-2222-3333-4444-555555555555";
    let prompt = |uuid: &str, text: &str| json!({"type": "user", "uuid": uuid, "message": {"role": "user", "content": [{"type": "text", "text": text}]}});
    crate::e2e_support::write_jsonl(
        &transcripts.join(format!("{sid}.jsonl")),
        &[
            json!({"sessionId": sid, "cwd": cwd}),
            prompt("before", "prompt before the screenshot"),
            json!({"type": "user", "uuid": "image", "message": {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "tool", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "A".repeat(1024 * 1024)}}
                ]}
            ]}}),
            prompt("after", "prompt after the screenshot"),
        ],
    );

    let posted = Arc::new(Mutex::new(Vec::<Value>::new()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let sink = posted.clone();
    let app = Router::new().route(
        "/hook/batch",
        post(move |Json(items): Json<Vec<Value>>| {
            let sink = sink.clone();
            async move {
                let results = (0..items.len())
                    .map(|index| json!({"index": index, "outcome": "stored"}))
                    .collect::<Vec<_>>();
                let accepted = items.len();
                sink.lock().unwrap().extend(items);
                Json(json!({"accepted": accepted, "results": results}))
            }
        }),
    );
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    for mode in ["human", "json", "quiet"] {
        posted.lock().unwrap().clear();
        let data = tempfile::tempdir().unwrap();
        let mut cmd = crate::e2e_support::hermetic(env!("CARGO_BIN_EXE_ai-memory"));
        cmd.current_dir(&cwd)
            .env("AI_MEMORY_HOME", home.path())
            .env("AI_MEMORY_DATA_DIR", data.path())
            .env("AI_MEMORY_SERVER_URL", format!("http://{addr}"))
            .args([
                "backfill",
                "--workspace",
                "review",
                "--project",
                "fixture",
                "--force",
            ]);
        if mode == "json" {
            cmd.arg("--json");
        }
        if mode == "quiet" {
            cmd.args(["--auto", "--quiet"]);
        }
        let output = tokio::process::Command::from(cmd).output().await.unwrap();
        let stdout = String::from_utf8(output.stdout).unwrap();
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(
            output.status.success(),
            "{mode}: the session failed instead of skipping one record: {stderr}"
        );
        assert!(
            stderr.contains("skipped 1 oversized transcript record(s)"),
            "{mode}: the skip was not reported: {stderr}"
        );
        let bodies = posted
            .lock()
            .unwrap()
            .iter()
            .map(|item| item["body"].to_string())
            .collect::<Vec<_>>();
        for text in [
            "prompt before the screenshot",
            "prompt after the screenshot",
        ] {
            assert!(
                bodies.iter().any(|body| body.contains(text)),
                "{mode}: {text:?} was not imported"
            );
        }
        assert!(
            bodies.iter().all(|body| !body.contains("AAAAAAAA")),
            "{mode}: the oversized record reached the server"
        );
        match mode {
            "json" => {
                let report: Value = serde_json::from_str(&stdout).unwrap();
                assert_eq!(report["imported_sessions"], 1);
                assert_eq!(report["failed_sessions"], 0);
            }
            "quiet" => assert!(stdout.is_empty(), "{stdout}"),
            _ => assert!(
                stdout.contains("imported 1 prior local session"),
                "{stdout}"
            ),
        }
    }
    server.abort();
}
