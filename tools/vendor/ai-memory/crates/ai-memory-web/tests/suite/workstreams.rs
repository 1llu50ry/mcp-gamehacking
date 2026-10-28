//! Adversarial tests for the root-only managed-workstream operations view.

use std::sync::Arc;

use ai_memory_core::{
    ActorContext, AgentKind, AuthLevel, NewUser, NewWorkstreamEvent, Sanitizer, UserRole,
    WorkstreamEventKind,
};
use ai_memory_store::{
    FinishWorkstreamRun, ManagedRunAuthority, PrepareWorkstreamRun, Store, WorkstreamSelection,
};
use ai_memory_web::{HtmlAuthRedirectConfig, html_auth_redirect_mw, router};
use ai_memory_wiki::Wiki;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use tempfile::TempDir;
use tower::ServiceExt;

struct Fixture {
    _tmp: TempDir,
    store: Store,
    wiki: Wiki,
}

async fn fixture() -> Fixture {
    let tmp = TempDir::new().unwrap();
    let store = Store::open(tmp.path()).unwrap();
    let wiki = Wiki::new(tmp.path(), store.writer.clone()).unwrap();
    Fixture {
        _tmp: tmp,
        store,
        wiki,
    }
}

async fn prepare(
    fixture: &Fixture,
    project: &str,
    name: &str,
    agent: AgentKind,
) -> ai_memory_store::PreparedWorkstreamRun {
    prepare_with_selection(
        fixture,
        project,
        agent,
        WorkstreamSelection::New(name.to_owned()),
    )
    .await
}

async fn prepare_with_selection(
    fixture: &Fixture,
    project: &str,
    agent: AgentKind,
    selection: WorkstreamSelection,
) -> ai_memory_store::PreparedWorkstreamRun {
    let workspace_id = fixture
        .store
        .writer
        .get_or_create_workspace("default")
        .await
        .unwrap();
    let project_id = fixture
        .store
        .writer
        .get_or_create_project(workspace_id, project, None)
        .await
        .unwrap();
    fixture
        .store
        .writer
        .prepare_workstream_run(PrepareWorkstreamRun {
            workspace_id,
            project_id,
            repo_fingerprint: format!("repo-secret-{project}"),
            worktree_fingerprint: format!("tree-secret-{project}"),
            cwd: format!("/secret/{project}"),
            agent,
            automatic_harness: false,
            available_agents: Vec::new(),
            selection,
            lease_owner: format!("lease-secret-{project}"),
        })
        .await
        .unwrap()
}

fn root_authority() -> ManagedRunAuthority {
    ManagedRunAuthority::from_auth(
        AuthLevel::Root,
        None,
        None,
        &ActorContext::anonymous(),
        false,
    )
}

async fn finish(fixture: &Fixture, run: &ai_memory_store::PreparedWorkstreamRun) {
    fixture
        .store
        .writer
        .finish_workstream_run(
            root_authority(),
            FinishWorkstreamRun {
                sanitizer: Sanitizer::default(),
                run_id: run.run_id,
                native_session_id: Some("native-session-secret".into()),
                source_cursor: Some("cursor-secret".into()),
                events: vec![NewWorkstreamEvent {
                    event_id: "event-1".into(),
                    agent: run.agent,
                    native_session_id: "native-session-secret".into(),
                    source_record_id: Some("source-secret".into()),
                    kind: WorkstreamEventKind::Message,
                    role: Some("assistant".into()),
                    content: "<script>transcript secret</script>".into(),
                    occurred_at: None,
                    metadata: serde_json::json!({"tool": "secret-tool"}),
                }],
                complete: true,
                segment_path: Some("/secret/segment.jsonl".into()),
                exit_code: Some(0),
            },
        )
        .await
        .unwrap();
}

async fn add_db_user(store: &Store) {
    store
        .writer
        .create_human_user(
            NewUser {
                username: "alice".into(),
                name: None,
                email: None,
            },
            UserRole::User,
            None,
            false,
        )
        .await
        .unwrap();
}

fn app(fixture: &Fixture, level: AuthLevel) -> axum::Router {
    let cfg = Arc::new(HtmlAuthRedirectConfig::from_mount("", "/"));
    router(fixture.store.reader.clone(), fixture.wiki.clone())
        .layer(axum::middleware::from_fn(
            move |mut request: Request<Body>, next: axum::middleware::Next| async move {
                request.extensions_mut().insert(level);
                next.run(request).await
            },
        ))
        .layer(axum::middleware::from_fn_with_state(
            cfg,
            html_auth_redirect_mw,
        ))
}

