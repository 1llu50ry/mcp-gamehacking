//! `[capture] ignore_paths` for imported native transcripts.
//!
//! `ai-memory backfill` and the `ai-memory run` ledger read a harness's own
//! transcript instead of receiving hook events, so the live hook's capture
//! policy never saw those tool calls. This applies the same decision table
//! rather than a second matcher: each recorded tool call is rebuilt in its
//! agent's hook shape (`tool_call_payload`) and inspected by the checkout's
//! `CapturePolicy`, resolved from the working directory its own record names
//! when the adapter keeps one; a call the live hook would reroute to another
//! checkout also answers to that checkout's admission gate, server route,
//! project scope and policy; and each tool result inherits the decision of the
//! call it answers.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use ai_memory_core::{AgentKind, NewWorkstreamEvent, WorkstreamEventKind};
use ai_memory_hooks::{
    CaptureDecision, CaptureDisposition, CapturePolicy, PolicyState, ToolFamily, tool_call_payload,
    valid_call_id,
};
use ai_memory_workstream::{RECORD_CWD_KEY, SKIPPED_RECORD_KEY};
use serde_json::Value;

use super::hook::{
    checkout_admits_capture, delivers_to_same_server, foreign_capture_decision,
    lexical_capture_cwd, routes_to_same_project, tool_location_routing_cwd,
};
use super::hook_capture::capture_policy;

/// What an import does with one transcript event.
#[derive(Clone, Debug)]
pub(crate) enum EventCapture {
    /// Import the event as recorded.
    Keep,
    /// Import nothing for this event.
    Drop,
    /// A tool the capture policy does not recognize: record that it ran,
    /// never its arguments or output. The live server stores only the family
    /// for an unknown-family tool, plus an MCP tool's validated server and
    /// tool names, whatever the policy, so an import must not store more.
    Unrecognized,
    /// Record that the tool ran, never its arguments or output.
    MetadataOnly(CaptureDecision),
}

impl EventCapture {
    const fn rank(&self) -> u8 {
        match self {
            Self::Keep => 0,
            Self::Unrecognized => 1,
            Self::MetadataOnly(_) => 2,
            Self::Drop => 3,
        }
    }

    fn stricter(self, other: Self) -> Self {
        if other.rank() > self.rank() {
            other
        } else {
            self
        }
    }

    fn from_decision(decision: CaptureDecision) -> Self {
        match decision.protocol().disposition() {
            CaptureDisposition::Keep => Self::Keep,
            CaptureDisposition::Drop => Self::Drop,
            CaptureDisposition::MetadataOnly => Self::MetadataOnly(decision),
        }
    }
}

/// The capture policy of the checkout a transcript was recorded in.
pub(crate) struct TranscriptCapture {
    data_dir: PathBuf,
    admitted: bool,
    policy: CapturePolicy,
    cwd: String,
    inspection_cwd: String,
}

impl TranscriptCapture {
    /// Resolve the live hook's admission gate (this install's capture mode
    /// under `data_dir`) and the nearest marker's policy for `cwd`, exactly as
    /// the hook does for an event reporting that cwd.
    pub(crate) fn for_checkout(data_dir: &Path, cwd: &Path) -> Self {
        let cwd = cwd.to_string_lossy().into_owned();
        Self {
            data_dir: data_dir.to_path_buf(),
            admitted: checkout_admits_capture(data_dir, &cwd),
            policy: capture_policy(&cwd),
            inspection_cwd: lexical_capture_cwd(&cwd),
            cwd,
        }
    }

    /// Whether the live hook would emit anything at all from this checkout.
    /// Under allowlist capture mode an unmarked checkout admits nothing.
    pub(crate) const fn admits_capture(&self) -> bool {
        self.admitted
    }

