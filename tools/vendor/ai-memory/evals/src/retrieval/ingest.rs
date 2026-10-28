//! Replay LongMemEval haystack sessions through the real hook-ingest
//! surface (`POST /hook/batch`), at the same cadence the lifecycle hooks
//! produce in production: `session-start`, then per chat round a
//! `user-prompt-submit` (user turn) and a `stop` carrying the opt-in
//! assistant excerpt (assistant turn), then `session-end`.
//!
//! Fidelity notes, deliberately inherited from the production capture:
//!
//! - excerpts are bounded (~2 KB) at the privacy boundary, so evidence
//!   buried deeper in a single long turn is genuinely out of reach;
//! - each session's original date is prepended to turn text (production
//!   installs see wall-clock time; replayed histories must carry their
//!   own), mirroring what the official LongMemEval harness exposes to
//!   retrievers as session timestamps.
//!
//! Two ablation knobs change that shape for the decomposition (defaults
//! keep every published baseline reproducible):
//!
//! - [`DatePrefix`] moves or drops the per-turn date prefix, which takes
//!   about 40 of the 80 characters a zero-LLM session page keeps per turn;
//! - [`IngestMode`] can skip the hooks and write each haystack session as
//!   one wiki page through `POST /admin/write-page` (the real
//!   `Wiki::write_page` path), which isolates ranking from capture.

use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use serde_json::json;

use super::dataset::Question;
use super::server::EVAL_AUTH_TOKEN;

/// Everything in one benchmark run lives in this workspace.
pub const EVAL_WORKSPACE: &str = "longmemeval";

/// Server-side cap on batch items per request.
const MAX_BATCH: usize = 256;

/// Client-side mirror of the capture excerpt cap; anything longer is
/// truncated by the server anyway, and the assistant marker requires the
/// client to do the capping.
const EXCERPT_MAX_BYTES: usize = 2_000;

/// Where the replay puts each session's original date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum DatePrefix {
    /// `[session date: …]` before every turn (the published baselines).
    Turn,
    /// Once per session, as the `session-start` event's title; turns carry
    /// no prefix.
    SessionStart,
    /// Nowhere.
    None,
}

impl DatePrefix {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Turn => "turn",
            Self::SessionStart => "session-start",
            Self::None => "none",
        }
    }
}

/// How a question's haystack reaches the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum IngestMode {
    /// Replay through `/hook/batch` (the shipped capture path).
    Hooks,
    /// One page per session holding the full raw transcript: the
    /// ranking-only upper bound, comparable to whole-session harnesses.
    WholeSession,
    /// One page per session holding exactly the text capture keeps in
    /// observation bodies (user turns up to 16 KiB, assistant excerpts up
    /// to 2 KB, date prefix as configured): what an observation-evidence
    /// stream could rank on, aggregated per session.
    CapturedSession,
}

impl IngestMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Hooks => "hooks",
            Self::WholeSession => "whole-session",
            Self::CapturedSession => "captured-session",
        }
    }
}

/// Server-side user-prompt body cap (`USER_PROMPT_EXCERPT_MAX_BYTES`,
/// equal to the 16 KiB observation backstop).
const USER_PROMPT_MAX_BYTES: usize = 16 * 1024;

/// Timing and volume for one question's ingest.
#[derive(Debug, Clone, Default)]
pub struct IngestStats {
    /// Hook events posted, or pages written.
    pub items: usize,
    /// Wall clock for the whole question.
    pub elapsed: Duration,
    /// Round trip of every HTTP request (batch POST or page write).
    pub request_ms: Vec<u128>,
    /// Pages whose body exceeded the 16 KiB observation backstop (page
    /// modes only; the page write path has no such cap, see the report).
    pub docs_over_16kib: usize,
}

/// Project name for one benchmark question (its private haystack).
pub fn project_for(q: &Question) -> String {
    format!("lme-{}", q.question_id)
}

/// The stored session id for dataset session `raw` in `q`'s haystack.
///
/// LongMemEval reuses session ids across questions: 4,715 of the 23,566
/// scored haystack sessions (8 of them evidence) also sit in an earlier
/// question's haystack. Replayed under its raw id, such a session already
/// exists in the other question's project when the second replay arrives;
/// the store files its turns under the new project (follow-cwd routing)
/// but drops its `session-end` as naming a foreign scope, so the second
/// project never gets the session page. A real harness mints a fresh id
/// per session, so the replay namespaces the id by project and sends the
/// resulting UUID, which the store keeps verbatim.
pub fn stored_session_uuid(q: &Question, raw: &str) -> uuid::Uuid {
    uuid::Uuid::new_v5(
        &uuid::Uuid::NAMESPACE_OID,
        format!("{}\n{raw}", project_for(q)).as_bytes(),
    )
}