async fn get_uri(
    app: axum::Router,
    uri: &str,
    html: bool,
) -> (StatusCode, axum::http::HeaderMap, String) {
    let mut request = Request::builder().uri(uri);
    if html {
        request = request
            .header(header::ACCEPT, "text/html")
            .header("sec-fetch-dest", "document");
    }
    let response = app
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, headers, String::from_utf8(body.to_vec()).unwrap())
}

async fn get(app: axum::Router, html: bool) -> (StatusCode, axum::http::HeaderMap, String) {
    get_uri(app, "/workstreams", html).await
}

#[tokio::test]
async fn operations_page_is_root_only_once_operators_are_distinguished() {
    let fixture = fixture().await;
    prepare(&fixture, "private", "private stream", AgentKind::Codex).await;
    add_db_user(&fixture.store).await;

    let (status, _, body) = get(app(&fixture, AuthLevel::Anonymous), false).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(!body.contains("private stream"));

    let (status, _, body) = get(app(&fixture, AuthLevel::User), true).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(body.contains("Root access required"), "{body}");
    assert!(!body.contains("private stream"));
}

#[tokio::test]
async fn operations_page_lists_lifecycle_state_without_host_or_transcript_secrets() {
    let fixture = fixture().await;
    let completed = prepare(
        &fixture,
        "complete",
        "review <img src=x onerror=alert(1)>",
        AgentKind::ClaudeCode,
    )
    .await;
    finish(&fixture, &completed).await;
    prepare(&fixture, "live", "active work", AgentKind::Codex).await;
    add_db_user(&fixture.store).await;

    let (status, headers, body) = get(app(&fixture, AuthLevel::Root), true).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(headers.get(header::CACHE_CONTROL).unwrap(), "no-store");
    assert!(body.contains("Completed"), "{body}");
    assert!(body.contains("Active"), "{body}");
    assert!(body.contains("default/complete"), "{body}");
    assert!(body.contains("default/live"), "{body}");
    assert!(
        body.contains("&lt;img src=x onerror=alert(1)&gt;"),
        "{body}"
    );
    assert!(!body.contains("<img src=x onerror=alert(1)>"), "{body}");
    assert!(!body.contains("transcript secret"), "{body}");
    for secret in [
        "/secret/",
        "repo-secret-",
        "tree-secret-",
        "lease-secret-",
        "native-session-secret",
        "source-secret",
        "cursor-secret",
        "segment.jsonl",
        "secret-tool",
    ] {
        assert!(!body.contains(secret), "leaked {secret}: {body}");
    }
    let active = body.find("active work").unwrap();
    let completed = body.find("review &lt;img").unwrap();
    assert!(active < completed, "attention ordering changed: {body}");
}

#[tokio::test]
async fn single_user_install_can_open_the_operations_page() {
    let fixture = fixture().await;
    prepare(&fixture, "solo", "default", AgentKind::Codex).await;
    let (status, _, body) = get(app(&fixture, AuthLevel::Anonymous), true).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("default/solo"), "{body}");
}

#[tokio::test]
async fn operations_page_paginates_workstreams_before_current_harness_links() {
    let fixture = fixture().await;
    for index in 0..100 {
        prepare(
            &fixture,
            "pages",
            &format!("stream-{index:03}"),
            AgentKind::Codex,
        )
        .await;
    }

    let first = prepare(&fixture, "pages", "multi-harness", AgentKind::ClaudeCode).await;
    finish(&fixture, &first).await;
    let current = prepare_with_selection(
        &fixture,
        "pages",
        AgentKind::Codex,
        WorkstreamSelection::Named("multi-harness".into()),
    )
    .await;
    fixture
        .store
        .writer
        .link_managed_run_session(current.run_id, AgentKind::Codex, "codex-current")
        .await
        .unwrap();

    let (status, _, first_page) = get(app(&fixture, AuthLevel::Anonymous), true).await;
    assert_eq!(status, StatusCode::OK, "{first_page}");
    assert_eq!(first_page.matches("<tr>").count(), 101, "{first_page}");
    assert_eq!(
        first_page.matches("multi-harness").count(),
        1,
        "{first_page}"
    );
    assert!(first_page.contains("claude-code"), "{first_page}");
    assert!(first_page.contains("codex"), "{first_page}");
    assert!(
        first_page.contains("href=\"workstreams?page=2\""),
        "{first_page}"
    );

    let (status, _, second_page) = get_uri(
        app(&fixture, AuthLevel::Anonymous),
        "/workstreams?page=2",
        true,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{second_page}");
    assert_eq!(second_page.matches("<tr>").count(), 2, "{second_page}");
    assert!(!second_page.contains("multi-harness"), "{second_page}");
    assert!(!second_page.contains("workstreams?page=3"), "{second_page}");
}