    /// One decision per event, in transcript order. A checkout the hook's
    /// admission gate refuses drops every event, prompts included, as the
    /// live hook emits none. Otherwise messages are kept, as live prompt
    /// capture keeps them, except the output of a Claude Code `!` shell
    /// command, which live capture never receives.
    ///
    /// An event whose record names its own working directory is judged from
    /// there, as the live hook judges an event by its own `cwd`: that
    /// directory must pass the same admission gate, deliver to the same server
    /// and resolve to the same project as this checkout, or the event is
    /// dropped.
    ///
    /// A result answers the call with the same native id. Some adapters record
    /// no id, so a result without one takes the strictest decision of every
    /// call since the last user message: parallel calls may answer out of
    /// order, and a positional guess could hand an excluded read's output the
    /// decision of a public one. A result whose id matches no recorded call,
    /// or with no call at all, is an orphan: dropped under a policy, since
    /// nothing proves it missed every ignored path, and content-free without
    /// one. A record the exporter skipped as oversized could have been one of
    /// the turn's calls, so its marker counts as an orphan call there and an
    /// id-less result of that turn fails closed with it.
    pub(crate) fn decide(&self, events: &[NewWorkstreamEvent]) -> Vec<EventCapture> {
        if !self.admitted {
            return vec![EventCapture::Drop; events.len()];
        }
        // Codex's own memory-writing agent runs from `$CODEX_HOME/memories`;
        // the live hook drops those events (#1674), so an import of the same
        // run must not reintroduce them.
        if ai_memory_core::is_codex_memory_agent_cwd(&self.cwd) {
            return vec![EventCapture::Drop; events.len()];
        }
        let mut elsewhere = HashMap::new();
        let mut by_id: HashMap<&str, EventCapture> = HashMap::new();
        let mut turn: Vec<EventCapture> = Vec::new();
        let mut out = Vec::with_capacity(events.len());
        for event in events {
            let cwd = record_cwd(event).unwrap_or(&self.cwd);
            let admitted = cwd == self.cwd || self.admits_elsewhere(cwd, &mut elsewhere);
            let capture = match event.kind {
                WorkstreamEventKind::ToolCall => {
                    let capture = if admitted {
                        self.decide_call(event, cwd, &mut elsewhere)
                    } else {
                        EventCapture::Drop
                    };
                    if let Some(id) = call_id(event) {
                        by_id.insert(id, capture.clone());
                    }
                    turn.push(capture.clone());
                    capture
                }
                WorkstreamEventKind::ToolResult if !admitted => EventCapture::Drop,
                WorkstreamEventKind::ToolResult => match call_id(event) {
                    Some(id) => by_id
                        .get(id)
                        .cloned()
                        .unwrap_or_else(|| self.orphan_result()),
                    None => turn
                        .iter()
                        .cloned()
                        .reduce(EventCapture::stricter)
                        .unwrap_or_else(|| self.orphan_result()),
                },
                WorkstreamEventKind::Message => {
                    if matches!(event.role.as_deref(), Some("user" | "human")) {
                        turn.clear();
                    }
                    if admitted && !shell_mode_output(event) {
                        EventCapture::Keep
                    } else {
                        EventCapture::Drop
                    }
                }
                WorkstreamEventKind::Compaction
                | WorkstreamEventKind::Checkpoint
                | WorkstreamEventKind::Annotation => {
                    if skipped_record(event) {
                        turn.push(self.orphan_result());
                    }
                    if admitted {
                        EventCapture::Keep
                    } else {
                        EventCapture::Drop
                    }
                }
            };
            out.push(capture);
        }
        out
    }

    /// Keep the import's events the policy keeps, and strip the ones it makes
    /// metadata-only, so excluded tool content never enters the run ledger.
    pub(crate) fn filter_ledger_events(
        &self,
        events: Vec<NewWorkstreamEvent>,
    ) -> Vec<NewWorkstreamEvent> {
        let decisions = self.decide(&events);
        events
            .into_iter()
            .zip(decisions)
            .filter_map(|(event, capture)| match capture {
                EventCapture::Keep => Some(event),
                EventCapture::Drop => None,
                EventCapture::Unrecognized => Some(withheld(event, ToolFamily::Unknown)),
                EventCapture::MetadataOnly(decision) => {
                    Some(withheld(event, decision.protocol().tool_family()))
                }
            })
            .map(|mut event| {
                // The record's cwd only steers the decision above.
                if let Some(metadata) = event.metadata.as_object_mut() {
                    metadata.remove(RECORD_CWD_KEY);
                }
                event
            })
            .collect()
    }

    /// A result with no call to inherit from. Nothing proves its tool was
    /// recognized, so even without a policy it keeps no output.
    fn orphan_result(&self) -> EventCapture {
        if self.policy.state() == PolicyState::Inactive {
            EventCapture::Unrecognized
        } else {
            EventCapture::Drop
        }
    }

    /// Whether the live hook would deliver an event reported from `cwd`, a
    /// directory other than this checkout's, to this import's server and
    /// project at all: the hook's admission gate there (capture mode, marker
    /// opt-in, readable routing marker), the same server-profile route, and
    /// the same project scope. The import files everything under this
    /// checkout's project, so an event the hook would file under another one
    /// is left out rather than misfiled.
    fn admits_elsewhere(&self, cwd: &str, seen: &mut HashMap<String, bool>) -> bool {
        *seen.entry(cwd.to_owned()).or_insert_with(|| {
            checkout_admits_capture(&self.data_dir, cwd)
                && delivers_to_same_server(&self.data_dir, &self.cwd, cwd)
                && routes_to_same_project(&self.cwd, cwd)
        })
    }

    /// Judge one call as the live hook would for an event reporting `cwd`,
    /// under this checkout's policy too, since the import stays in this scope.
    fn decide_call(
        &self,
        event: &NewWorkstreamEvent,
        cwd: &str,
        elsewhere: &mut HashMap<String, bool>,
    ) -> EventCapture {
        let (name, args) = recorded_call(event);
        let unreadable = args.is_none();
        let raw = tool_call_payload(event.agent, name, args.as_ref(), call_id(event));
        let recognized = self
            .policy
            .inspect(event.agent, &raw, &self.inspection_cwd)
            .protocol()
            .tool_family()
            != ToolFamily::Unknown;
        let inspect = |policy: &CapturePolicy, cwd: &str| {
            inspect_call(
                policy,
                event.agent,
                &raw,
                &lexical_capture_cwd(cwd),
                unreadable,
            )
        };
        let mut capture = if cwd == self.cwd {
            inspect_call(
                &self.policy,
                event.agent,
                &raw,
                &self.inspection_cwd,
                unreadable,
            )
        } else {
            inspect(&self.policy, cwd).stricter(inspect(&capture_policy(cwd), cwd))
        };
        // The live hook would deliver this call to that checkout under its
        // admission gate, route and policy. An import stays in this scope, so
        // both policies apply, and a destination the hook would refuse or send
        // to another server drops the call.
        if let Some(destination) = tool_location_routing_cwd(event.agent, &raw, cwd) {
            if !self.admits_elsewhere(&destination, elsewhere) {
                return EventCapture::Drop;
            }
            capture = capture.stricter(inspect(&capture_policy(&destination), &destination));
        }
        // Another checkout's `ignore_paths` hold for a call made here too,
        // as in the live hook.
        if let Some(foreign) = foreign_capture_decision(
            event.agent,
            &raw,
            &lexical_capture_cwd(cwd),
            crate::marker::find_marker(cwd).as_deref(),
        ) {
            capture = capture.stricter(EventCapture::from_decision(foreign));
        }
        if recognized {
            capture
        } else {
            capture.stricter(EventCapture::Unrecognized)
        }
    }
}

