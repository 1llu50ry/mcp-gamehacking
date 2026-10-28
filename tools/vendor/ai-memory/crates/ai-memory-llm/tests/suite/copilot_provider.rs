//! Offline wire tests for Copilot Chat Completions / Responses routing.

use ai_memory_llm::{CopilotAuth, CopilotProvider, LlmError, LlmProvider, ProviderAuth};
use secrecy::SecretString;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

fn direct_auth(base_url: &str) -> CopilotAuth {
    ProviderAuth::copilot(
        "/nonexistent/auth.json",
        None,
        Some(SecretString::from("copilot-api-token")),
        Some(base_url.to_owned()),
    )
    .require_copilot_auth()
    .expect("direct Copilot API token resolves")
}

fn provider(server: &MockServer, model: &str) -> CopilotProvider {
    CopilotProvider::new(direct_auth(&server.uri()), model).expect("provider builds")
}

fn metadata(model: &str, endpoints: &[&str]) -> serde_json::Value {
    json!({"data": [{"id": model, "supported_endpoints": endpoints}]})
}

fn chat(content: &str) -> serde_json::Value {
    json!({"model":"chat-model","choices":[{"message":{"content":content}}],"usage":{"prompt_tokens":2,"completion_tokens":3}})
}

fn responses(content: &str) -> serde_json::Value {
    json!({"status":"completed","model":"responses-model","output":[{"type":"message","content":[{"type":"output_text","text":content}]}],"usage":{"input_tokens":2,"output_tokens":3}})
}

/// A `/responses` answer stopped by `max_output_tokens` is a truncation the
/// operator can act on, not an unexpected shape. `error` is null on an
/// incomplete response, so the old message always ended "no error detail" and
/// told the operator nothing — and `unexpected-shape` is the wrong class for a
/// stop that raising `max_tokens` fixes.
#[tokio::test]
async fn an_incomplete_responses_answer_is_a_truncated_response() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/models"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(metadata("responses", &["/responses"])),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/responses"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "status": "incomplete",
            "incomplete_details": { "reason": "max_output_tokens" },
            "error": null,
            "model": "responses-model",
            "output": [{ "type": "reasoning", "content": [] }],
            "usage": { "input_tokens": 2, "output_tokens": 4096 },
        })))
        .mount(&server)
        .await;

    let err = provider(&server, "responses")
        .complete(ai_memory_llm::ChatRequest::user_prompt("hi"))
        .await
        .expect_err("a truncated answer must not be returned as text");

    assert_eq!(err.class(), "truncated-response", "{err:?}");
    assert!(
        !err.is_transient(),
        "raising max_tokens is the fix, not a retry"
    );
    match &err {
        LlmError::TruncatedResponse {
            model,
            completion_tokens,
        } => {
            assert_eq!(model, "responses");
            assert_eq!(*completion_tokens, Some(4096));
        }
        other => panic!("expected TruncatedResponse, got {other:?}"),
    }
}

/// The control: any OTHER non-completed status keeps the existing
/// unexpected-shape classification, so this change is scoped to the one stop
/// reason the operator can act on.
#[tokio::test]
async fn another_incomplete_reason_stays_an_unexpected_shape() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/models"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(metadata("responses", &["/responses"])),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/responses"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "status": "incomplete",
            "incomplete_details": { "reason": "content_filter" },
            "error": null,
            "model": "responses-model",
            "output": [],
            "usage": { "input_tokens": 2, "output_tokens": 0 },
        })))
        .mount(&server)
        .await;

    let err = provider(&server, "responses")
        .complete(ai_memory_llm::ChatRequest::user_prompt("hi"))
        .await
        .expect_err("a non-completed status must still fail");

    assert_eq!(err.class(), "unexpected-shape", "{err:?}");
}

#[tokio::test]
async fn metadata_selects_chat_and_preserves_chat_wire_format() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/models"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(metadata("chat", &["/chat/completions"])),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .respond_with(|request: &Request| {
            let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
            assert_eq!(body["model"], "chat");
            assert_eq!(body["stream"], false);
            ResponseTemplate::new(200).set_body_json(chat("hello"))
        })
        .mount(&server)
        .await;

    assert_eq!(
        provider(&server, "chat")
            .complete(ai_memory_llm::ChatRequest::user_prompt("hi"))
            .await
            .unwrap()
            .text,
        "hello"
    );
}

#[tokio::test]
async fn metadata_selects_responses_and_parses_ordinary_text() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/models"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(metadata("responses", &["/responses"])),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/responses"))
        .respond_with(|request: &Request| {
            let body: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
            assert_eq!(body["input"][0]["content"][0]["type"], "input_text");
            assert_eq!(body["stream"], false);
            assert_eq!(body["store"], false);
            ResponseTemplate::new(200).set_body_json(responses("hello"))
        })
        .mount(&server)
        .await;

    assert_eq!(
        provider(&server, "responses")
            .complete(ai_memory_llm::ChatRequest::user_prompt("hi"))
            .await
            .unwrap()
            .text,
        "hello"
    );
}

