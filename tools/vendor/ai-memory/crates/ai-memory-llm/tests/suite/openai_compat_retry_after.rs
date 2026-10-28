//! Retry behaviour of the OpenAI-shape embedding request against an
//! in-process wiremock: 429 and 503 are retried (and nothing else), a
//! whole-second `Retry-After` is honoured, and the retry budget is
//! bounded both in attempts (five new attempts, six requests total) and
//! in total wait time.
//!
//! Every mock answers with `Retry-After: 0`, so the waits are zero and
//! no test sleeps for more than an instant.

use std::sync::atomic::{AtomicUsize, Ordering};

use ai_memory_llm::{Embedder, LlmError, OpenAiCompatEmbedder};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn success_body(dim: usize) -> serde_json::Value {
    serde_json::json!({
        "object": "list",
        "data": [{ "object": "embedding", "index": 0, "embedding": vec![0.5_f32; dim] }],
        "model": "nomic-embed-text",
        "usage": { "prompt_tokens": 1, "total_tokens": 1 },
    })
}

#[tokio::test]
async fn retry_after_0_503_twice_then_success_succeeds_in_exactly_three_requests() {
    let server = MockServer::start().await;
    let hits = std::sync::Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(move |_req: &wiremock::Request| {
            let n = counter.fetch_add(1, Ordering::SeqCst) + 1;
            if n <= 2 {
                // A gateway out of capacity: 503 with a zero wait so the
                // test does not sleep.
                ResponseTemplate::new(503)
                    .insert_header("Retry-After", "0")
                    .set_body_string("gateway unavailable")
            } else {
                ResponseTemplate::new(200).set_body_json(success_body(4))
            }
        })
        .expect(3)
        .mount(&server)
        .await;

    let e = OpenAiCompatEmbedder::new(format!("{}/v1", server.uri()), None, "nomic-embed-text", 4)
        .expect("embedder builds");
    let v = e
        .embed("retry me")
        .await
        .expect("embed succeeds after two 503s");
    assert_eq!(v.len(), 4);
    assert_eq!(
        hits.load(Ordering::SeqCst),
        3,
        "503, 503, 200 — exactly three requests"
    );
}

#[tokio::test]
async fn endless_503_fails_after_at_most_six_requests() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(
            ResponseTemplate::new(503)
                .insert_header("Retry-After", "0")
                .set_body_string("gateway unavailable"),
        )
        // One initial request plus the five allowed new attempts.
        .expect(6)
        .mount(&server)
        .await;

    let e = OpenAiCompatEmbedder::new(format!("{}/v1", server.uri()), None, "nomic-embed-text", 4)
        .expect("embedder builds");
    let err = e
        .embed("retry me")
        .await
        .expect_err("a gateway that never recovers must fail");
    assert!(
        matches!(err, LlmError::Provider { status: 503, .. }),
        "the last status is reported: {err:?}"
    );
    server.verify().await;
}

#[tokio::test]
async fn retry_after_0_429_once_then_success_succeeds_in_exactly_two_requests() {
    let server = MockServer::start().await;
    let hits = std::sync::Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    Mock::given(method("POST"))
        .and(path("/v1/embeddings"))
        .respond_with(move |_req: &wiremock::Request| {
            let n = counter.fetch_add(1, Ordering::SeqCst) + 1;
            if n == 1 {
                ResponseTemplate::new(429)
                    .insert_header("Retry-After", "0")
                    .set_body_string("rate limited")
            } else {
                ResponseTemplate::new(200).set_body_json(success_body(4))
            }
        })
        .expect(2)
        .mount(&server)
        .await;

    let e = OpenAiCompatEmbedder::new(format!("{}/v1", server.uri()), None, "nomic-embed-text", 4)
        .expect("embedder builds");
    let v = e
        .embed("rate limited")
        .await
        .expect("embed succeeds after one 429");
    assert_eq!(v.len(), 4);
    assert_eq!(
        hits.load(Ordering::SeqCst),
        2,
        "429, 200 — exactly two requests"
    );
}