/// One policy's decision for a rebuilt call. A shell command cut by the
/// adapter's size cap, or recorded as unparseable text, cannot be matched, and
/// its output may name any path.
fn inspect_call(
    policy: &CapturePolicy,
    agent: AgentKind,
    raw: &Value,
    inspection_cwd: &str,
    unreadable: bool,
) -> EventCapture {
    let decision = policy.inspect(agent, raw, inspection_cwd);
    if unreadable
        && decision.protocol().tool_family() == ToolFamily::NonFile
        && policy.state() != PolicyState::Inactive
    {
        return EventCapture::Drop;
    }
    EventCapture::from_decision(decision)
}

/// The absolute working directory the event's own record names, if any.
fn record_cwd(event: &NewWorkstreamEvent) -> Option<&str> {
    event
        .metadata
        .get(RECORD_CWD_KEY)
        .and_then(Value::as_str)
        .filter(|cwd| Path::new(cwd).is_absolute())
}

/// Claude Code records a `!` shell command's output as a user message that
/// opens with one of these blocks. Live capture never receives that output.
/// The opening tag decides alone: the output is arbitrary text, so it can
/// hold a closing tag of its own, and no reading of where a block ends is
/// safe.
fn shell_mode_output(event: &NewWorkstreamEvent) -> bool {
    const TAGS: [&str; 4] = [
        "<bash-stdout>",
        "<bash-stderr>",
        "<local-command-stdout>",
        "<local-command-stderr>",
    ];
    event.agent == AgentKind::ClaudeCode
        && TAGS
            .iter()
            .any(|tag| event.content.trim_start().starts_with(tag))
}

/// Whether the event is the exporter's marker for a record it skipped as
/// oversized.
fn skipped_record(event: &NewWorkstreamEvent) -> bool {
    event.kind == WorkstreamEventKind::Annotation
        && event
            .metadata
            .get(SKIPPED_RECORD_KEY)
            .and_then(Value::as_bool)
            == Some(true)
}

/// The native id linking a tool call and its result, when the adapter kept one.
fn call_id(event: &NewWorkstreamEvent) -> Option<&str> {
    ["tool_use_id", "tool_call_id"]
        .iter()
        .find_map(|key| event.metadata.get(*key).and_then(Value::as_str))
        .filter(|id| !id.is_empty())
}

/// The tool name and arguments of a recorded call. Adapters write a call as
/// `{name}: {arguments}`, the arguments usually JSON. `None` means they could
/// not be recovered: truncated, or recorded as plain text.
fn recorded_call(event: &NewWorkstreamEvent) -> (&str, Option<Value>) {
    let name = event
        .metadata
        .get("tool")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .or_else(|| event.content.split_once(": ").map(|(name, _)| name))
        .unwrap_or("");
    let args = event
        .content
        .strip_prefix(name)
        .and_then(|rest| rest.strip_prefix(':'))
        .map(str::trim)
        .and_then(|rest| {
            if rest.is_empty() {
                Some(Value::Null)
            } else {
                serde_json::from_str(rest).ok()
            }
        });
    (name, args)
}

