//! Integration tests for `CopilotEmbedder` against an in-process HTTP mock
//! (wiremock).
//!
//! The load-bearing behaviours: (1) requests hit `POST {base}/embeddings`
//! carrying the exchanged Copilot API token as a bearer and the Copilot
//! runtime headers GitHub's API requires (`copilot-integration-id`,
//! `editor-version`); (2) the request body carries `input` and `model`;
//! (3) a mocked response is parsed and unit-normalised; (4) the embedder
//! identifies as provider `copilot`, matching `EmbedderChoice::Copilot`;
//! (5) a dim mismatch is a hard error.
//!
//! A direct Copilot API token (rather than a GitHub token) is configured so
//! `current_token()` short-circuits before the GitHub token-exchange call —
//! no live GitHub auth is needed to exercise the embeddings wire contract.

use ai_memory_llm::{
    CopilotAuth, CopilotEmbedder, Embedder, EmbedderChoice, LlmError, ProviderAuth,
};
use secrecy::SecretString;
use serde_json::json;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn direct_auth(base_url: &str) -> CopilotAuth {
    ProviderAuth::copilot(
        "/nonexistent/auth.json",
        None,
        Some(SecretString::from("copilot-api-token")),
        Some(base_url.to_string()),
    )
    .require_copilot_auth()
    .expect("direct-token copilot auth resolves")
}

fn embedding_body(values: Vec<f32>) -> serde_json::Value {
    json!({
        "object": "list",
        "data": [{ "object": "embedding", "index": 0, "embedding": values }],
        "model": "text-embedding-3-small",
        "usage": { "prompt_tokens": 1, "total_tokens": 1 },
    })
}

#[tokio::test]
async fn embed_sends_bearer_and_copilot_runtime_headers() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/embeddings"))
        .and(header("authorization", "Bearer copilot-api-token"))
        .and(header("copilot-integration-id", "vscode-chat"))
        .and(header("editor-version", "vscode/1.107.0"))
        .respond_with(move |req: &Request| {
            let body: serde_json::Value = serde_json::from_slice(&req.body).unwrap();
            assert_eq!(body["input"], "hello world");
            assert_eq!(body["model"], "text-embedding-3-small");
            ResponseTemplate::new(200).set_body_json(embedding_body(vec![0.3, 0.4]))
        })
        .expect(1)
        .mount(&server)
        .await;

    let e = CopilotEmbedder::new(direct_auth(&server.uri()), "text-embedding-3-small", 2)
        .expect("embedder builds");
    assert_eq!(e.provider(), "copilot");
    assert_eq!(e.provider(), EmbedderChoice::Copilot.name());
    assert_eq!(e.model(), "text-embedding-3-small");
    assert_eq!(e.dim(), 2);

    let v = e.embed("hello world").await.expect("embed succeeds");
    assert_eq!(v.len(), 2);
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    assert!((norm - 1.0).abs() < 1e-5, "expected unit norm, got {norm}");
}

#[tokio::test]
async fn dim_mismatch_is_a_hard_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/embeddings"))
        .respond_with(ResponseTemplate::new(200).set_body_json(embedding_body(vec![0.1, 0.2])))
        .mount(&server)
        .await;

    let e = CopilotEmbedder::new(direct_auth(&server.uri()), "text-embedding-3-small", 3)
        .expect("embedder builds");
    let err = e.embed("hello").await.expect_err("dim mismatch must error");
    assert!(
        matches!(err, LlmError::UnexpectedShape(ref msg) if msg.contains("expected dim 3")),
        "expected UnexpectedShape, got {err:?}"
    );
}
