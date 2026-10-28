//! Seeded long-session generator for the fidelity harness (#1215).
//!
//! No committed fixture is large enough to make the projection omit or
//! truncate anything, so the long session is generated: 300 observations in
//! the capture shapes production stores (modern tool bodies with
//! `tool_family` / `tool_call_id` / `outcome` headers, the legacy
//! `tool: <name>` shape, Claude Code's one-line JSON Bash output, and the
//! metadata-only `unknown` family with `outcome: error`).
//!
//! Fifteen literal facts are planted once each. Seven sit where the default
//! budget keeps them, so a loss there is the model's (`llm_loss`); the
//! shapes follow the field report in #1221: in-flight metrics, an operator
//! instruction, a staged-script path, plus a pt-BR error as a language
//! control. Eight sit where the projection drops them, which is what a
//! verbatim residue would have to recover: errors in English, in Postgres
//! pt-BR (`ERRO:`) and in Portuguese words only, a release version, a host
//! and a job-state marker path in output with no high-signal term, and an
//! operator instruction with its precondition past the 3,000-character
//! excerpt cap of a pasted prompt. Where a fact sits is a choice, so the
//! projection loss of this session describes the fixture, not real
//! sessions. The session ends on an unanswered prompt with no
//! `session-end`, the way a session that dies at a provider limit does.
//!
//! The generator owns its PRNG (SplitMix64) instead of depending on `rand`,
//! whose `StdRng` stream may change between releases: the published sha256
//! of a seed's output must stay reproducible.

use crate::ab::{Fixture, FixtureObservation};

const LEN: usize = 300;
/// Capture caps the whole tool body, header included (`TOOL_EXCERPT_MAX_BYTES`).
const TOOL_BODY_MAX_BYTES: usize = 2_000;

const OPERATOR_SCRIPT: &str = "backfill-verify.sh";
const OPERATOR_PRECONDITION: &str = "when the reindex reaches 100%";

/// Facts planted where the default budget keeps them.
pub const KEPT: [&str; 7] = [
    "WAL_FENCE_INTERVAL_MS=750",
    "rotate-fence-keys.sh",
    "permissão negada para a tabela fence_epochs",
    "/srv/fence-svc/staged/rotate.sh",
    "crates/fence-svc/src/epoch.rs",
    "412 GB of 1.38 TB",
    "97 MB/s",
];

/// Facts planted where the default budget drops them.
pub const AT_RISK: [&str; 8] = [
    "v2.6.3-rc1",
    "error[E0599]: no method named `fence_epoch` found",
    "ERRO:  relação \"jobs_v2\" não existe",
    "falhou ao gravar o checkpoint",
    "build-runner-07",
    "/var/lib/fence-svc/state/reindex.done",
    OPERATOR_SCRIPT,
    OPERATOR_PRECONDITION,
];

/// The session as `--dump` writes it, and the sha256 of exactly those bytes:
/// the provenance a published number cites.
pub fn dump(fx: &Fixture) -> serde_json::Result<(String, String)> {
    use sha2::{Digest, Sha256};
    let json = serde_json::to_string_pretty(fx)?;
    let sha = format!("{:x}", Sha256::digest(json.as_bytes()));
    Ok((json, sha))
}

/// Build the generated session for `seed`.
#[must_use]
pub fn session(seed: u64) -> Fixture {
    let mut rng = Rng(seed);
    let observations = (0..LEN).map(|i| observation(i, &mut rng)).collect();
    Fixture {
        name: format!("generated-{seed}"),
        description: "Seeded long session (evals/src/generate.rs): 300 observations in \
                      production capture shapes with fifteen planted facts; ends on an \
                      unanswered prompt without session-end."
            .into(),
        observations,
        must_mention: KEPT
            .iter()
            .chain(AT_RISK.iter())
            .map(|f| (*f).to_string())
            .collect(),
        must_not_mention: Vec::new(),
    }
}