/// A ledger event with its content replaced by the tool family, keeping only
/// what the live server keeps for such an event: the family and a call id
/// that passes its validation, never the tool's own name.
fn withheld(mut event: NewWorkstreamEvent, family: ToolFamily) -> NewWorkstreamEvent {
    let family = serde_json::to_value(family)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown".to_owned());
    let half = if event.kind == WorkstreamEventKind::ToolCall {
        "call"
    } else {
        "output"
    };
    event.content = format!("[{family} tool {half} withheld by the capture policy]");
    let mut metadata = serde_json::Map::new();
    for key in ["tool_use_id", "tool_call_id"] {
        if let Some(value) = event
            .metadata
            .get(key)
            .filter(|value| value.as_str().is_some_and(valid_call_id))
        {
            metadata.insert(key.into(), value.clone());
        }
    }
    event.metadata = Value::Object(metadata);
    event
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn event(
        kind: WorkstreamEventKind,
        role: &str,
        content: &str,
        metadata: Value,
    ) -> NewWorkstreamEvent {
        NewWorkstreamEvent {
            event_id: "evt".into(),
            agent: AgentKind::ClaudeCode,
            native_session_id: "sid".into(),
            source_record_id: None,
            kind,
            role: Some(role.into()),
            content: content.into(),
            occurred_at: None,
            metadata,
        }
    }

    fn checkout(ignore: Option<&str>) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        if let Some(pattern) = ignore {
            std::fs::write(
                dir.path().join(".ai-memory.toml"),
                format!("[capture]\nignore_paths = [\"{pattern}\"]\n"),
            )
            .unwrap();
        }
        dir
    }

    fn read_call(path: &Path, id: Option<&str>) -> NewWorkstreamEvent {
        let mut metadata = json!({"tool": "Read"});
        if let Some(id) = id {
            metadata["tool_use_id"] = id.into();
        }
        event(
            WorkstreamEventKind::ToolCall,
            "assistant",
            &format!("Read: {}", json!({"file_path": path})),
            metadata,
        )
    }

    fn result(content: &str, id: Option<&str>) -> NewWorkstreamEvent {
        let metadata = id.map_or_else(|| json!({}), |id| json!({"tool_use_id": id}));
        event(WorkstreamEventKind::ToolResult, "tool", content, metadata)
    }

    fn kinds(captures: &[EventCapture]) -> Vec<&'static str> {
        captures
            .iter()
            .map(|capture| match capture {
                EventCapture::Keep => "keep",
                EventCapture::Drop => "drop",
                EventCapture::Unrecognized => "unrecognized",
                EventCapture::MetadataOnly(_) => "metadata",
            })
            .collect()
    }

    /// Paired by id, an excluded read drops both halves while a public read in
    /// the same turn is kept — even when the results answer out of order.
    #[test]
    fn an_excluded_read_drops_its_call_and_result_by_id() {
        let repo = checkout(Some("docs/adr/**"));
        let capture = TranscriptCapture::for_checkout(repo.path(), repo.path());
        let events = [
            event(WorkstreamEventKind::Message, "user", "read both", json!({})),
            read_call(&repo.path().join("docs/adr/1.md"), Some("adr")),
            read_call(&repo.path().join("src/lib.rs"), Some("pub")),
            result("public code", Some("pub")),
            result("ADR secret", Some("adr")),
            event(WorkstreamEventKind::Message, "assistant", "done", json!({})),
        ];
        assert_eq!(
            kinds(&capture.decide(&events)),
            ["keep", "drop", "keep", "keep", "drop", "keep"]
        );
    }

    /// Without ids, a result takes the strictest decision of its turn, so a
    /// reordered pair cannot leak; the next user turn starts clean.
    #[test]
    fn id_less_results_take_the_strictest_call_of_their_turn() {
        let repo = checkout(Some("docs/adr/**"));
        let capture = TranscriptCapture::for_checkout(repo.path(), repo.path());
        let events = [
            event(WorkstreamEventKind::Message, "user", "turn one", json!({})),
            read_call(&repo.path().join("docs/adr/1.md"), None),
            read_call(&repo.path().join("src/lib.rs"), None),
            result("public code", None),
            result("ADR secret", None),
            event(WorkstreamEventKind::Message, "user", "turn two", json!({})),
            read_call(&repo.path().join("src/lib.rs"), None),
            result("public code again", None),
        ];
        assert_eq!(
            kinds(&capture.decide(&events)),
            [
                "keep", "drop", "keep", "drop", "drop", "keep", "keep", "keep"
            ]
        );
    }

    /// A record the exporter skipped as oversized may have been an excluded
    /// call (a large write under an ignored path) whose result follows with
    /// no id. Its marker makes that result an orphan instead of letting a
    /// public sibling call lend it a keep; the next user turn starts clean.
    /// Control: the same turn without the marker keeps the result.
    #[test]
    fn a_skipped_record_makes_the_id_less_results_of_its_turn_orphans() {
        let skipped = || {
            event(
                WorkstreamEventKind::Annotation,
                "assistant",
                "a transcript record over the per-record size cap was skipped",
                json!({ SKIPPED_RECORD_KEY: true }),
            )
        };
        for (marker, orphan) in [(Some("secrets/**"), "drop"), (None, "unrecognized")] {
            let repo = checkout(marker);
            let capture = TranscriptCapture::for_checkout(repo.path(), repo.path());
            let turn = |gap: Option<NewWorkstreamEvent>| {
                let mut events = vec![
                    event(WorkstreamEventKind::Message, "user", "do it", json!({})),
                    read_call(&repo.path().join("src/lib.rs"), None),
                    result("public code", None),
                ];
                events.extend(gap);
                events.push(result("SKIPPEDSENTINEL wrote secrets/dump.json", None));
                events.extend([
                    event(WorkstreamEventKind::Message, "user", "next", json!({})),
                    read_call(&repo.path().join("src/lib.rs"), None),
                    result("public code again", None),
                ]);
                events
            };
            let events = turn(Some(skipped()));
            assert_eq!(
                kinds(&capture.decide(&events)),
                [
                    "keep", "keep", "keep", "keep", orphan, "keep", "keep", "keep"
                ],
                "{marker:?}"
            );
            let uploaded = serde_json::to_string(&capture.filter_ledger_events(events)).unwrap();
            assert!(!uploaded.contains("SKIPPEDSENTINEL"), "{uploaded}");
            assert!(uploaded.contains("public code again"), "{uploaded}");
            assert_eq!(
                kinds(&capture.decide(&turn(None))),
                ["keep", "keep", "keep", "keep", "keep", "keep", "keep"],
                "{marker:?}: without a gap the turn's public call decides"
            );
        }
    }

    #[test]
    fn unrecoverable_arguments_and_orphan_results_fail_closed_under_a_policy() {
        let repo = checkout(Some("docs/adr/**"));
        let capture = TranscriptCapture::for_checkout(repo.path(), repo.path());
        let truncated_shell = event(
            WorkstreamEventKind::ToolCall,
            "assistant",
            "Bash: {\"command\":\"cat docs/adr/1.md && echo",
            json!({"tool": "Bash"}),
        );
        let truncated_read = event(
            WorkstreamEventKind::ToolCall,
            "assistant",
            "Read: {\"file_path\":\"docs/ad",
            json!({"tool": "Read"}),
        );
        assert_eq!(
            kinds(&capture.decide(&[
                truncated_shell,
                truncated_read,
                event(WorkstreamEventKind::Message, "user", "next", json!({})),
                result("orphan output", None),
            ])),
            ["drop", "metadata", "keep", "drop"]
        );
    }

    /// No marker: a recognized call and its id-less result are kept; a result
    /// whose id answers no recorded call is an orphan and keeps no content.
    #[test]
    fn without_a_policy_every_event_is_kept() {
        let repo = checkout(None);
        let capture = TranscriptCapture::for_checkout(repo.path(), repo.path());
        let events = [
            read_call(&repo.path().join("docs/adr/1.md"), None),
            result("ADR text", None),
            result("orphan", Some("missing")),
        ];
        assert_eq!(
            kinds(&capture.decide(&events)),
            ["keep", "keep", "unrecognized"]
        );
    }

    /// Codex's memory-writing agent runs from `$CODEX_HOME/memories`, and the
    /// live hook drops every event of that run (#1674). An import must not
    /// reintroduce what the hook refused: all events drop, prompts included,
    /// while an ordinary checkout in the same import keeps them.
    #[test]
    fn an_import_of_codex_memory_agent_runs_captures_nothing() {
        let home = tempfile::tempdir().unwrap();
        let memories = home.path().join(".codex").join("memories");
        std::fs::create_dir_all(&memories).unwrap();
        let capture = TranscriptCapture::for_checkout(home.path(), &memories);
        let events = [
            event(
                WorkstreamEventKind::Message,
                "user",
                "consolidate",
                json!({}),
            ),
            read_call(&memories.join("notes.md"), None),
            result("notes", None),
        ];
        assert_eq!(kinds(&capture.decide(&events)), ["drop", "drop", "drop"]);

        let repo = checkout(None);
        let control = TranscriptCapture::for_checkout(repo.path(), repo.path());
        let events = [event(
            WorkstreamEventKind::Message,
            "user",
            "please fix the test",
            json!({}),
        )];
        assert_eq!(kinds(&control.decide(&events)), ["keep"]);
    }

    /// A result carrying an id that matches no recorded call follows the
    /// orphan rule, not the turn's decision: a public read in the same turn
    /// must not lend it a keep. Control: the read's own result is kept.
    #[test]
    fn a_result_whose_id_matches_no_call_is_an_orphan() {
        for (marker, orphan) in [(Some("docs/adr/**"), "drop"), (None, "unrecognized")] {
            let repo = checkout(marker);
            let capture = TranscriptCapture::for_checkout(repo.path(), repo.path());
            let events = [
                event(WorkstreamEventKind::Message, "user", "read", json!({})),
                read_call(&repo.path().join("src/lib.rs"), Some("pub")),
                result("public code", Some("pub")),
                result("ORPHANSENTINEL", Some("never-called")),
            ];
            assert_eq!(
                kinds(&capture.decide(&events)),
                ["keep", "keep", "keep", orphan],
                "{marker:?}"
            );
            let uploaded =
                serde_json::to_string(&capture.filter_ledger_events(events.into())).unwrap();
            assert!(!uploaded.contains("ORPHANSENTINEL"), "{uploaded}");
            assert!(uploaded.contains("public code"), "{uploaded}");
        }
    }

    /// A read whose absolute target is another marked checkout of the same
    /// project answers to that checkout's `ignore_paths` too, as the live
    /// hook's reroute would.
    #[test]
    fn a_call_into_another_checkout_honors_its_policy() {
        let base = tempfile::tempdir().unwrap();
        let scope = "workspace = \"w\"\nproject = \"p\"\n";
        let source = marked(&base.path().join("source"), scope);
        let other = marked(
            &base.path().join("other"),
            &format!("{scope}[capture]\nignore_paths = [\"private/**\"]\n"),
        );
        let capture = TranscriptCapture::for_checkout(base.path(), &source);
        let events = [
            read_call(&other.join("private/key.txt"), Some("a")),
            result("private", Some("a")),
            read_call(&other.join("open.txt"), Some("b")),
            result("open", Some("b")),
        ];
        assert_eq!(
            kinds(&capture.decide(&events)),
            ["drop", "drop", "keep", "keep"]
        );
    }

    /// A shell command run here that names another checkout's excluded file
    /// answers to that checkout's policy on import too, as in the live hook;
    /// one naming its public file is kept.
    #[test]
    fn a_shell_command_naming_another_checkouts_file_honors_its_policy() {
        let source = checkout(None);
        let other = checkout(Some("private/**"));
        let capture = TranscriptCapture::for_checkout(source.path(), source.path());
        let bash = |path: PathBuf, id: &str| {
            event(
                WorkstreamEventKind::ToolCall,
                "assistant",
                &format!(
                    "Bash: {}",
                    json!({"command": format!("cat {}", path.display())})
                ),
                json!({"tool": "Bash", "tool_use_id": id}),
            )
        };
        let events = [
            bash(other.path().join("private/key.txt"), "a"),
            result("private", Some("a")),
            bash(other.path().join("open.txt"), "b"),
            result("open", Some("b")),
        ];
        assert_eq!(
            kinds(&capture.decide(&events)),
            ["drop", "drop", "keep", "keep"]
        );
    }

    /// A search, a directory glob or an `apply_patch` recorded here that
    /// reaches a sibling checkout's excluded file answers to that checkout's
    /// policy on import too, as in the live hook. The same tools kept to this
    /// checkout are imported whole.
    #[test]
    fn globs_and_searches_reaching_another_checkout_honor_its_policy() {
        let parent = tempfile::tempdir().unwrap();
        let (a, b) = (parent.path().join("a"), parent.path().join("b"));
        for dir in [&a, &b] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(
            a.join(".ai-memory.toml"),
            "[capture]\nignore_paths = [\"secrets.env\"]\n",
        )
        .unwrap();
        let capture = TranscriptCapture::for_checkout(parent.path(), &b);
        let call = |tool: &str, input: Value, id: &str| {
            event(
                WorkstreamEventKind::ToolCall,
                "assistant",
                &format!("{tool}: {input}"),
                json!({"tool": tool, "tool_use_id": id}),
            )
        };
        let events = [
            call(
                "Grep",
                json!({"pattern": "KEY", "path": "../a/secrets.env"}),
                "a",
            ),
            result("secret", Some("a")),
            call("Bash", json!({"command": "cat ../*/secrets.env"}), "b"),
            result("secret", Some("b")),
            call("Glob", json!({"pattern": "../a/*.env"}), "c"),
            result("secret", Some("c")),
            call("Grep", json!({"pattern": "KEY", "path": "src"}), "d"),
            result("own", Some("d")),
            call("Bash", json!({"command": "ls src/*"}), "e"),
            result("own", Some("e")),
        ];
        assert_eq!(
            kinds(&capture.decide(&events)),
            [
                "drop", "drop", "drop", "drop", "drop", "drop", "keep", "keep", "keep", "keep"
            ]
        );
    }

    /// Under allowlist capture mode the live hook emits nothing — prompts
    /// included — from a checkout without a marker; an import drops every
    /// event there. A marked checkout and the default denylist mode keep them.
    #[test]
    fn allowlist_mode_admits_nothing_from_an_unmarked_checkout() {
        let allowlist = tempfile::tempdir().unwrap();
        std::fs::write(
            allowlist.path().join(super::super::hook::CAPTURE_MODE_FILE),
            "allowlist\n",
        )
        .unwrap();
        let denylist = tempfile::tempdir().unwrap();
        let unmarked = checkout(None);
        let marked = checkout(Some("docs/adr/**"));
        let events = |repo: &Path| {
            vec![
                event(WorkstreamEventKind::Message, "user", "a prompt", json!({})),
                read_call(&repo.join("src/lib.rs"), Some("pub")),
                result("public code", Some("pub")),
                event(WorkstreamEventKind::Message, "assistant", "done", json!({})),
            ]
        };

        let refused = TranscriptCapture::for_checkout(allowlist.path(), unmarked.path());
        assert!(!refused.admits_capture());
        assert_eq!(
            kinds(&refused.decide(&events(unmarked.path()))),
            ["drop", "drop", "drop", "drop"]
        );
        assert!(
            refused
                .filter_ledger_events(events(unmarked.path()))
                .is_empty()
        );

        let opted_in = TranscriptCapture::for_checkout(allowlist.path(), marked.path());
        assert!(opted_in.admits_capture());
        assert_eq!(
            kinds(&opted_in.decide(&events(marked.path()))),
            ["keep", "keep", "keep", "keep"]
        );
        let default = TranscriptCapture::for_checkout(denylist.path(), unmarked.path());
        assert!(default.admits_capture());
        assert_eq!(
            kinds(&default.decide(&events(unmarked.path()))),
            ["keep", "keep", "keep", "keep"]
        );
    }

    fn at(mut event: NewWorkstreamEvent, cwd: &Path) -> NewWorkstreamEvent {
        event.metadata[RECORD_CWD_KEY] = cwd.to_string_lossy().into_owned().into();
        event
    }

    /// The live hook judges every event — prompts included — by its own
    /// `cwd`. A record written after the session moved into a repository
    /// the hook would not capture under allowlist mode is dropped; records in
    /// a subdirectory of the opted-in checkout are kept, and the record cwd
    /// never reaches the ledger.
    #[test]
    fn a_record_cwd_answers_to_the_hook_admission_gate_there() {
        let data_dir = tempfile::tempdir().unwrap();
        std::fs::write(
            data_dir.path().join(super::super::hook::CAPTURE_MODE_FILE),
            "allowlist\n",
        )
        .unwrap();
        let marked = checkout(Some("docs/adr/**"));
        // Outside `$HOME` a marker lookup stops at the git root.
        let init = std::process::Command::new("git")
            .args(["init", "-q"])
            .arg(marked.path())
            .status()
            .unwrap();
        assert!(init.success());
        let subdir = marked.path().join("src");
        std::fs::create_dir_all(&subdir).unwrap();
        let unmarked = checkout(None);
        let capture = TranscriptCapture::for_checkout(data_dir.path(), marked.path());
        let events = |cwd: &Path| {
            vec![
                at(
                    event(WorkstreamEventKind::Message, "user", "a prompt", json!({})),
                    cwd,
                ),
                at(read_call(&cwd.join("lib.rs"), Some("r")), cwd),
                at(result("code", Some("r")), cwd),
            ]
        };
        assert_eq!(
            kinds(&capture.decide(&events(unmarked.path()))),
            ["drop", "drop", "drop"]
        );
        assert_eq!(
            kinds(&capture.decide(&events(&subdir))),
            ["keep", "keep", "keep"]
        );
        let uploaded = capture.filter_ledger_events(events(&subdir));
        assert!(
            uploaded
                .iter()
                .all(|event| event.metadata.get(RECORD_CWD_KEY).is_none()),
            "{uploaded:?}"
        );
    }

    /// A Claude Code `!` command's output is recorded as user messages that
    /// open with a `<bash-stdout>`/`<bash-stderr>` (or `<local-command-stdout>`)
    /// block, which live capture never receives — even when the output itself
    /// holds a closing tag. The typed command and an ordinary prompt quoting
    /// such a tag are kept, as is another agent's message.
    #[test]
    fn claude_shell_mode_output_is_not_imported() {
        let repo = checkout(None);
        let capture = TranscriptCapture::for_checkout(repo.path(), repo.path());
        let user = |text: &str| event(WorkstreamEventKind::Message, "user", text, json!({}));
        let mut codex = user("<bash-stdout>codex text</bash-stdout>");
        codex.agent = AgentKind::Codex;
        let events = [
            user("<bash-input>cat notes.txt</bash-input>"),
            user("<bash-stdout>SECRET</bash-stdout><bash-stderr></bash-stderr>"),
            user("<local-command-stdout>output</local-command-stdout>"),
            user("<bash-stdout>cut by the size cap"),
            user("why does <bash-stdout>x</bash-stdout> appear?"),
            user("<bash-stdout>x</bash-stdout> and then more output"),
            user("<bash-stdout>printf '</bash-stdout>' SHELLSENTINEL</bash-stdout>"),
            user("  <bash-stderr>e</bash-stderr><bash-stdout>a</bash-stdout>"),
            codex,
        ];
        assert_eq!(
            kinds(&capture.decide(&events)),
            [
                "keep", "drop", "drop", "drop", "keep", "drop", "drop", "drop", "keep"
            ]
        );
    }

    /// Live capture stores no arguments or output for a tool the policy does
    /// not recognize, with or without a policy, so neither does an import: a
    /// call and its result keep only the family, as does a result with no
    /// call to inherit from. A recognized public read is kept.
    #[test]
    fn unrecognized_tools_keep_no_content_with_or_without_a_policy() {
        let unknown = |id: &str| {
            event(
                WorkstreamEventKind::ToolCall,
                "assistant",
                "mcp__vault__fetch: {\"query\":\"ARGSENTINEL\"}",
                json!({"tool": "mcp__vault__fetch", "tool_use_id": id}),
            )
        };
        for marker in [None, Some("docs/adr/**")] {
            let repo = checkout(marker);
            let capture = TranscriptCapture::for_checkout(repo.path(), repo.path());
            let events = vec![
                unknown("u"),
                result("OUTSENTINEL", Some("u")),
                read_call(&repo.path().join("src/lib.rs"), Some("p")),
                result("public code", Some("p")),
            ];
            assert_eq!(
                kinds(&capture.decide(&events)),
                ["unrecognized", "unrecognized", "keep", "keep"],
                "{marker:?}"
            );
            let uploaded = serde_json::to_string(&capture.filter_ledger_events(events)).unwrap();
            assert!(!uploaded.contains("SENTINEL"), "{uploaded}");
            assert!(!uploaded.contains("mcp__vault"), "tool name: {uploaded}");
            assert!(uploaded.contains("\"tool_use_id\":\"u\""), "{uploaded}");
            assert!(uploaded.contains("public code"), "{uploaded}");
            assert!(
                uploaded.contains("[unknown tool output withheld by the capture policy]"),
                "{uploaded}"
            );
        }
        let repo = checkout(None);
        let capture = TranscriptCapture::for_checkout(repo.path(), repo.path());
        assert_eq!(
            kinds(&capture.decide(&[result("orphan output", Some("gone"))])),
            ["unrecognized"]
        );
        // The server keeps a call id only when it passes its validation.
        let mut odd = unknown("u");
        odd.metadata["tool_use_id"] = "not a valid/id".into();
        let kept = capture.filter_ledger_events(vec![odd]);
        assert_eq!(kept[0].metadata, json!({}), "{kept:?}");
    }

    #[test]
    fn ledger_events_are_dropped_or_stripped_before_upload() {
        let repo = checkout(Some("docs/adr/**"));
        let capture = TranscriptCapture::for_checkout(repo.path(), repo.path());
        let malformed = event(
            WorkstreamEventKind::ToolCall,
            "assistant",
            "Read: {\"path\": 7, \"secret\": \"SENTINEL-ARG\"}",
            json!({"tool": "Read", "tool_use_id": "m", "parent_id": "p"}),
        );
        let kept = capture.filter_ledger_events(vec![
            read_call(&repo.path().join("docs/adr/1.md"), Some("adr")),
            result("SENTINEL-ADR", Some("adr")),
            malformed,
            result("SENTINEL-OUT", Some("m")),
            read_call(&repo.path().join("src/lib.rs"), Some("pub")),
            result("public code", Some("pub")),
        ]);
        let text = serde_json::to_string(&kept).unwrap();
        assert!(!text.contains("SENTINEL"), "{text}");
        assert!(text.contains("public code"), "control kept: {text}");
        assert_eq!(kept.len(), 4);
        assert_eq!(
            kept[0].content,
            "[file tool call withheld by the capture policy]"
        );
        assert_eq!(
            kept[1].content,
            "[file tool output withheld by the capture policy]"
        );
        assert_eq!(kept[1].metadata, json!({"tool_use_id": "m"}));
    }

    fn marked(dir: &Path, marker: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(".ai-memory.toml"), marker).unwrap();
        dir.to_path_buf()
    }

    /// A compaction or annotation recorded in a directory the hook would not
    /// capture is dropped like every other event there; recorded in the
    /// opted-in checkout it is kept.
    #[test]
    fn boundary_events_answer_to_the_record_cwd_admission_gate() {
        let data_dir = tempfile::tempdir().unwrap();
        std::fs::write(
            data_dir.path().join(super::super::hook::CAPTURE_MODE_FILE),
            "allowlist\n",
        )
        .unwrap();
        let repo = checkout(Some("docs/adr/**"));
        let unmarked = checkout(None);
        let capture = TranscriptCapture::for_checkout(data_dir.path(), repo.path());
        let boundary = |cwd: &Path| {
            vec![
                at(
                    event(
                        WorkstreamEventKind::Compaction,
                        "assistant",
                        "COMPACTSENTINEL",
                        json!({}),
                    ),
                    cwd,
                ),
                at(
                    event(
                        WorkstreamEventKind::Annotation,
                        "assistant",
                        "NOTESENTINEL",
                        json!({}),
                    ),
                    cwd,
                ),
            ]
        };
        assert_eq!(
            kinds(&capture.decide(&boundary(unmarked.path()))),
            ["drop", "drop"]
        );
        assert!(
            capture
                .filter_ledger_events(boundary(unmarked.path()))
                .is_empty()
        );
        assert_eq!(
            kinds(&capture.decide(&boundary(repo.path()))),
            ["keep", "keep"]
        );
    }

    /// The hook files an event under the project its own cwd resolves to. An
    /// import files everything under the importing checkout's project, so
    /// records written in a checkout of another project on the same server
    /// are dropped, prompts included; a checkout declaring the same project
    /// is kept.
    #[test]
    fn a_record_cwd_in_another_project_is_dropped() {
        let data_dir = tempfile::tempdir().unwrap();
        let base = tempfile::tempdir().unwrap();
        let source = marked(
            &base.path().join("source"),
            "workspace = \"w\"\nproject = \"p\"\n",
        );
        let same = marked(
            &base.path().join("same"),
            "workspace = \"w\"\nproject = \"p\"\n",
        );
        let other = marked(
            &base.path().join("other"),
            "workspace = \"w\"\nproject = \"q\"\n",
        );
        let capture = TranscriptCapture::for_checkout(data_dir.path(), &source);
        let events = |cwd: &Path| {
            vec![
                at(
                    event(
                        WorkstreamEventKind::Message,
                        "user",
                        "PROMPTSENTINEL",
                        json!({}),
                    ),
                    cwd,
                ),
                at(read_call(&cwd.join("lib.rs"), Some("r")), cwd),
                at(result("CODESENTINEL", Some("r")), cwd),
            ]
        };
        assert_eq!(
            kinds(&capture.decide(&events(&other))),
            ["drop", "drop", "drop"]
        );
        assert!(capture.filter_ledger_events(events(&other)).is_empty());
        assert_eq!(
            kinds(&capture.decide(&events(&same))),
            ["keep", "keep", "keep"]
        );
    }

    /// The same for a call the hook would reroute by its absolute target: a
    /// read inside a checkout of another project is dropped, call and result.
    #[test]
    fn a_reroute_into_another_project_is_dropped() {
        let data_dir = tempfile::tempdir().unwrap();
        let base = tempfile::tempdir().unwrap();
        let source = marked(
            &base.path().join("source"),
            "workspace = \"w\"\nproject = \"p\"\n",
        );
        let other = marked(
            &base.path().join("other"),
            "workspace = \"w\"\nproject = \"q\"\n",
        );
        let same = marked(
            &base.path().join("same"),
            "workspace = \"w\"\nproject = \"p\"\n",
        );
        let capture = TranscriptCapture::for_checkout(data_dir.path(), &source);
        let events = [
            read_call(&other.join("x.txt"), Some("o")),
            result("OTHERSENTINEL", Some("o")),
            read_call(&same.join("y.txt"), Some("s")),
            result("same project", Some("s")),
        ];
        assert_eq!(
            kinds(&capture.decide(&events)),
            ["drop", "drop", "keep", "keep"]
        );
    }
}
