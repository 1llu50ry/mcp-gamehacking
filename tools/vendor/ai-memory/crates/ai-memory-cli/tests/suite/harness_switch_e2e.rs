//! Switching harnesses after an abrupt stop, end to end.
//!
//! The reported failure: an OpenCode session ran out of quota mid-task, so it
//! never ended and left no handoff. The user resumed an older Claude Code
//! session and asked where they had left off. The only open handoff was that
//! Claude session's own baton from days earlier, and the agent continued
//! from it while the real last task sat in the OpenCode session's captured
//! observations.
//!
//! This drives the shipped binary against a real server the way the two
//! harnesses do (the OpenCode plugin posts to `/hook`; Claude Code and Codex
//! run `ai-memory hook`), then follows the session-start notice to the cut-off
//! session over MCP, as the next agent would, and checks that what it reads is
//! exactly where the first harness stopped.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use ai_memory_core::SessionId;
use serde_json::{Value, json};

use crate::e2e_support::{ServerGuard, hermetic, start_serve};

const BIN: &str = env!("CARGO_BIN_EXE_ai-memory");
const TOKEN: &str = "harness-switch-local-test-token";
const WORKSPACE: &str = "switch-test";
const PROJECT: &str = "harness-switch";

/// The cut-off OpenCode session's native id, and its last prompt and tool
/// result: where the work stopped.
const OPENCODE_SESSION: &str = "ses_cut_off_by_quota";
const LAST_PROMPT: &str = "now disable router advertisements on the BE800";
const LAST_TOOL_OUTPUT: &str = "default via fe80::42ae:30ff:fe6e:7380 dev enp16s0";

/// The Claude Code session the user resumes, and its days-old work.
const CLAUDE_SESSION: &str = "0f3c8a52-1d4e-4b7a-9c2e-5a6b7c8d9e01";
const OLD_CLAUDE_PROMPT: &str = "pair the 8BitDo controller";

struct Fixture {
    _server: ServerGuard,
    root: PathBuf,
    client: reqwest::Client,
    base: String,
    // Last field: drops after the server has stopped using the tree.
    _guard: tempfile::TempDir,
}

fn command(root: &Path) -> Command {
    let mut cmd = hermetic(BIN);
    cmd.env("HOME", root.join("home"))
        .env("USERPROFILE", root.join("home"))
        .env("AI_MEMORY_HOME", root.join("home"))
        .env("AI_MEMORY_DATA_DIR", root.join("data"))
        .env("AI_MEMORY_AUTH_TOKEN", TOKEN)
        .env("AI_MEMORY_EMBEDDING_PROVIDER", "none")
        .env("AI_MEMORY_BACKFILL_ON_START", "false")
        .env("AI_MEMORY_CONSOLIDATE_ON_SESSION_END", "false")
        .env("AI_MEMORY_AUTO_IMPROVE__SCHEDULER__ENABLED", "false")
        .env("RUST_LOG", "off")
        .current_dir(root.join("project"));
    cmd
}

impl Fixture {
    async fn start() -> Self {
        let guard = tempfile::tempdir().unwrap();
        let root = guard.path().to_path_buf();
        for dir in ["home", "data", "project"] {
            std::fs::create_dir(root.join(dir)).unwrap();
        }
        std::fs::write(
            root.join("project/.ai-memory.toml"),
            format!("workspace = \"{WORKSPACE}\"\nproject = \"{PROJECT}\"\n"),
        )
        .unwrap();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap();
        let (server, base) = start_serve(&client, &root.join("serve.log"), |port| {
            let mut cmd = command(&root);
            cmd.args([
                "serve",
                "--transport",
                "http",
                "--bind",
                &format!("127.0.0.1:{port}"),
                "--no-watcher",
            ]);
            cmd
        })
        .await;
        Self {
            _server: server,
            root,
            client,
            base,
            _guard: guard,
        }
    }

    fn project_dir(&self) -> PathBuf {
        self.root.join("project")
    }