fn observation(i: usize, rng: &mut Rng) -> FixtureObservation {
    match i {
        0 => obs("session-start", "session start", "source: startup"),
        1 => obs(
            "user-prompt",
            "user prompt",
            "the fence service stalls after every checkpoint; keep \
             WAL_FENCE_INTERVAL_MS=750 while we dig, the old 250 made it worse",
        ),
        20 => tool_text(
            rng,
            "non-file",
            "deployed image fence-svc:v2.6.3-rc1 to the staging pool\n\
             rollout: 4/4 replicas ready",
        ),
        60 => tool_text(
            rng,
            "non-file",
            "   Compiling fence-svc v0.4.0\n\
             error[E0599]: no method named `fence_epoch` found for struct `Writer` \
             in the current scope\n  --> src/writer.rs:212:14",
        ),
        75 => obs(
            "post-tool-use",
            "psql",
            "tool: psql\n---\nERRO:  relação \"jobs_v2\" não existe\n\
             LINHA 1: select count(*) from jobs_v2 where state = 'queued'",
        ),
        90 => tool_text(
            rng,
            "non-file",
            "backfill[3]: falhou ao gravar o checkpoint (tentativa 3 de 3)\n\
             backfill[3]: aguardando o próximo ciclo",
        ),
        130 => tool_json(
            rng,
            "ssh build-runner-07 uptime\n 21:40:11 up 41 days,  3 users,  \
             load average: 7.12, 6.80, 6.55",
        ),
        145 => tool_json(
            rng,
            "ls /var/lib/fence-svc/state\nreindex.log\nreindex.attempts\n\
             stat /var/lib/fence-svc/state/reindex.done: No such file or directory",
        ),
        256 => obs(
            "user-prompt",
            "user prompt",
            "when the backfill finishes, run rotate-fence-keys.sh before anything else",
        ),
        260 => obs(
            "post-tool-use",
            "psql",
            "tool: psql\n---\nERRO:  permissão negada para a tabela fence_epochs",
        ),
        271 => obs("user-prompt", "user prompt", &pasted_status_prompt(rng)),
        284 => tool_json(
            rng,
            "ls /srv/fence-svc/staged\nrotate.sh\nverify.sh\n\
             staged /srv/fence-svc/staged/rotate.sh (not run yet)",
        ),
        290 => tool_text(
            rng,
            "file",
            "crates/fence-svc/src/epoch.rs\n\
             pub(crate) fn next_epoch(current: u64) -> u64 {\n    current + 1\n}",
        ),
        297 => tool_json(
            rng,
            "reindex status\ncopied 412 GB of 1.38 TB at 97 MB/s\n\
             workers: 3 running, 9 pending\nwatcher armed on reindex.attempts",
        ),
        // The session dies here: a prompt nobody answered, no stop, no
        // session-end.
        299 => obs(
            "user-prompt",
            "user prompt",
            "are the workers still running? check before you go",
        ),
        _ if i % 15 == 1 => obs("user-prompt", "user prompt", rng.pick(PROMPTS)),
        _ if i.is_multiple_of(15) => {
            if rng.below(2) == 0 {
                obs("stop", "stop", rng.pick(STOPS))
            } else {
                obs("stop", "stop", "")
            }
        }
        _ if i % 30 == 7 => {
            let family = rng.pick(&["file", "non-file"]);
            let header = header(rng, family);
            obs("pre-tool-use", &format!("tool {family}"), &header)
        }
        _ => filler(rng),
    }
}

/// A pasted status report past the per-body excerpt cap, with the operator
/// instruction at the end: the projection keeps the prompt and cuts the tail.
fn pasted_status_prompt(rng: &mut Rng) -> String {
    let mut out = String::from("status from the overnight run, pasted:\n");
    while out.len() < 3_300 {
        out.push_str(&format!(
            "worker-{:02} shard {}/{} ok in {}s\n",
            rng.below(12),
            rng.below(400),
            400,
            10 + rng.below(80)
        ));
    }
    out.push_str(&format!(
        "\nleave it running and run {OPERATOR_SCRIPT} {OPERATOR_PRECONDITION}"
    ));
    out
}

fn filler(rng: &mut Rng) -> FixtureObservation {
    let target = 500 + rng.below(1_400);
    match rng.below(20) {
        0..=8 => {
            let text = lines(rng, FILE_LINES, target);
            tool_text(rng, "file", &text)
        }
        9..=14 => {
            let pool = if rng.below(2) == 0 {
                TEST_LINES
            } else {
                GIT_LINES
            };
            let text = lines(rng, pool, target);
            tool_json(rng, &text)
        }
        15..=17 => {
            let text = lines(rng, GREP_LINES, target);
            obs(
                "post-tool-use",
                "rg",
                &capped(format!("tool: rg\n---\n{text}")),
            )
        }
        _ => {
            let header = header(rng, "unknown");
            obs(
                "post-tool-use",
                "tool unknown",
                &format!("{header}\noutcome: error"),
            )
        }
    }
}

