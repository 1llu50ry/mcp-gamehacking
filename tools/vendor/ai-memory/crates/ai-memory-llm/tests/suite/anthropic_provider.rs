//! Wire tests for the Anthropic provider's structured output: the request it
//! sends each Claude generation and the replies it reads back.
//!
//! Opus 5.5, Sonnet 5.5, Fable 5.1, and Mythos 5.1 answer a forced
//! `tool_choice` with a 400, so they get the default `auto`, and a reply that
//! carries the JSON as text instead of a tool call is read too.

use ai_memory_llm::{AnthropicProvider, ChatRequest, LlmError, LlmProvider};
use secrecy::SecretString;
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn tool_use_reply() -> Value {
    json!([{
        "type": "tool_use",
        "id": "toolu_1",
        "name": "result",
        "input": {"answer": "ok"}
    }])
}

fn text_reply(text: &str) -> Value {
    json!([{"type": "text", "text": text}])
}

/// Serve `content` as the `/v1/messages` reply, run one structured call for
/// `model`, and return its outcome with the body the provider sent.
async fn structured_call(model: &str, content: Value) -> (Result<Value, LlmError>, Value) {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "model": model,
            "content": content,
            "usage": {"input_tokens": 1, "output_tokens": 1}
        })))
        .expect(1)
        .mount(&server)
        .await;
    let provider = AnthropicProvider::new(SecretString::from("sk-ant-test"), model)
        .unwrap()
        .with_base_url(server.uri());
    let schema = json!({"type": "object", "properties": {"answer": {"type": "string"}}});
    let outcome = provider
        .complete_structured_raw(ChatRequest::user_prompt("summarize"), schema)
        .await;
    let received = server
        .received_requests()
        .await
        .expect("mock recorded requests");
    let body: Value = serde_json::from_slice(&received[0].body).unwrap();
    (outcome, body)
}

#[tokio::test]
async fn models_that_reject_a_forced_tool_choice_get_auto() {
    for model in [
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-fable-5-1",
        "claude-mythos-5-1",
    ] {
        let (outcome, body) = structured_call(model, tool_use_reply()).await;
        assert!(body.get("tool_choice").is_none(), "{model}: {body}");
        assert_eq!(body["tools"][0]["name"], "result", "{model}");
        let description = body["tools"][0]["description"].as_str().unwrap();
        assert!(description.contains("Call this tool"), "{description}");
        assert_eq!(outcome.unwrap(), json!({"answer": "ok"}), "{model}");
    }
}

#[tokio::test]
async fn models_that_accept_a_forced_tool_choice_keep_it() {
    for model in [
        "claude-opus-5",
        "claude-sonnet-5",
        "claude-fable-5",
        "claude-haiku-5-5",
        "claude-sonnet-4-6",
    ] {
        let (outcome, body) = structured_call(model, tool_use_reply()).await;
        assert_eq!(
            body["tool_choice"],
            json!({"type": "tool", "name": "result"}),
            "{model}"
        );
        assert_eq!(outcome.unwrap(), json!({"answer": "ok"}), "{model}");
    }
}

#[tokio::test]
async fn an_unforced_call_reads_json_after_thinking_or_in_prose() {
    let fenced = json!([
        {"type": "thinking", "thinking": "", "signature": "sig"},
        {"type": "text", "text": "```json\n{\"answer\": \"ok\"}\n```"}
    ]);
    let (outcome, _) = structured_call("claude-opus-5-5", fenced).await;
    assert_eq!(outcome.unwrap(), json!({"answer": "ok"}));

    let in_prose = text_reply("Here it is: {\"answer\": \"ok\"}");
    let (outcome, _) = structured_call("claude-sonnet-5-5", in_prose).await;
    assert_eq!(outcome.unwrap(), json!({"answer": "ok"}));
}

#[tokio::test]
async fn a_reply_without_a_tool_call_or_json_is_still_an_error() {
    let prose = text_reply("I cannot produce that.");
    let (outcome, _) = structured_call("claude-opus-5-5", prose).await;
    assert!(
        matches!(outcome, Err(LlmError::UnexpectedShape(_))),
        "{outcome:?}"
    );

    // A forced call keeps its contract: text is never read as the result.
    let json_text = text_reply("{\"answer\": \"ok\"}");
    let (outcome, _) = structured_call("claude-opus-5", json_text).await;
    assert!(
        matches!(outcome, Err(LlmError::UnexpectedShape(_))),
        "{outcome:?}"
    );
}

/// A structured answer the model stopped at `max_tokens` is terminal: the
/// `tool_use` block's `input` carries only the JSON produced before the budget
/// ran out, and the batch types it feeds default every field but `updates`, so
/// a short object deserializes and reads as a complete answer. The control is
/// `complete`, where prose cut at the budget is a usable reply and must still
/// succeed on the very same response.
#[tokio::test]
async fn a_structured_answer_stopped_at_max_tokens_is_terminal_truncated() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "model": "claude-sonnet-5",
            "stop_reason": "max_tokens",
            "content": [
                {"type": "text", "text": "partial prose"},
                {
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "result",
                    "input": {"updates": [{"path": "notes/a.md"}]}
                }
            ],
            "usage": {"input_tokens": 7, "output_tokens": 16000}
        })))
        .expect(2)
        .mount(&server)
        .await;
    let provider = AnthropicProvider::new(SecretString::from("sk-ant-test"), "claude-sonnet-5")
        .unwrap()
        .with_base_url(server.uri());

    let schema = json!({"type": "object", "properties": {"updates": {"type": "array"}}});
    let err = provider
        .complete_structured_raw(ChatRequest::user_prompt("consolidate"), schema)
        .await
        .expect_err("a budget stop must not return a partial structured result");
    match &err {
        LlmError::TruncatedResponse {
            model,
            completion_tokens,
        } => {
            assert_eq!(model, "claude-sonnet-5");
            assert_eq!(*completion_tokens, Some(16000));
        }
        other => panic!("expected TruncatedResponse, got {other:?}"),
    }
    assert_eq!(err.class(), "truncated-response");
    assert!(!err.is_transient(), "a budget stop must not be retried");

    // Control: the non-structured path reads the same `stop_reason` as a
    // normal outcome and returns the prose it did get.
    let response = provider
        .complete(ChatRequest::user_prompt("summarize"))
        .await
        .expect("prose cut at the budget is still an answer");
    assert_eq!(response.text, "partial prose");
}
