//! Hermes Agent lifecycle payloads, shaped before the native hook spools them.
//!
//! Hermes runs every configured shell hook with one stdin envelope
//! (`agent/shell_hooks.py`, v0.22.2): `hook_event_name`, `tool_name`,
//! `tool_input`, `session_id`, `cwd`, `profile`, and an `extra` object holding
//! every other keyword argument of the event. The tool events already parse as
//! sent. The lifecycle events do not, and two of them carry more than
//! ai-memory may keep:
//!
//! - `pre_llm_call` puts the prompt in `extra.user_message`, a string or a list
//!   of content parts, next to `extra.conversation_history`, the whole
//!   conversation so far. Only the prompt's text is kept.
//! - `on_session_finalize` names the ending session in `session_id`. A gateway
//!   `/new` also sends `extra.old_session_id` and `extra.new_session_id`
//!   (`gateway/slash_commands_session.py`). Only the ending id is kept, so the
//!   session that has just begun cannot be closed by it.
//! - `on_session_start` and `on_session_end`, which Hermes fires at the end of
//!   every turn rather than at session end, carry nothing stored beyond the
//!   session id.
//!
//! A `delegate_task` child is its own Hermes agent with its own session, and
//! it fires the same lifecycle events (`tools/delegate_tool.py`). Its
//! `parent_session_id` never reaches the payload: Hermes keeps it at the top
//! level only as a `session_id` fallback. `extra.platform` is the one marker.
//!
//! Hook reference: <https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks>.

use serde_json::{Map, Value};

use crate::payload::HookEvent;

/// Part types Hermes itself drops when it flattens message content
/// (`agent/message_content.py`).
const NON_TEXT_PART_TYPES: [&str; 5] =
    ["image", "image_url", "input_image", "audio", "input_audio"];

/// Keys Hermes reads a text part's text from, in its order.
const TEXT_PART_KEYS: [&str; 5] = [
    "text",
    "content",
    "input_text",
    "output_text",
    "summary_text",
];

/// The `platform` Hermes gives a delegated child agent.
const DELEGATED_CHILD_PLATFORM: &str = "subagent";

/// Whether a Hermes lifecycle payload comes from a delegated child agent. A
/// child starts with no history, so its first `pre_llm_call` also reports
/// `is_first_turn`, and its `user_message` is the goal the parent model
/// wrote, not a user prompt.
#[must_use]
pub fn hermes_is_delegated_child(raw: &Value) -> bool {
    raw.pointer("/extra/platform")
        .and_then(Value::as_str)
        .is_some_and(|platform| platform.trim() == DELEGATED_CHILD_PLATFORM)
}

/// Whether a Hermes `pre_llm_call` payload is the first turn of its session.
/// Hermes sets `extra.is_first_turn` when the turn starts with no prior
/// history (`agent/turn_context.py`); a resumed session never sets it.
#[must_use]
pub fn hermes_is_first_turn(raw: &Value) -> bool {
    raw.pointer("/extra/is_first_turn").and_then(Value::as_bool) == Some(true)
}

/// Replace a Hermes lifecycle payload with the fields ai-memory stores, in the
/// shape the router reads. Returns whether the payload changed; tool events and
/// non-object payloads are left alone.
pub fn shape_hermes_lifecycle_body(raw: &mut Value, event: HookEvent) -> bool {
    if !matches!(
        event,
        HookEvent::SessionStart | HookEvent::UserPrompt | HookEvent::Stop | HookEvent::SessionEnd
    ) || !raw.is_object()
    {
        return false;
    }
    let extra = raw.get("extra").and_then(Value::as_object);
    let extra_string = |key: &str| {
        extra
            .and_then(|extra| extra.get(key))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
    };
    let mut shaped = Map::new();
    for key in ["hook_event_name", "cwd"] {
        if let Some(value) = raw.get(key).and_then(Value::as_str) {
            shaped.insert(key.into(), value.into());
        }
    }
    let session_id = match event {
        HookEvent::SessionEnd => extra_string("old_session_id"),
        _ => None,
    }
    .or_else(|| {
        raw.get("session_id")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
    });
    if let Some(session_id) = session_id {
        shaped.insert("session_id".into(), session_id.into());
    }
    match event {
        HookEvent::SessionStart => {
            if let Some(model) = extra_string("model") {
                shaped.insert("model".into(), model.into());
            }
        }
        HookEvent::UserPrompt => {
            if let Some(prompt) = extra
                .and_then(|extra| extra.get("user_message"))
                .and_then(prompt_text)
            {
                shaped.insert("prompt".into(), prompt.into());
            }
        }
        HookEvent::SessionEnd => {
            if let Some(reason) = extra_string("reason") {
                shaped.insert("reason".into(), reason.into());
            }
        }
        _ => {}
    }
    *raw = Value::Object(shaped);
    true
}