fn tool_text(rng: &mut Rng, family: &str, text: &str) -> FixtureObservation {
    let header = header(rng, family);
    obs(
        "post-tool-use",
        &format!("tool {family}"),
        &capped(format!("{header}\noutcome: success\n---\n{text}")),
    )
}

/// Claude Code's Bash result: one line of JSON, newlines escaped.
fn tool_json(rng: &mut Rng, stdout: &str) -> FixtureObservation {
    let header = header(rng, "non-file");
    let json = serde_json::json!({
        "stdout": stdout,
        "stderr": "",
        "interrupted": false,
        "isImage": false,
    });
    obs(
        "post-tool-use",
        "tool non-file",
        &capped(format!("{header}\noutcome: success\n---\n{json}")),
    )
}

/// Tool call ids in the three harness spellings: Claude, Codex, Grok.
fn header(rng: &mut Rng, family: &str) -> String {
    let id = match rng.below(3) {
        0 => format!("toolu_01{}", rng.alnum(22)),
        1 => format!("exec-{}", rng.uuid()),
        _ => format!("call-{}-{}", rng.uuid(), rng.below(9)),
    };
    format!("tool_family: {family}\ntool_call_id: {id}")
}

fn lines(rng: &mut Rng, pool: &[&str], target: usize) -> String {
    let mut out = String::new();
    while out.len() < target {
        out.push_str(rng.pick(pool));
        out.push('\n');
    }
    out
}

/// Cut a body to the capture cap on a character boundary, as capture does
/// (a one-line JSON result is cut mid-string).
fn capped(mut body: String) -> String {
    let mut cut = TOOL_BODY_MAX_BYTES.min(body.len());
    while !body.is_char_boundary(cut) {
        cut -= 1;
    }
    body.truncate(cut);
    body
}

fn obs(kind: &str, title: &str, body: &str) -> FixtureObservation {
    FixtureObservation {
        kind: kind.into(),
        title: title.into(),
        body: body.into(),
    }
}

/// SplitMix64: tiny, well-distributed, and frozen by this file.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    fn pick<'a>(&mut self, pool: &[&'a str]) -> &'a str {
        pool[self.below(pool.len())]
    }

    fn alnum(&mut self, len: usize) -> String {
        const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        (0..len)
            .map(|_| char::from(CHARS[self.below(CHARS.len())]))
            .collect()
    }

    fn uuid(&mut self) -> String {
        let hex = format!("{:016x}{:016x}", self.next(), self.next());
        format!(
            "{}-{}-{}-{}-{}",
            &hex[..8],
            &hex[8..12],
            &hex[12..16],
            &hex[16..20],
            &hex[20..]
        )
    }
}

// Filler pools. None of them may contain a planted fact (a test checks it);
// TEST_LINES carries the high-signal words most real tool output has.

const PROMPTS: &[&str] = &[
    "look at why the writer stalls right after a checkpoint",
    "run the store tests again",
    "show me the checkpoint advance code",
    "what changed in the reader pool since yesterday?",
    "ok, try batching the inserts",
    "commit that and keep going",
    "grep for every caller of advance()",
];

const STOPS: &[&str] = &[
    "Ran the store tests; all green. Next: wire the checkpoint advance into the writer.",
    "The stall comes from the reader pool reopening the database on every checkpoint.",
    "Batched the inserts; the writer now commits once per batch.",
];

const FILE_LINES: &[&str] = &[
    "use crate::writer::WriterHandle;",
    "pub(crate) fn apply_batch(tx: &Transaction<'_>, rows: &[Row]) -> Result<usize> {",
    "    let mut stmt = tx.prepare_cached(INSERT_ROW)?;",
    "    for row in rows {",
    "        stmt.execute(params![row.id, row.payload])?;",
    "    }",
    "    Ok(rows.len())",
    "}",
    "#[derive(Debug, Clone, PartialEq, Eq)]",
    "pub struct CheckpointState {",
    "    pub lsn: u64,",
    "    pub flushed_at: Timestamp,",
    "impl CheckpointState {",
    "    /// Advance the flushed position after a durable write.",
    "    pub fn advance(&mut self, lsn: u64) { self.lsn = self.lsn.max(lsn); }",
    "// The reader pool never observes a half-written page.",
    "let pool = ReaderPool::open(&db_path, 4)?;",
    "tracing::debug!(lsn, \"checkpoint advanced\");",
];

