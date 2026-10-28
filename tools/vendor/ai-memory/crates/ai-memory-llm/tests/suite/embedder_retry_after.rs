//! Retry behaviour of the Google, Copilot and Voyage embedders against an
//! in-process wiremock. They share the policy `openai_compat_retry_after.rs`
//! pins for the OpenAI-shape embedders: 429 and 503 are retried, and a call
//! gives up with the last status after five new attempts (six requests).
//!
//! Every mock answers with `Retry-After: 0`, so the waits are zero and
//! no test sleeps for more than an instant.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use ai_memory_llm::{
    CopilotEmbedder, Embedder, GoogleEmbedder, LlmError, ProviderAuth, VoyageEmbedder,
};
use secrecy::SecretString;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const GOOGLE_ROUTE: &str = "/v1beta/models/gemini-embedding-001:embedContent";
const COPILOT_ROUTE: &str = "/embeddings";
const VOYAGE_ROUTE: &str = "/v1/embeddings";

fn google(server: &MockServer) -> GoogleEmbedder {
    GoogleEmbedder::new(SecretString::from("test-key"), "gemini-embedding-001", 2)
        .expect("google embedder builds")
        .with_base_url(server.uri())
}

/// A direct Copilot API token skips the GitHub token exchange, so only the
/// embeddings request reaches the mock.
fn copilot(server: &MockServer) -> CopilotEmbedder {
    let auth = ProviderAuth::copilot(
        "/nonexistent/auth.json",
        None,
        Some(SecretString::from("copilot-api-token")),
        Some(server.uri()),
    )
    .require_copilot_auth()
    .expect("direct-token copilot auth resolves");
    CopilotEmbedder::new(auth, "text-embedding-3-small", 2).expect("copilot embedder builds")
}

fn voyage(server: &MockServer) -> VoyageEmbedder {
    VoyageEmbedder::new(SecretString::from("test-key"), "voyage-3-large", 2)
        .expect("voyage embedder builds")
        .with_base_url(server.uri())
}

/// Gemini's `embedContent` answer.
fn google_body() -> serde_json::Value {
    json!({ "embedding": { "values": [0.6, 0.8] } })
}

/// The OpenAI-shape list both Copilot and Voyage answer with.
fn list_body() -> serde_json::Value {
    json!({
        "object": "list",
        "data": [{ "object": "embedding", "index": 0, "embedding": [0.6, 0.8] }],
        "usage": { "total_tokens": 1 },
    })
}

/// Answer the first `failures` requests to `route` with `status` and
/// `Retry-After: 0`, then `success`. Returns the request counter.
async fn mount_flaky(
    server: &MockServer,
    route: &str,
    status: u16,
    failures: usize,
    success: serde_json::Value,
) -> Arc<AtomicUsize> {
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    Mock::given(method("POST"))
        .and(path(route))
        .respond_with(move |_req: &Request| {
            if counter.fetch_add(1, Ordering::SeqCst) < failures {
                ResponseTemplate::new(status)
                    .insert_header("Retry-After", "0")
                    .set_body_string("temporarily unavailable")
            } else {
                ResponseTemplate::new(200).set_body_json(success.clone())
            }
        })
        .mount(server)
        .await;
    hits
}

/// Answer every request to `route` with 503 and `Retry-After: 0`,
/// expecting the initial request plus the five allowed new attempts.
async fn mount_unavailable(server: &MockServer, route: &str) {
    Mock::given(method("POST"))
        .and(path(route))
        .respond_with(
            ResponseTemplate::new(503)
                .insert_header("Retry-After", "0")
                .set_body_string("temporarily unavailable"),
        )
        .expect(6)
        .mount(server)
        .await;
}

#[tokio::test]
async fn google_503_twice_then_success_takes_three_requests() {
    let server = MockServer::start().await;
    let hits = mount_flaky(&server, GOOGLE_ROUTE, 503, 2, google_body()).await;
    let v = google(&server)
        .embed("retry me")
        .await
        .expect("embed succeeds after two 503s");
    assert_eq!(v.len(), 2);
    assert_eq!(
        hits.load(Ordering::SeqCst),
        3,
        "503, 503, 200: exactly three requests"
    );
}

#[tokio::test]
async fn google_endless_503_fails_after_six_requests() {
    let server = MockServer::start().await;
    mount_unavailable(&server, GOOGLE_ROUTE).await;
    let err = google(&server)
        .embed("retry me")
        .await
        .expect_err("an outage that never ends must fail");
    assert!(
        matches!(err, LlmError::Provider { status: 503, .. }),
        "the last status is reported: {err:?}"
    );
    server.verify().await;
}

#[tokio::test]
async fn copilot_503_twice_then_success_takes_three_requests() {
    let server = MockServer::start().await;
    let hits = mount_flaky(&server, COPILOT_ROUTE, 503, 2, list_body()).await;
    let v = copilot(&server)
        .embed("retry me")
        .await
        .expect("embed succeeds after two 503s");
    assert_eq!(v.len(), 2);
    assert_eq!(
        hits.load(Ordering::SeqCst),
        3,
        "503, 503, 200: exactly three requests"
    );
}

#[tokio::test]
async fn copilot_endless_503_fails_after_six_requests() {
    let server = MockServer::start().await;
    mount_unavailable(&server, COPILOT_ROUTE).await;
    let err = copilot(&server)
        .embed("retry me")
        .await
        .expect_err("an outage that never ends must fail");
    assert!(
        matches!(err, LlmError::Provider { status: 503, .. }),
        "the last status is reported: {err:?}"
    );
    server.verify().await;
}

#[tokio::test]
async fn voyage_503_twice_then_success_takes_three_requests() {
    let server = MockServer::start().await;
    let hits = mount_flaky(&server, VOYAGE_ROUTE, 503, 2, list_body()).await;
    let v = voyage(&server)
        .embed("retry me")
        .await
        .expect("embed succeeds after two 503s");
    assert_eq!(v.len(), 2);
    assert_eq!(
        hits.load(Ordering::SeqCst),
        3,
        "503, 503, 200: exactly three requests"
    );
}

#[tokio::test]
async fn voyage_429_once_then_success_takes_two_requests() {
    let server = MockServer::start().await;
    let hits = mount_flaky(&server, VOYAGE_ROUTE, 429, 1, list_body()).await;
    let v = voyage(&server)
        .embed("rate limited")
        .await
        .expect("embed succeeds after one 429");
    assert_eq!(v.len(), 2);
    assert_eq!(
        hits.load(Ordering::SeqCst),
        2,
        "429, 200: exactly two requests"
    );
}

#[tokio::test]
async fn voyage_endless_503_fails_after_six_requests() {
    let server = MockServer::start().await;
    mount_unavailable(&server, VOYAGE_ROUTE).await;
    let err = voyage(&server)
        .embed("retry me")
        .await
        .expect_err("an outage that never ends must fail");
    assert!(
        matches!(err, LlmError::Provider { status: 503, .. }),
        "the last status is reported: {err:?}"
    );
    server.verify().await;
}