#[tokio::test]
async fn metadata_with_both_endpoints_deterministically_prefers_chat() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/models"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(metadata("both", &["/responses", "/chat/completions"])),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(chat("chat wins")))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/responses"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;

    assert_eq!(
        provider(&server, "both")
            .complete(ai_memory_llm::ChatRequest::user_prompt("hi"))
            .await
            .unwrap()
            .text,
        "chat wins"
    );
}

#[tokio::test]
async fn model_absent_from_catalogue_falls_back_to_chat_completions() {
    // A 200 `/models` response that does not enumerate the configured model
    // (enterprise/custom deployments, aliases, a model newer than the list)
    // must keep the pre-metadata-check Chat Completions path, not hard-error.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/models"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(metadata("some-other-model", &["/chat/completions"])),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(chat("fallback")))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/responses"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;

    assert_eq!(
        provider(&server, "enterprise-custom-deployment")
            .complete(ai_memory_llm::ChatRequest::user_prompt("hi"))
            .await
            .unwrap()
            .text,
        "fallback"
    );
}

#[tokio::test]
async fn metadata_without_a_compatible_endpoint_fails_with_model_and_capabilities() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/models"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(metadata("unsupported", &["/v1/messages"])),
        )
        .mount(&server)
        .await;

    let error = provider(&server, "unsupported")
        .complete(ai_memory_llm::ChatRequest::user_prompt("hi"))
        .await
        .unwrap_err();
    assert!(
        matches!(error, LlmError::UnexpectedShape(message) if message.contains("unsupported") && message.contains("/v1/messages"))
    );
}

#[tokio::test]
async fn structured_chat_and_responses_requests_return_json() {
    for (model, endpoints, endpoint, body) in [
        (
            "chat",
            vec!["/chat/completions"],
            "/chat/completions",
            chat(r#"{"ok":true}"#),
        ),
        (
            "responses",
            vec!["/responses"],
            "/responses",
            responses(r#"{"ok":true}"#),
        ),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .respond_with(ResponseTemplate::new(200).set_body_json(metadata(model, &endpoints)))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(endpoint))
            .respond_with(move |request: &Request| {
                let value: serde_json::Value = serde_json::from_slice(&request.body).unwrap();
                if endpoint == "/responses" {
                    assert_eq!(value["text"]["format"]["strict"], true);
                } else {
                    assert_eq!(value["response_format"]["json_schema"]["strict"], true);
                }
                ResponseTemplate::new(200).set_body_json(body.clone())
            })
            .mount(&server)
            .await;
        let value = provider(&server, model)
            .complete_structured_raw(
                ai_memory_llm::ChatRequest::user_prompt("json"),
                json!({"type":"object","properties":{"ok":{"type":"boolean"}}}),
            )
            .await
            .unwrap();
        assert_eq!(value, json!({"ok": true}));
    }
}

#[tokio::test]
async fn missing_structured_content_and_endpoint_errors_are_meaningful() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/models"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(metadata("chat-empty", &["/chat/completions"])),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(chat("")))
        .mount(&server)
        .await;
    let error = provider(&server, "chat-empty")
        .complete_structured_raw(
            ai_memory_llm::ChatRequest::user_prompt("json"),
            json!({"type":"object"}),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(error, LlmError::UnexpectedShape(message) if message.contains("structured content"))
    );

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/models"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(metadata("responses", &["/responses"])),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/responses"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"status":"completed","output":[]})),
        )
        .mount(&server)
        .await;
    let error = provider(&server, "responses")
        .complete_structured_raw(
            ai_memory_llm::ChatRequest::user_prompt("json"),
            json!({"type":"object"}),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(error, LlmError::UnexpectedShape(message) if message.contains("no text content"))
    );

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/models"))
        .respond_with(ResponseTemplate::new(200).set_body_json(metadata("reject", &["/responses"])))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/responses"))
        .respond_with(ResponseTemplate::new(400).set_body_string("unsupported strict schema"))
        .mount(&server)
        .await;
    let error = provider(&server, "reject")
        .complete_structured_raw(
            ai_memory_llm::ChatRequest::user_prompt("json"),
            json!({"type":"object"}),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, LlmError::Provider { status: 400, .. }));
}

#[tokio::test]
async fn responses_refusal_is_not_treated_as_completion_content() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/models"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(metadata("refusal", &["/responses"])),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/responses"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "status": "completed",
            "output": [{
                "type": "message",
                "content": [{"type": "refusal", "refusal": "cannot comply"}]
            }]
        })))
        .mount(&server)
        .await;

    let error = provider(&server, "refusal")
        .complete(ai_memory_llm::ChatRequest::user_prompt("hi"))
        .await
        .unwrap_err();
    assert!(matches!(error, LlmError::UnexpectedShape(message) if message.contains("refused")));
}
