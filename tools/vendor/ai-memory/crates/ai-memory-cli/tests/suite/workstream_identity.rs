//! Privacy projection through the existing CLI search against an older server.

#[tokio::test]
async fn native_identity_search_old_server_json_projects_unknown_and_keeps_history() {
    use axum::{Json, Router, routing::get};
    use serde_json::{Value, json};
    let dirty = "sk-abcdefghijklmnopqrstuvwx";
    let app = Router::new().route("/workstream/{id}/events", get(move || async move {
        Json(json!([
            {"sequence": 1, "event_id": "legacy", "agent": "codex", "native_session_id": dirty, "kind": "message", "content": "shared history"},
            {"sequence": 2, "event_id": "valid", "agent": "codex", "native_session_id": "vendor-界-01", "kind": "message", "content": "shared control"}
        ]))
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let data = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let task_data = data.path().to_owned();
    let task_home = home.path().to_owned();
    let output = tokio::task::spawn_blocking(move || {
        let mut cmd = crate::e2e_support::hermetic(env!("CARGO_BIN_EXE_ai-memory"));
        cmd.env("HOME", &task_home)
            .env("USERPROFILE", &task_home)
            .env("AI_MEMORY_SERVER_URL", format!("http://{address}"))
            .arg("--data-dir")
            .arg(task_data)
            .args([
                "workstream-search",
                "--workstream-id",
                "018f0000-0000-7000-8000-000000000001",
                "--json",
            ]);
        cmd.stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let child = cmd.spawn().unwrap();
        println!("NATIVE_CLI_PID {}", child.id());
        child.wait_with_output().unwrap()
    })
    .await
    .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout).unwrap();
    let events: Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(
        events[0]["native_session_id"], "",
        "CLI JSON must project a dirty old-server identity to UNKNOWN"
    );
    assert!(!stdout.contains(dirty));
    assert_eq!(events[0]["content"], "shared history");
    assert_eq!(events[0]["sequence"], 1);
    assert_eq!(events[1]["native_session_id"], "vendor-界-01");
    server.abort();
}
