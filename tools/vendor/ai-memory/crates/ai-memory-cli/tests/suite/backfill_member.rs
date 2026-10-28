//! Backfill on a multi-user server, where `/admin/*` refuses a developer's own
//! key: the emptiness check falls back to the grant-checked web API.
use axum::{Json, Router, http::StatusCode, response::IntoResponse, routing::get};
use serde_json::{Value, json};

/// What the member-readable sessions route answers.
#[derive(Clone, Copy, Debug)]
enum Member {
    Empty,
    Populated,
    NotFound,
    NoWebApi,
    Forbidden,
}

async fn run_dry(member: Member) -> (bool, String, String) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = Router::new()
        .route(
            "/admin/sessions/by-agent",
            get(|| async {
                (
                    StatusCode::FORBIDDEN,
                    Json(json!({"error": "admin operation is root-only in multi-user mode"})),
                )
            }),
        )
        .route(
            "/api/v1/workspaces/review/projects/fixture/sessions",
            get(move || async move {
                match member {
                    Member::Empty => Json(json!({"sessions": []})).into_response(),
                    Member::Populated => {
                        Json(json!({"sessions": [{"session_id": "s1"}]})).into_response()
                    }
                    Member::NotFound => (
                        StatusCode::NOT_FOUND,
                        Json(json!({"error": "project 'fixture' not found"})),
                    )
                        .into_response(),
                    Member::NoWebApi => (StatusCode::NOT_FOUND, "").into_response(),
                    Member::Forbidden => (
                        StatusCode::FORBIDDEN,
                        Json(json!({"error": "no access to this project"})),
                    )
                        .into_response(),
                }
            }),
        );
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let data = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let cwd = tempfile::tempdir().unwrap();
    let mut cmd = crate::e2e_support::hermetic(env!("CARGO_BIN_EXE_ai-memory"));
    cmd.current_dir(cwd.path())
        .env("AI_MEMORY_HOME", home.path())
        .env("AI_MEMORY_DATA_DIR", data.path())
        .env("AI_MEMORY_SERVER_URL", format!("http://{addr}"))
        .args([
            "backfill",
            "--workspace",
            "review",
            "--project",
            "fixture",
            "--dry-run",
            "--json",
        ]);
    let output = tokio::process::Command::from(cmd).output().await.unwrap();
    server.abort();
    (
        output.status.success(),
        String::from_utf8(output.stdout).unwrap(),
        String::from_utf8(output.stderr).unwrap(),
    )
}

#[tokio::test]
async fn a_refused_admin_check_falls_back_to_the_member_sessions_route() {
    for (member, skipped) in [
        (Member::Empty, false),
        (Member::NotFound, false),
        (Member::Populated, true),
    ] {
        let (ok, stdout, stderr) = run_dry(member).await;
        assert!(ok, "{member:?}: backfill failed: {stderr}");
        let report: Value = serde_json::from_str(&stdout).unwrap();
        assert_eq!(report["skipped_non_empty"], skipped, "{member:?}: {stdout}");
    }
}

#[tokio::test]
async fn an_unanswerable_member_check_is_an_error_never_empty() {
    for member in [Member::NoWebApi, Member::Forbidden] {
        let (ok, stdout, stderr) = run_dry(member).await;
        assert!(!ok, "{member:?}: guessed an answer: {stdout}");
        assert!(
            stderr.contains("already has captured sessions"),
            "{member:?}: {stderr}"
        );
    }
}