    /// One OpenCode lifecycle event, posted with the field names its
    /// generated plugin uses (`sessionID`, `tool`, `callID`, `output`).
    ///
    /// The server acknowledges a hook before storing it, so events sent
    /// microseconds apart could be stored out of order; a real harness's
    /// events are seconds apart. Each one is stored before the next.
    async fn opencode(&self, event: &str, body: Value) {
        let id = SessionId::from_native(OPENCODE_SESSION).to_string();
        let before = self.observation_total(&id).await;
        let mut body = body;
        body["sessionID"] = json!(OPENCODE_SESSION);
        body["cwd"] = json!(self.project_dir());
        let response = self
            .client
            .post(format!("{}/hook", self.base))
            .query(&[
                ("event", event),
                ("agent", "open-code"),
                ("workspace", WORKSPACE),
                ("project", PROJECT),
            ])
            .bearer_auth(TOKEN)
            .json(&body)
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success(), "{}", response.status());
        self.wait_for_observations(&id, before + 1).await;
    }

    /// How many observations a session has stored, 0 before its first.
    async fn observation_total(&self, session_id: &str) -> u64 {
        let response = self
            .client
            .post(format!("{}/mcp", self.base))
            .bearer_auth(TOKEN)
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .body(
                json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": "memory_read_session_observations",
                        "arguments": {
                            "session_id": session_id,
                            "limit": 1,
                            "workspace": WORKSPACE,
                            "project": PROJECT,
                        },
                    },
                })
                .to_string(),
            )
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        response
            .pointer("/result/content/0/text")
            .and_then(Value::as_str)
            .and_then(|text| serde_json::from_str::<Value>(text).ok())
            .and_then(|page| page["total"].as_u64())
            .unwrap_or(0)
    }

    /// One native `ai-memory hook` run from inside the project, as the
    /// harness's installed hook runs it. Returns its stdout.
    fn native_hook(&self, agent: &str, event: &str, body: Value) -> String {
        let mut child = command(&self.root)
            .args([
                "hook",
                "--agent",
                agent,
                "--event",
                event,
                "--server-url",
                &self.base,
                "--auth-token",
                TOKEN,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(body.to_string().as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "{output:?}");
        String::from_utf8(output.stdout).unwrap()
    }

    fn claude(&self, event: &str, session: &str, extra: Value) -> String {
        let mut body = json!({ "session_id": session, "cwd": self.project_dir() });
        if let (Some(body), Some(extra)) = (body.as_object_mut(), extra.as_object()) {
            body.extend(extra.clone());
        }
        self.native_hook("claude-code", event, body)
    }

    async fn call_tool(&self, name: &str, arguments: Value) -> Value {
        let text = self
            .client
            .post(format!("{}/mcp", self.base))
            .bearer_auth(TOKEN)
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .body(
                json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": { "name": name, "arguments": arguments },
                })
                .to_string(),
            )
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        let reply: Value = serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("non-JSON mcp reply: {text}: {e}"));
        assert!(reply.get("error").is_none(), "JSON-RPC error: {text}");
        let content = reply
            .pointer("/result/content/0/text")
            .and_then(Value::as_str)
            .unwrap_or_else(|| panic!("missing tool text: {text}"));
        assert_ne!(
            reply.pointer("/result/isError"),
            Some(&json!(true)),
            "{text}"
        );
        serde_json::from_str(content).unwrap_or_else(|e| panic!("{content}: {e}"))
    }

    /// The newest captured observations of one session, newest first.
    async fn newest_observations(&self, session_id: &str, limit: u64) -> Value {
        self.call_tool(
            "memory_read_session_observations",
            json!({
                "session_id": session_id,
                "order": "desc",
                "limit": limit,
                "workspace": WORKSPACE,
                "project": PROJECT,
            }),
        )
        .await
    }

    /// Hooks are acknowledged before they are stored; wait until the
    /// session has `count` observations.
    async fn wait_for_observations(&self, session_id: &str, count: u64) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while self.observation_total(session_id).await < count {
            assert!(
                Instant::now() < deadline,
                "session {session_id} never reached {count} observations"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// A session end writes its handoff after the hook is acknowledged; wait
    /// until `count` handoffs are open, so later work is newer than them.
    async fn wait_for_open_handoffs(&self, count: usize) {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let listed = self
                .call_tool(
                    "memory_handoff_list",
                    json!({ "workspace": WORKSPACE, "project": PROJECT }),
                )
                .await;
            let open = listed["handoffs"].as_array().map_or(0, Vec::len);
            if open >= count {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "only {open} of {count} handoffs opened: {listed}"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

/// The session id a session-start notice points at, if any.
fn pointed_session(context: &str) -> Option<String> {
    let start = context.find("🧭")?;
    let rest = &context[start..];
    let id = rest.split("session `").nth(1)?.split('`').next()?;
    Some(id.to_owned())
}

fn additional_context(stdout: &str) -> String {
    let envelope: Value = serde_json::from_str(stdout.trim())
        .unwrap_or_else(|e| panic!("session-start stdout is not JSON: {stdout}: {e}"));
    envelope
        .pointer("/hookSpecificOutput/additionalContext")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

#[tokio::test]
async fn the_next_harness_is_pointed_at_where_a_cut_off_harness_stopped() {
    let fx = Fixture::start().await;
    let claude_id = SessionId::from_native(CLAUDE_SESSION).to_string();
    let opencode_id = SessionId::from_native(OPENCODE_SESSION).to_string();

    // Days ago: a Claude Code session worked and ended cleanly, leaving
    // its automatic handoff behind.
    fx.claude(
        "session-start",
        CLAUDE_SESSION,
        json!({ "source": "startup" }),
    );
    fx.claude(
        "user-prompt",
        CLAUDE_SESSION,
        json!({ "prompt": OLD_CLAUDE_PROMPT }),
    );
    fx.claude("session-end", CLAUDE_SESSION, json!({ "reason": "exit" }));
    fx.wait_for_observations(&claude_id, 2).await;
    fx.wait_for_open_handoffs(1).await;

    // Today: OpenCode works on the router, then hits its quota mid-task.
    // No stop, no session end, no handoff.
    fx.opencode("session-start", json!({})).await;
    fx.opencode(
        "user-prompt",
        json!({ "prompt": "check the router IPv6 advertisement" }),
    )
    .await;
    fx.opencode(
        "post-tool-use",
        json!({
            "tool": "bash",
            "callID": "call_0e9372fb",
            "args": { "command": "ip -6 route" },
            "output": LAST_TOOL_OUTPUT,
        }),
    )
    .await;
    fx.opencode("user-prompt", json!({ "prompt": LAST_PROMPT }))
        .await;
    fx.wait_for_observations(&opencode_id, 3).await;

    // The user resumes the old Claude Code session.
    let context = additional_context(&fx.claude(
        "session-start",
        CLAUDE_SESSION,
        json!({ "source": "resume" }),
    ));
    assert_eq!(
        pointed_session(&context).as_deref(),
        Some(opencode_id.as_str()),
        "the resumed session must be pointed at the cut-off one:\n{context}"
    );
    assert!(context.contains("`open-code`"), "{context}");
    for captured in [LAST_PROMPT, LAST_TOOL_OUTPUT] {
        assert!(
            !context.contains(captured),
            "the notice carries no captured text:\n{context}"
        );
    }

    // Following the notice the way the agent would: the newest captured
    // activity is the prompt it was cut off on, then the tool result
    // before it.
    let read = fx.newest_observations(&opencode_id, 5).await;
    assert_eq!(read["session"]["agent_kind"], "open-code", "{read}");
    assert_eq!(read["observations"][0]["kind"], "user-prompt", "{read}");
    assert!(
        read["observations"][0]["body"]
            .as_str()
            .unwrap_or_default()
            .contains(LAST_PROMPT),
        "{read}"
    );
    assert!(
        read["observations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["body"]
                .as_str()
                .is_some_and(|body| body.contains(LAST_TOOL_OUTPUT))),
        "{read}"
    );
    // The native OpenCode id reads the same session.
    let by_native = fx.newest_observations(OPENCODE_SESSION, 1).await;
    assert_eq!(by_native["session"]["session_id"], opencode_id);

    // An agent that asks instead of reading the notice finds the same
    // session: newest in the briefing, and named by the handoff list as
    // newer than every open handoff.
    let briefing = fx
        .call_tool(
            "memory_briefing",
            json!({ "workspace": WORKSPACE, "project": PROJECT }),
        )
        .await;
    assert_eq!(
        briefing["recent_sessions"][0]["session_id"], opencode_id,
        "{briefing}"
    );
    assert_eq!(briefing["recent_sessions"][0]["ended"], false);
    let handoffs = fx
        .call_tool(
            "memory_handoff_list",
            json!({ "workspace": WORKSPACE, "project": PROJECT }),
        )
        .await;
    assert_eq!(
        handoffs["newer_unended_session"]["session_id"], opencode_id,
        "{handoffs}"
    );

    // A different harness starting fresh is pointed there too.
    let codex = fx.native_hook(
        "codex",
        "session-start",
        json!({
            "session_id": "019a0000-0000-7000-8000-00000000c0de",
            "cwd": fx.project_dir(),
            "source": "startup",
        }),
    );
    assert!(codex.contains(&opencode_id), "{codex}");

    // Once OpenCode resumes and ends cleanly, nothing is cut off any
    // more, and the next session start names no session.
    fx.opencode("stop", json!({})).await;
    fx.opencode("session-end", json!({})).await;
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let listed = fx
            .call_tool(
                "memory_briefing",
                json!({ "workspace": WORKSPACE, "project": PROJECT }),
            )
            .await;
        if listed["recent_sessions"][0]["ended"] == true {
            break;
        }
        assert!(Instant::now() < deadline, "{listed}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let context = additional_context(&fx.claude(
        "session-start",
        "5d1e2f3a-4b5c-4d6e-8f70-81920a1b2c3d",
        json!({ "source": "startup" }),
    ));
    assert_eq!(pointed_session(&context), None, "{context}");
}