/// Truncate on a char boundary so the marker stays valid UTF-8.
fn cap_excerpt(s: &str) -> &str {
    cap_bytes(s, EXCERPT_MAX_BYTES)
}

fn cap_bytes(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Turn text as the hook replay sends it under `prefix`.
fn prefixed(prefix: DatePrefix, date: &str, text: &str) -> String {
    match prefix {
        DatePrefix::Turn => format!("[session date: {date}] {text}"),
        DatePrefix::SessionStart | DatePrefix::None => text.to_string(),
    }
}

/// One haystack session as a page body for the page ingest modes. Every
/// turn renders as `[<role>] <text>`, joined by blank lines, under a
/// `[Source session date: …]` line (the same document the grep baseline
/// scores). `CapturedSession` caps each turn the way capture does and
/// places the date exactly where the hook replay under `prefix` would.
pub fn session_document(
    mode: IngestMode,
    prefix: DatePrefix,
    date: &str,
    turns: &[super::dataset::Turn],
) -> String {
    let rendered: Vec<String> = turns
        .iter()
        .map(|t| match mode {
            IngestMode::CapturedSession => {
                let text = match t.role.as_str() {
                    "assistant" => prefixed(prefix, date, cap_excerpt(&t.content)),
                    _ => prefixed(prefix, date, &t.content),
                };
                // The server caps the whole prompt field, prefix included.
                format!("[{}] {}", t.role, cap_bytes(&text, USER_PROMPT_MAX_BYTES))
            }
            _ => format!("[{}] {}", t.role, t.content),
        })
        .collect();
    // Captured text only carries a session-level date when the replay puts
    // one on `session-start`; per-turn prefixes are already in the turns.
    let header = !(mode == IngestMode::CapturedSession
        && matches!(prefix, DatePrefix::Turn | DatePrefix::None));
    if header {
        format!("[Source session date: {date}]\n{}", rendered.join("\n\n"))
    } else {
        rendered.join("\n\n")
    }
}

#[derive(serde::Serialize)]
struct BatchItem {
    url: String,
    body: serde_json::Value,
}

/// Build the full event replay for one question's haystack.
fn build_items(q: &Question, prefix: DatePrefix) -> Vec<BatchItem> {
    let project = project_for(q);
    let cwd = format!("/lme/{project}");
    let mut items = Vec::new();
    let mut push = |event: &str, session_id: &str, extra: serde_json::Value| {
        let mut url = format!(
            "/hook?event={event}&agent=claude-code&workspace={EVAL_WORKSPACE}&project={project}&session_id={session_id}"
        );
        if event == "stop" {
            url.push_str("&capture_assistant=1");
        }
        let mut body = json!({
            "session_id": session_id,
            "cwd": cwd,
        });
        if let serde_json::Value::Object(extra) = extra {
            body.as_object_mut()
                .expect("body is an object")
                .extend(extra);
        }
        items.push(BatchItem { url, body });
    };

    for (idx, session) in q.haystack_sessions.iter().enumerate() {
        let sid = &stored_session_uuid(q, &q.haystack_session_ids[idx]).to_string();
        let date = &q.haystack_dates[idx];
        let mut start = json!({ "hook_event_name": "SessionStart", "source": "startup" });
        if prefix == DatePrefix::SessionStart {
            // The session-start title lands in the page's raw-observation
            // list, so the date stays indexed once per session.
            start["title"] = json!(format!("session date: {date}"));
        }
        push("session-start", sid, start);
        for turn in session {
            match turn.role.as_str() {
                "user" => push(
                    "user-prompt-submit",
                    sid,
                    json!({
                        "hook_event_name": "UserPromptSubmit",
                        "prompt": prefixed(prefix, date, &turn.content),
                    }),
                ),
                "assistant" => push(
                    "stop",
                    sid,
                    json!({
                        "hook_event_name": "Stop",
                        "_ai_memory_assistant": {
                            "version": 1,
                            "excerpt": prefixed(prefix, date, cap_excerpt(&turn.content)),
                        },
                    }),
                ),
                other => {
                    tracing::warn!(role = other, "unknown role in dataset; skipping turn");
                }
            }
        }
        push(
            "session-end",
            sid,
            json!({ "hook_event_name": "SessionEnd", "reason": "exit" }),
        );
    }
    items
}

/// Replay one question's haystack. Retries items the server's per-source
/// rate limiting skipped, until everything is accepted — silently missing
/// haystack data would corrupt the benchmark.
pub async fn ingest_question(
    client: &reqwest::Client,
    base_url: &str,
    q: &Question,
    prefix: DatePrefix,
) -> Result<IngestStats> {
    let started = Instant::now();
    let mut request_ms = Vec::new();
    let items = build_items(q, prefix);
    let total = items.len();
    let mut pending: Vec<&BatchItem> = items.iter().collect();
    let mut attempts = 0usize;
    while !pending.is_empty() {
        attempts += 1;
        if attempts > 60 {
            bail!(
                "question {}: {} hook items still unaccepted after {} passes",
                q.question_id,
                pending.len(),
                attempts - 1
            );
        }
        let mut next = Vec::new();
        for chunk in pending.chunks(MAX_BATCH) {
            let sent = Instant::now();
            let resp = client
                .post(format!("{base_url}/hook/batch"))
                .bearer_auth(EVAL_AUTH_TOKEN)
                .json(&chunk)
                .send()
                .await
                .context("posting hook batch")?
                .error_for_status()
                .context("hook batch rejected")?;
            let ack: serde_json::Value = resp.json().await?;
            request_ms.push(sent.elapsed().as_millis());
            let accepted: Vec<usize> = match ack.get("accepted_indices") {
                Some(serde_json::Value::Array(idx)) => idx
                    .iter()
                    .filter_map(|v| v.as_u64().map(|v| v as usize))
                    .collect(),
                _ => {
                    let prefix = ack.get("accepted").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    (0..prefix).collect()
                }
            };
            let accepted_set: std::collections::HashSet<usize> = accepted.into_iter().collect();
            for (i, item) in chunk.iter().enumerate() {
                if !accepted_set.contains(&i) {
                    next.push(*item);
                }
            }
        }
        if !next.is_empty() {
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        pending = next;
    }
    Ok(IngestStats {
        items: total,
        elapsed: started.elapsed(),
        request_ms,
        docs_over_16kib: 0,
    })
}

/// Page title for a session written by the page ingest modes. Neutral on
/// purpose: it carries the date (as the hook pages' titles do) and nothing
/// that could favour the evidence session.
fn session_page_title(date: &str) -> String {
    format!("Chat session {date}")
}

/// Write each haystack session of `q` as one page under
/// `sessions/<uuid>.md` through `POST /admin/write-page`, sequentially
/// (questions still run concurrently). A repeated session id is written
/// once, at its first occurrence.
pub async fn write_session_pages(
    client: &reqwest::Client,
    base_url: &str,
    q: &Question,
    mode: IngestMode,
    prefix: DatePrefix,
) -> Result<IngestStats> {
    let started = Instant::now();
    let project = project_for(q);
    let mut seen = std::collections::HashSet::new();
    let mut stats = IngestStats::default();
    for ((sid, date), turns) in q
        .haystack_session_ids
        .iter()
        .zip(&q.haystack_dates)
        .zip(&q.haystack_sessions)
    {
        if !seen.insert(sid.as_str()) {
            continue;
        }
        let body = session_document(mode, prefix, date, turns);
        if body.len() > USER_PROMPT_MAX_BYTES {
            stats.docs_over_16kib += 1;
        }
        let request = json!({
            "workspace": EVAL_WORKSPACE,
            "project": project,
            "path": format!("sessions/{}.md", stored_session_uuid(q, sid)),
            "title": session_page_title(date),
            "body": body,
            // Hook-synthesised session pages are episodic too.
            "tier": "episodic",
        });
        let sent = Instant::now();
        client
            .post(format!("{base_url}/admin/write-page"))
            .bearer_auth(EVAL_AUTH_TOKEN)
            .json(&request)
            .send()
            .await
            .context("posting write-page")?
            .error_for_status()
            .with_context(|| format!("write-page rejected for {sid}"))?;
        stats.request_ms.push(sent.elapsed().as_millis());
        stats.items += 1;
    }
    stats.elapsed = started.elapsed();
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::retrieval::dataset::Turn;

    fn q() -> Question {
        serde_json::from_value(serde_json::json!({
            "question_id": "qX",
            "question_type": "single-session-user",
            "question": "?",
            "answer": "a",
            "question_date": "d",
            "haystack_dates": ["2023/05/20 (Sat) 02:21"],
            "haystack_session_ids": ["sharegpt_abc_0"],
            "haystack_sessions": [[
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "hi"}
            ]],
            "answer_session_ids": ["sharegpt_abc_0"]
        }))
        .unwrap()
    }

    #[test]
    fn replay_matches_the_production_hook_cadence() {
        let items = build_items(&q(), DatePrefix::Turn);
        let events: Vec<&str> = items
            .iter()
            .map(|i| {
                i.url
                    .split("event=")
                    .nth(1)
                    .unwrap()
                    .split('&')
                    .next()
                    .unwrap()
            })
            .collect();
        assert_eq!(
            events,
            ["session-start", "user-prompt-submit", "stop", "session-end"]
        );
        // stop carries the opt-in marker and the capture flag
        let stop = &items[2];
        assert!(stop.url.contains("capture_assistant=1"));
        assert_eq!(stop.body["_ai_memory_assistant"]["version"], 1);
        // every item scopes explicitly
        for item in &items {
            assert!(item.url.contains("workspace=longmemeval"));
            assert!(item.url.contains("project=lme-qX"));
        }
    }

    #[test]
    fn session_dates_are_visible_to_the_retriever() {
        let items = build_items(&q(), DatePrefix::Turn);
        let prompt = items[1].body["prompt"].as_str().unwrap();
        assert!(prompt.starts_with("[session date: 2023/05/20"));
    }

    #[test]
    fn excerpts_are_capped_on_char_boundaries() {
        let long = format!("{}é", "x".repeat(EXCERPT_MAX_BYTES - 1));
        let capped = cap_excerpt(&long);
        assert!(capped.len() <= EXCERPT_MAX_BYTES);
        assert!(std::str::from_utf8(capped.as_bytes()).is_ok());
    }

    #[test]
    fn replayed_session_ids_are_per_question_uuids() {
        let first = q();
        let mut second = q();
        second.question_id = "qY".into();
        let a = stored_session_uuid(&first, "sharegpt_abc_0");
        let b = stored_session_uuid(&second, "sharegpt_abc_0");
        // A session shared by two haystacks must not share a stored id.
        assert_ne!(a, b);
        assert_eq!(a, stored_session_uuid(&first, "sharegpt_abc_0"));
        // The replay sends the UUID itself, which the store keeps verbatim.
        for item in build_items(&first, DatePrefix::Turn) {
            assert_eq!(
                item.body["session_id"].as_str(),
                Some(a.to_string().as_str())
            );
            assert!(item.url.contains(&format!("session_id={a}")));
        }
    }

    #[test]
    fn unknown_roles_are_skipped_not_mislabelled() {
        let mut question = q();
        question.haystack_sessions[0].push(Turn {
            role: "system".into(),
            content: "x".into(),
            has_answer: None,
        });
        let items = build_items(&question, DatePrefix::Turn);
        // still start, prompt, stop, end — the system turn produced nothing
        assert_eq!(items.len(), 4);
    }

    #[test]
    fn session_start_prefix_moves_the_date_off_the_turns() {
        let items = build_items(&q(), DatePrefix::SessionStart);
        assert_eq!(
            items[0].body["title"].as_str(),
            Some("session date: 2023/05/20 (Sat) 02:21")
        );
        assert_eq!(items[1].body["prompt"].as_str(), Some("hello"));
        assert_eq!(
            items[2].body["_ai_memory_assistant"]["excerpt"].as_str(),
            Some("hi")
        );
    }

    #[test]
    fn no_date_prefix_leaves_turns_and_session_start_bare() {
        let items = build_items(&q(), DatePrefix::None);
        assert!(items[0].body.get("title").is_none());
        assert_eq!(items[1].body["prompt"].as_str(), Some("hello"));
    }

    #[test]
    fn whole_session_documents_keep_every_byte_of_every_turn() {
        let long = "y".repeat(EXCERPT_MAX_BYTES * 3);
        let turns = vec![
            Turn {
                role: "user".into(),
                content: "hello".into(),
                has_answer: None,
            },
            Turn {
                role: "assistant".into(),
                content: long.clone(),
                has_answer: None,
            },
        ];
        let doc = session_document(IngestMode::WholeSession, DatePrefix::Turn, "D", &turns);
        assert_eq!(
            doc,
            format!("[Source session date: D]\n[user] hello\n\n[assistant] {long}")
        );
    }

    #[test]
    fn captured_session_documents_apply_the_capture_caps_and_prefix() {
        let turns = vec![
            Turn {
                role: "user".into(),
                content: "u".repeat(USER_PROMPT_MAX_BYTES + 10),
                has_answer: None,
            },
            Turn {
                role: "assistant".into(),
                content: "a".repeat(EXCERPT_MAX_BYTES + 10),
                has_answer: None,
            },
        ];
        let doc = session_document(IngestMode::CapturedSession, DatePrefix::Turn, "D", &turns);
        let parts: Vec<&str> = doc.split("\n\n").collect();
        let user = parts[0].strip_prefix("[user] ").unwrap();
        assert!(user.starts_with("[session date: D] u"));
        assert_eq!(user.len(), USER_PROMPT_MAX_BYTES);
        let assistant = parts[1]
            .strip_prefix("[assistant] [session date: D] ")
            .unwrap();
        assert_eq!(assistant.len(), EXCERPT_MAX_BYTES);

        let bare = session_document(IngestMode::CapturedSession, DatePrefix::None, "D", &turns);
        assert!(bare.starts_with("[user] uuu"));
        let once = session_document(
            IngestMode::CapturedSession,
            DatePrefix::SessionStart,
            "D",
            &turns,
        );
        assert!(once.starts_with("[Source session date: D]\n[user] uuu"));
    }
}