/// The visible text of `extra.user_message`, flattened the way Hermes does
/// it: a string as is, a list joined by line, and image or audio parts
/// dropped.
fn prompt_text(message: &Value) -> Option<String> {
    let text = match message {
        Value::Array(parts) => parts
            .iter()
            .filter_map(part_text)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        other => part_text(other)?.to_owned(),
    };
    (!text.trim().is_empty()).then_some(text)
}

fn part_text(part: &Value) -> Option<&str> {
    match part {
        Value::String(text) => Some(text),
        Value::Object(fields) => {
            let kind = fields
                .get("type")
                .and_then(Value::as_str)
                .map(|kind| kind.trim().to_ascii_lowercase());
            if kind.is_some_and(|kind| NON_TEXT_PART_TYPES.contains(&kind.as_str())) {
                return None;
            }
            TEXT_PART_KEYS
                .iter()
                .find_map(|key| fields.get(*key).and_then(Value::as_str))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn pre_llm_call(user_message: Value) -> Value {
        json!({
            "hook_event_name": "pre_llm_call",
            "tool_name": null,
            "tool_input": null,
            "session_id": "hermes-session",
            "cwd": "/home/alice",
            "profile": "default",
            "extra": {
                "task_id": "task-1",
                "turn_id": "turn-1",
                "user_message": user_message,
                "conversation_history": [
                    {"role": "user", "content": "HISTORY_SENTINEL earlier prompt"},
                    {"role": "assistant", "content": "HISTORY_SENTINEL earlier answer"}
                ],
                "is_first_turn": false,
                "model": "hermes-4",
                "platform": "cli",
                "sender_id": ""
            }
        })
    }

    #[test]
    fn prompt_keeps_the_user_message_and_never_the_history() {
        let mut raw = pre_llm_call(json!("fix the flaky test"));
        assert!(shape_hermes_lifecycle_body(&mut raw, HookEvent::UserPrompt));
        assert_eq!(
            raw,
            json!({
                "hook_event_name": "pre_llm_call",
                "cwd": "/home/alice",
                "session_id": "hermes-session",
                "prompt": "fix the flaky test"
            })
        );
        assert!(!raw.to_string().contains("HISTORY_SENTINEL"));
        assert_eq!(
            crate::payload::user_prompt_text(&raw).as_deref(),
            Some("fix the flaky test")
        );
    }

    #[test]
    fn prompt_content_parts_keep_only_their_text() {
        let mut raw = pre_llm_call(json!([
            {"type": "text", "text": "describe this"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,SECRETPIXELS"}},
            {"type": "input_audio", "input_audio": {"data": "AUDIOBYTES"}},
            "and this",
            {"type": "input_text", "input_text": "plus that"}
        ]));
        assert!(shape_hermes_lifecycle_body(&mut raw, HookEvent::UserPrompt));
        assert_eq!(raw["prompt"], "describe this\nand this\nplus that");
        let text = raw.to_string();
        assert!(!text.contains("SECRETPIXELS") && !text.contains("AUDIOBYTES"));
    }

    #[test]
    fn a_prompt_without_text_stores_no_prompt_field() {
        for message in [
            json!([{"type": "image_url", "image_url": {"url": "https://x/y.png"}}]),
            json!("   "),
            json!(null),
            json!(42),
        ] {
            let mut raw = pre_llm_call(message.clone());
            assert!(shape_hermes_lifecycle_body(&mut raw, HookEvent::UserPrompt));
            assert!(raw.get("prompt").is_none(), "{message}");
            assert!(raw.get("extra").is_none(), "{message}");
        }
    }

    #[test]
    fn first_turn_comes_only_from_a_true_flag() {
        let mut raw = pre_llm_call(json!("hi"));
        assert!(!hermes_is_first_turn(&raw));
        raw["extra"]["is_first_turn"] = json!(true);
        assert!(hermes_is_first_turn(&raw));
        raw["extra"]["is_first_turn"] = json!("true");
        assert!(!hermes_is_first_turn(&raw), "only a JSON boolean counts");
        assert!(!hermes_is_first_turn(&json!({"is_first_turn": true})));
    }

    /// Hermes sends `platform` "subagent" for a `delegate_task` child and the
    /// session's own platform otherwise; `parent_session_id` never arrives.
    #[test]
    fn delegated_child_comes_only_from_the_subagent_platform() {
        let mut raw = pre_llm_call(json!("hi"));
        assert!(!hermes_is_delegated_child(&raw));
        raw["extra"]["platform"] = json!("subagent");
        assert!(hermes_is_delegated_child(&raw));
        for platform in [
            json!("telegram"),
            json!(""),
            json!(null),
            json!(["subagent"]),
        ] {
            raw["extra"]["platform"] = platform.clone();
            assert!(!hermes_is_delegated_child(&raw), "{platform}");
        }
        assert!(!hermes_is_delegated_child(&json!({"platform": "subagent"})));
    }

    #[test]
    fn finalize_closes_the_ending_session_never_the_new_one() {
        let mut raw = json!({
            "hook_event_name": "on_session_finalize",
            "session_id": "old-session",
            "cwd": "/srv/gateway",
            "extra": {
                "platform": "telegram",
                "reason": "new_session",
                "old_session_id": "old-session",
                "new_session_id": "new-session"
            }
        });
        assert!(shape_hermes_lifecycle_body(&mut raw, HookEvent::SessionEnd));
        assert_eq!(
            raw,
            json!({
                "hook_event_name": "on_session_finalize",
                "cwd": "/srv/gateway",
                "session_id": "old-session",
                "reason": "new_session"
            })
        );
        assert!(!raw.to_string().contains("new-session"));

        // A top-level id that disagrees still loses to the ending id.
        let mut raw = json!({
            "session_id": "new-session",
            "extra": {"old_session_id": "old-session", "new_session_id": "new-session"}
        });
        shape_hermes_lifecycle_body(&mut raw, HookEvent::SessionEnd);
        assert_eq!(raw["session_id"], "old-session");

        // The CLI's shutdown finalize carries only `session_id`.
        let mut raw = json!({
            "session_id": "cli-session",
            "extra": {"platform": "cli", "reason": "shutdown"}
        });
        shape_hermes_lifecycle_body(&mut raw, HookEvent::SessionEnd);
        assert_eq!(
            raw,
            json!({"session_id": "cli-session", "reason": "shutdown"})
        );
    }

    #[test]
    fn session_start_and_turn_end_keep_only_identity() {
        let mut start = json!({
            "hook_event_name": "on_session_start",
            "session_id": "s",
            "cwd": "/w",
            "profile": "default",
            "extra": {"model": "hermes-4", "platform": "cli", "telemetry_schema_version": 1}
        });
        assert!(shape_hermes_lifecycle_body(
            &mut start,
            HookEvent::SessionStart
        ));
        assert_eq!(
            start,
            json!({"hook_event_name": "on_session_start", "cwd": "/w", "session_id": "s", "model": "hermes-4"})
        );

        let mut turn_end = json!({
            "hook_event_name": "on_session_end",
            "session_id": "s",
            "cwd": "/w",
            "extra": {"completed": true, "turn_exit_reason": "done", "task_id": "t"}
        });
        assert!(shape_hermes_lifecycle_body(&mut turn_end, HookEvent::Stop));
        assert_eq!(
            turn_end,
            json!({"hook_event_name": "on_session_end", "cwd": "/w", "session_id": "s"})
        );
    }

    #[test]
    fn tool_events_are_left_as_sent() {
        let original = json!({
            "hook_event_name": "post_tool_call",
            "tool_name": "terminal",
            "tool_input": {"command": "ls"},
            "session_id": "s",
            "cwd": "/w",
            "extra": {"result": "ok", "status": "ok"}
        });
        for event in [HookEvent::PreToolUse, HookEvent::PostToolUse] {
            let mut raw = original.clone();
            assert!(!shape_hermes_lifecycle_body(&mut raw, event));
            assert_eq!(raw, original);
        }
        let mut not_object = json!(["x"]);
        assert!(!shape_hermes_lifecycle_body(
            &mut not_object,
            HookEvent::UserPrompt
        ));
    }
}