const TEST_LINES: &[&str] = &[
    "running 42 tests",
    "test store::tests::checkpoint_roundtrip ... ok",
    "test writer::tests::batch_commits_once ... ok",
    "test reader::tests::pool_reopens_lazily ... ok",
    "test result: ok. 42 passed; 0 failed; 0 ignored; finished in 1.84s",
];

const GIT_LINES: &[&str] = &[
    "M  src/writer.rs",
    "?? src/checkpoint.rs",
    "commit 4f2a9c1 batch the inserts per checkpoint",
    "Author: dev <dev@example.invalid>",
    " src/writer.rs | 14 +++++++-------",
];

const GREP_LINES: &[&str] = &[
    "src/writer.rs:88:    let pool = ReaderPool::open(&db_path, 4)?;",
    "src/checkpoint.rs:12:    pub fn advance(&mut self, lsn: u64) {",
    "src/reader.rs:40:// reopen lazily, never on the hot path",
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fidelity::Scorer;
    use ai_memory_consolidate::{BATCH_SYSTEM_PROMPT, build_batch_request};
    use ai_memory_core::SessionId;

    /// The seed of the published runs.
    const DEFAULT_SEED: u64 = 1215;

    #[test]
    fn a_seed_always_produces_the_same_session() {
        let a = serde_json::to_string(&session(DEFAULT_SEED)).unwrap();
        let b = serde_json::to_string(&session(DEFAULT_SEED)).unwrap();
        assert_eq!(a, b);
        let c = serde_json::to_string(&session(DEFAULT_SEED + 1)).unwrap();
        assert_ne!(a, c, "the seed must reach the output");
    }

    /// Published runs cite the sha256 of `session(1215)`. A change to the
    /// generator (a template, a formatting tweak, the RNG) that alters those
    /// bytes must update this pin and say so next to any republished number,
    /// rather than silently changing what the old hash names.
    #[test]
    fn the_published_seed_keeps_its_sha256() {
        let (_, sha) = dump(&session(DEFAULT_SEED)).unwrap();
        assert_eq!(
            sha,
            "f25fbc436edf70647ff54b910dfa5ab72259e1b45f1c072db63b9e23d01879d4"
        );
    }

    #[test]
    fn every_fact_is_planted_exactly_once_and_nowhere_in_the_prompt() {
        let fx = session(DEFAULT_SEED);
        assert_eq!(fx.observations.len(), LEN);
        for fact in KEPT.iter().chain(AT_RISK.iter()) {
            let hits = fx
                .observations
                .iter()
                .filter(|o| o.title.contains(fact) || o.body.contains(fact))
                .count();
            assert_eq!(hits, 1, "{fact} planted {hits} times");
            assert!(
                !BATCH_SYSTEM_PROMPT.contains(fact),
                "{fact} is in the prompt"
            );
        }
        for o in fx.observations.iter().filter(|o| o.kind == "post-tool-use") {
            assert!(o.body.len() <= TOOL_BODY_MAX_BYTES, "{}", o.body.len());
        }
        let tool_share = fx
            .observations
            .iter()
            .filter(|o| o.kind == "post-tool-use")
            .count() as f64
            / LEN as f64;
        assert!((0.75..0.9).contains(&tool_share), "{tool_share}");
    }

    /// The fixture's contract: at the default budget the projection keeps the
    /// controls and loses the tail of the pasted prompt plus some omitted
    /// tool output. If projection tuning breaks this, the session no longer
    /// exercises what the benchmark claims; re-plant before publishing.
    #[test]
    fn the_default_budget_keeps_the_controls_and_loses_planted_facts() {
        let fx = session(DEFAULT_SEED);
        let observations = crate::ab::synthesise_observations(&fx);
        let sid = SessionId::new();
        let request = build_batch_request(sid, &observations, false);
        let scorer = Scorer::new(sid, &observations, &request, &fx.must_mention, &[]);
        let prompt = scorer.prompt(observations.len());

        assert!(prompt.selected < LEN, "nothing was omitted");
        let lost = |fact: &str| prompt.lost_in_projection.iter().any(|f| f == fact);
        for fact in KEPT {
            assert!(!lost(fact), "{fact} no longer reaches the prompt");
        }
        // The pasted prompt is kept and cut, whatever the scoring does.
        assert!(lost(OPERATOR_SCRIPT) && lost(OPERATOR_PRECONDITION));
        let at_risk_lost = AT_RISK.iter().filter(|f| lost(f)).count();
        assert!(at_risk_lost >= 6, "{:?}", prompt.lost_in_projection);
    }
}
