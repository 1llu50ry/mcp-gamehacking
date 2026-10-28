//! `--reachability`: does the evidence reach the index at all?
//!
//! After a question's haystack is ingested, every answer-bearing turn (the
//! dataset's `has_answer` flag) is checked against three surfaces of its
//! own session, read back through the public MCP tools:
//!
//! 1. **page**: the session page's title plus body (`memory_read_page`),
//!    which is what page FTS indexes;
//! 2. **observations**: every observation title and body of the session
//!    (`memory_read_session_observations`, full 16 KiB bodies), which is
//!    what `observations_fts` indexes (hook ingest only);
//! 3. **embed512**: the prefix of the page body the local embedder actually
//!    reads: the body cut to 6 144 bytes (`truncate_for_embedding` with
//!    `MAX_TOKENS * 4`), then to 512 WordPiece tokens including `[CLS]` and
//!    `[SEP]`, using the model's own tokenizer.
//!
//! ## Distinctive answer content
//!
//! A turn's *content tokens* are its lowercased alphanumeric runs of three
//! or more characters, plus any shorter run containing a digit, minus a
//! fixed English stopword list. Its *distinctive* tokens are the content
//! tokens that occur in at most [`DF_MAX`] distinct sessions of the
//! question's haystack: words a retriever could use to single this session
//! out, as opposed to words every chat contains. A turn with no such token
//! falls back to all its content tokens (counted in the report).
//!
//! A turn is **reachable** through a surface when at least
//! [`REACH_THRESHOLD`] of its distinctive tokens occur in that surface's
//! token set. Matching is exact token equality, a little stricter than
//! FTS5's tokenizer; a word cut by a title's `…` does not count.
//!
//! A second, answer-anchored check uses the gold answer: the answer's
//! content tokens that literally occur in the turn must *all* occur in the
//! surface. Many answers are derived (counts, durations, dates) and never
//! appear verbatim, so this covers fewer turns but needs no threshold.
//!
//! The question-level ceiling is the share of questions with at least one
//! reachable evidence turn: a ranker cannot put a session in the top k on
//! evidence the index never saw.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use anyhow::{Context, Result, bail};
use serde::Serialize;
use serde_json::json;

use super::dataset::Question;
use super::ingest::stored_session_uuid;
use super::ingest::{DatePrefix, EVAL_WORKSPACE, IngestMode, project_for, session_document};
use super::query::mcp_tool_text;

/// A token is distinctive when it occurs in at most this many sessions of
/// the question's haystack (~50 sessions; multi-session evidence spans up
/// to a handful, so 3 keeps shared topic words of 2-3 evidence sessions).
pub const DF_MAX: usize = 3;

/// Share of a turn's distinctive tokens a surface must contain.
pub const REACH_THRESHOLD: f64 = 0.5;

/// Local embedder input bounds, mirrored from `ai-memory-llm`:
/// `truncate_for_embedding(text, MAX_TOKENS * 4)` keeps
/// `min(MAX_TOKENS * 4 * 3, 8000)` bytes, then the tokenizer truncates to
/// `MAX_TOKENS`.
const EMBED_MAX_TOKENS: usize = 512;
const EMBED_PRE_TRUNCATE_BYTES: usize = 6_144;

/// Function words that carry no retrieval signal on their own.
const STOPWORDS: &[&str] = &[
    "the",
    "and",
    "for",
    "are",
    "but",
    "not",
    "you",
    "your",
    "yours",
    "all",
    "any",
    "can",
    "had",
    "her",
    "hers",
    "was",
    "one",
    "our",
    "ours",
    "out",
    "has",
    "have",
    "him",
    "his",
    "how",
    "its",
    "may",
    "she",
    "they",
    "them",
    "their",
    "theirs",
    "then",
    "than",
    "that",
    "this",
    "these",
    "those",
    "there",
    "here",
    "what",
    "when",
    "where",
    "which",
    "who",
    "whom",
    "why",
    "with",
    "would",
    "could",
    "should",
    "will",
    "shall",
    "from",
    "into",
    "onto",
    "upon",
    "about",
    "above",
    "below",
    "after",
    "before",
    "again",
    "also",
    "just",
    "only",
    "very",
    "some",
    "such",
    "more",
    "most",
    "much",
    "many",
    "each",
    "other",
    "own",
    "same",
    "too",
    "off",
    "over",
    "under",
    "were",
    "been",
    "being",
    "does",
    "did",
    "doing",
    "done",
    "get",
    "got",
    "let",
    "like",
    "make",
    "made",
    "well",
    "yes",
    "yeah",
    "okay",
    "sure",
    "thanks",
    "thank",
    "please",
    "know",
    "think",
    "want",
    "need",
    "really",
    "because",
    "while",
    "though",
    "even",
    "still",
    "both",
    "either",
    "neither",
    "nor",
    "via",
    "per",
    "etc",
    "don",
    "doesn",
    "didn",
    "can",
    "won",
    "isn",
    "aren",
    "wasn",
    "weren",
    "myself",
    "yourself",
    "itself",
    "himself",
    "herself",
    "ourselves",
    "themselves",
    "whose",
    "something",
    "anything",
    "everything",
    "nothing",
    "way",
    "lot",
    "thing",
    "things",
];

/// Content tokens of `text` (see the module docs).
pub fn content_tokens(text: &str) -> HashSet<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| {
            !t.is_empty()
                && (t.chars().count() >= 3 || t.chars().any(|c| c.is_ascii_digit()))
                && !STOPWORDS.contains(t)
        })
        .map(str::to_owned)
        .collect()
}

/// One answer-bearing turn and the tokens that identify it.
#[derive(Debug, Clone)]
pub struct EvidenceTurn {
    /// Dataset id of the turn's session.
    pub session_id: String,
    /// Distinctive tokens (or all content tokens when `fallback`).
    pub distinctive: HashSet<String>,
    /// No token was rare enough; `distinctive` holds every content token.
    pub fallback: bool,
    /// Gold-answer content tokens that occur in this turn.
    pub answer: HashSet<String>,
}

/// Every `has_answer` turn of `q` with its distinctive and answer tokens.
pub fn evidence_turns(q: &Question) -> Vec<EvidenceTurn> {
    // Document frequency over distinct sessions (repeated ids count once).
    let mut seen = HashSet::new();
    let mut df: HashMap<String, usize> = HashMap::new();
    for (sid, turns) in q.haystack_session_ids.iter().zip(&q.haystack_sessions) {
        if !seen.insert(sid.as_str()) {
            continue;
        }
        let mut session_tokens = HashSet::new();
        for t in turns {
            session_tokens.extend(content_tokens(&t.content));
        }
        for tok in session_tokens {
            *df.entry(tok).or_default() += 1;
        }
    }
    let answer_tokens = content_tokens(&q.gold_answer_text());

    let mut out = Vec::new();
    let mut emitted = HashSet::new();
    for (sid, turns) in q.haystack_session_ids.iter().zip(&q.haystack_sessions) {
        // A repeated session's turns are the same evidence, counted once.
        if !emitted.insert(sid.as_str()) {
            continue;
        }
        for t in turns.iter().filter(|t| t.is_evidence()) {
            let tokens = content_tokens(&t.content);
            let distinctive: HashSet<String> = tokens
                .iter()
                .filter(|tok| df.get(*tok).copied().unwrap_or(0) <= DF_MAX)
                .cloned()
                .collect();
            let fallback = distinctive.is_empty();
            let answer = answer_tokens.intersection(&tokens).cloned().collect();
            out.push(EvidenceTurn {
                session_id: sid.clone(),
                distinctive: if fallback { tokens } else { distinctive },
                fallback,
                answer,
            });
        }
    }
    out
}

/// Fraction of `target` present in `surface`; `None` for an empty target.
pub fn coverage(target: &HashSet<String>, surface: &HashSet<String>) -> Option<f64> {
    if target.is_empty() {
        return None;
    }
    let found = target.iter().filter(|t| surface.contains(*t)).count();
    Some(found as f64 / target.len() as f64)
}

/// Whether every token of `target` is in `surface`; `None` when empty.
pub fn contains_all(target: &HashSet<String>, surface: &HashSet<String>) -> Option<bool> {
    (!target.is_empty()).then(|| target.iter().all(|t| surface.contains(t)))
}

/// The prefix of `body` the local embedder reads.
pub struct EmbedWindow {
    tokenizer: tokenizers::Tokenizer,
}

impl EmbedWindow {
    /// Load the local model's tokenizer from `models_root`, configured the
    /// way `LocalEmbedder` configures it (no padding, 512-token cap).
    pub fn load(models_root: &Path) -> Result<Self> {
        let path = models_root.join("all-MiniLM-L6-v2/tokenizer.json");
        let mut tokenizer = tokenizers::Tokenizer::from_file(&path)
            .map_err(|e| anyhow::anyhow!("loading tokenizer {}: {e}", path.display()))?;
        tokenizer.with_padding(None);
        tokenizer
            .with_truncation(Some(tokenizers::TruncationParams {
                max_length: EMBED_MAX_TOKENS,
                ..Default::default()
            }))
            .map_err(|e| anyhow::anyhow!("configuring truncation: {e}"))?;
        Ok(Self { tokenizer })
    }

    /// The slice of `body` that survives both embedder truncations.
    pub fn window<'a>(&self, body: &'a str) -> Result<&'a str> {
        let pre = pre_truncate(body);
        let enc = self
            .tokenizer
            .encode(pre, true)
            .map_err(|e| anyhow::anyhow!("tokenizing: {e}"))?;
        let last = enc
            .get_offsets()
            .iter()
            .zip(enc.get_special_tokens_mask())
            .filter(|(_, special)| **special == 0)
            .map(|((_, end), _)| *end)
            .max()
            .unwrap_or(0);
        Ok(&pre[..last.min(pre.len())])
    }
}

/// The byte cut `truncate_for_embedding` applies before tokenizing: bodies
/// over the budget keep their first `budget - len("…")` bytes (the ellipsis
/// it appends lies past the 512-token window, so it is not modelled).
fn pre_truncate(body: &str) -> &str {
    if body.len() <= EMBED_PRE_TRUNCATE_BYTES {
        return body;
    }
    let mut end = EMBED_PRE_TRUNCATE_BYTES - "…".len();
    while !body.is_char_boundary(end) {
        end -= 1;
    }
    &body[..end]
}

/// Reachability of one evidence turn through each surface.
#[derive(Debug, Clone, Serialize)]
pub struct TurnReach {
    pub page: f64,
    /// `None` when the ingest mode stores no observations.
    pub observations: Option<f64>,
    /// `None` without an embed window (no tokenizer loaded).
    pub embed512: Option<f64>,
    pub answer_page: Option<bool>,
    pub answer_observations: Option<bool>,
    pub answer_embed512: Option<bool>,
    pub fallback: bool,
}

/// Reachability for one question.
#[derive(Debug, Clone, Serialize)]
pub struct QuestionReach {
    pub question_id: String,
    pub question_type: String,
    /// Distinct sessions holding at least one evidence turn.
    pub evidence_sessions: usize,
    /// Of those, how many had a session page when read back.
    pub pages_present: usize,
    /// Page ingest modes: pages whose stored body is shorter than the
    /// document sent (any server-side truncation).
    pub pages_truncated: usize,
    pub turns: Vec<TurnReach>,
}

/// Text of one session's surfaces.
#[derive(Default)]
struct Surfaces {
    page: HashSet<String>,
    page_present: bool,
    page_truncated: bool,
    observations: Option<HashSet<String>>,
    embed512: Option<HashSet<String>>,
}

/// Read back every evidence session of `q` and score its evidence turns.
pub async fn measure_question(
    client: &reqwest::Client,
    base_url: &str,
    q: &Question,
    mode: IngestMode,
    prefix: DatePrefix,
    embed: Option<&EmbedWindow>,
) -> Result<QuestionReach> {
    let turns = evidence_turns(q);
    let project = project_for(q);
    let mut surfaces: BTreeMap<String, Surfaces> = BTreeMap::new();
    for t in &turns {
        if surfaces.contains_key(&t.session_id) {
            continue;
        }
        let idx = q
            .haystack_session_ids
            .iter()
            .position(|s| *s == t.session_id)
            .context("evidence session not in haystack")?;
        let uuid = stored_session_uuid(q, &t.session_id);
        let mut s = Surfaces::default();
        if let Some((title, body)) = read_page(client, base_url, &project, uuid).await? {
            s.page_present = true;
            s.page = content_tokens(&format!("{title}\n{body}"));
            if let Some(embed) = embed {
                s.embed512 = Some(content_tokens(embed.window(&body)?));
            }
            if mode != IngestMode::Hooks {
                let sent = session_document(
                    mode,
                    prefix,
                    &q.haystack_dates[idx],
                    &q.haystack_sessions[idx],
                );
                s.page_truncated = body.len() < sent.len();
            }
        } else if embed.is_some() {
            s.embed512 = Some(HashSet::new());
        }
        if mode == IngestMode::Hooks {
            let text = read_observations(client, base_url, &project, uuid).await?;
            s.observations = Some(content_tokens(&text));
        }
        surfaces.insert(t.session_id.clone(), s);
    }

    let reaches = turns
        .iter()
        .map(|t| {
            let s = &surfaces[&t.session_id];
            TurnReach {
                page: coverage(&t.distinctive, &s.page).unwrap_or(0.0),
                observations: s
                    .observations
                    .as_ref()
                    .map(|o| coverage(&t.distinctive, o).unwrap_or(0.0)),
                embed512: s
                    .embed512
                    .as_ref()
                    .map(|e| coverage(&t.distinctive, e).unwrap_or(0.0)),
                answer_page: contains_all(&t.answer, &s.page),
                answer_observations: s
                    .observations
                    .as_ref()
                    .and_then(|o| contains_all(&t.answer, o)),
                answer_embed512: s.embed512.as_ref().and_then(|e| contains_all(&t.answer, e)),
                fallback: t.fallback,
            }
        })
        .collect();
    Ok(QuestionReach {
        question_id: q.question_id.clone(),
        question_type: q.question_type.clone(),
        evidence_sessions: surfaces.len(),
        pages_present: surfaces.values().filter(|s| s.page_present).count(),
        pages_truncated: surfaces.values().filter(|s| s.page_truncated).count(),
        turns: reaches,
    })
}

/// `(title, body)` of `sessions/<uuid>.md`, or `None` when it does not exist.
async fn read_page(
    client: &reqwest::Client,
    base_url: &str,
    project: &str,
    uuid: uuid::Uuid,
) -> Result<Option<(String, String)>> {
    let args = json!({
        "workspace": EVAL_WORKSPACE,
        "project": project,
        "path": format!("sessions/{uuid}.md"),
    });
    let text = match mcp_tool_text(client, base_url, "memory_read_page", args).await {
        Ok(text) => text,
        Err(e) if format!("{e:#}").to_lowercase().contains("not found") => return Ok(None),
        Err(e) => return Err(e),
    };
    let v: serde_json::Value = serde_json::from_str(&text).context("parsing memory_read_page")?;
    let field = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    Ok(Some((field("title"), field("body"))))
}

/// Every observation title and body of one session, concatenated.
async fn read_observations(
    client: &reqwest::Client,
    base_url: &str,
    project: &str,
    uuid: uuid::Uuid,
) -> Result<String> {
    const PAGE: usize = 200;
    let mut out = String::new();
    let mut offset = 0usize;
    loop {
        let args = json!({
            "workspace": EVAL_WORKSPACE,
            "project": project,
            "session_id": uuid.to_string(),
            "limit": PAGE,
            "offset": offset,
            "body_max_chars": 16_384,
        });
        let text =
            mcp_tool_text(client, base_url, "memory_read_session_observations", args).await?;
        let v: serde_json::Value =
            serde_json::from_str(&text).context("parsing memory_read_session_observations")?;
        let Some(obs) = v.get("observations").and_then(|o| o.as_array()) else {
            bail!("memory_read_session_observations returned no observations array: {text}");
        };
        for o in obs {
            for k in ["title", "body"] {
                if let Some(s) = o.get(k).and_then(|x| x.as_str()) {
                    out.push_str(s);
                    out.push('\n');
                }
            }
        }
        if obs.len() < PAGE {
            return Ok(out);
        }
        offset += PAGE;
    }
}

/// Aggregated reachability for one slice.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ReachSlice {
    pub questions: usize,
    pub evidence_turns: usize,
    pub fallback_turns: usize,
    pub evidence_sessions: usize,
    pub pages_present: usize,
    pub pages_truncated: usize,
    /// Share of evidence turns reachable (coverage ≥ threshold).
    pub turn_reach_page: f64,
    pub turn_reach_observations: Option<f64>,
    pub turn_reach_embed512: Option<f64>,
    /// Mean distinctive-token coverage.
    pub mean_cov_page: f64,
    pub mean_cov_observations: Option<f64>,
    pub mean_cov_embed512: Option<f64>,
    /// Answer-anchored: turns whose literal answer tokens all survive.
    pub answer_turns: usize,
    pub answer_page: Option<f64>,
    pub answer_observations: Option<f64>,
    pub answer_embed512: Option<f64>,
    /// Share of questions with at least one reachable evidence turn.
    pub question_ceiling_page: f64,
    pub question_ceiling_observations: Option<f64>,
    pub question_ceiling_embed512: Option<f64>,
}

fn mean(values: &[f64]) -> Option<f64> {
    (!values.is_empty()).then(|| values.iter().sum::<f64>() / values.len() as f64)
}

fn share(flags: impl Iterator<Item = bool>) -> Option<f64> {
    let (mut yes, mut n) = (0usize, 0usize);
    for f in flags {
        n += 1;
        yes += usize::from(f);
    }
    (n > 0).then(|| yes as f64 / n as f64)
}

/// Aggregate one group of questions.
fn slice(group: &[&QuestionReach]) -> ReachSlice {
    let turns: Vec<&TurnReach> = group.iter().flat_map(|q| &q.turns).collect();
    let page_cov: Vec<f64> = turns.iter().map(|t| t.page).collect();
    let obs_cov: Vec<f64> = turns.iter().filter_map(|t| t.observations).collect();
    let emb_cov: Vec<f64> = turns.iter().filter_map(|t| t.embed512).collect();
    let reach = |c: &f64| *c >= REACH_THRESHOLD;
    let q_any = |pick: fn(&TurnReach) -> Option<f64>| {
        let has_surface = group
            .iter()
            .any(|q| q.turns.iter().any(|t| pick(t).is_some()));
        has_surface
            .then(|| {
                share(group.iter().map(|q| {
                    q.turns
                        .iter()
                        .any(|t| pick(t).is_some_and(|c| c >= REACH_THRESHOLD))
                }))
            })
            .flatten()
    };
    ReachSlice {
        questions: group.len(),
        evidence_turns: turns.len(),
        fallback_turns: turns.iter().filter(|t| t.fallback).count(),
        evidence_sessions: group.iter().map(|q| q.evidence_sessions).sum(),
        pages_present: group.iter().map(|q| q.pages_present).sum(),
        pages_truncated: group.iter().map(|q| q.pages_truncated).sum(),
        turn_reach_page: share(page_cov.iter().map(reach)).unwrap_or(0.0),
        turn_reach_observations: share(obs_cov.iter().map(reach)),
        turn_reach_embed512: share(emb_cov.iter().map(reach)),
        mean_cov_page: mean(&page_cov).unwrap_or(0.0),
        mean_cov_observations: mean(&obs_cov),
        mean_cov_embed512: mean(&emb_cov),
        answer_turns: turns.iter().filter(|t| t.answer_page.is_some()).count(),
        answer_page: share(turns.iter().filter_map(|t| t.answer_page)),
        answer_observations: share(turns.iter().filter_map(|t| t.answer_observations)),
        answer_embed512: share(turns.iter().filter_map(|t| t.answer_embed512)),
        question_ceiling_page: q_any(|t| Some(t.page)).unwrap_or(0.0),
        question_ceiling_observations: q_any(|t| t.observations),
        question_ceiling_embed512: q_any(|t| t.embed512),
    }
}

/// Per question type plus `overall`, as the retrieval slices are keyed.
pub fn aggregate(per_question: &[QuestionReach]) -> BTreeMap<String, ReachSlice> {
    let mut groups: BTreeMap<String, Vec<&QuestionReach>> = BTreeMap::new();
    for q in per_question {
        groups.entry(q.question_type.clone()).or_default().push(q);
        groups.entry("overall".into()).or_default().push(q);
    }
    groups.into_iter().map(|(k, g)| (k, slice(&g))).collect()
}

/// The reachability section appended to a run's markdown report.
pub fn to_markdown(slices: &BTreeMap<String, ReachSlice>) -> String {
    let opt = |v: Option<f64>| v.map_or("n/a".to_string(), |v| format!("{v:.3}"));
    let mut md = format!(
        "\n### Evidence reachability\n\n\
         Distinctive tokens: content tokens in ≤{DF_MAX} haystack sessions; a turn is \
         reachable at ≥{REACH_THRESHOLD} coverage. Ceiling = share of questions with ≥1 \
         reachable evidence turn.\n\n\
         | slice | q | ev. turns | pages present | truncated | turn reach page | obs | embed512 | \
         answer turns | answer page | obs | embed512 | ceiling page | obs | embed512 |\n\
         |---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n"
    );
    for (name, s) in slices {
        md.push_str(&format!(
            "| {name} | {} | {} | {}/{} | {} | {:.3} | {} | {} | {} | {} | {} | {} | {:.3} | {} | {} |\n",
            s.questions,
            s.evidence_turns,
            s.pages_present,
            s.evidence_sessions,
            s.pages_truncated,
            s.turn_reach_page,
            opt(s.turn_reach_observations),
            opt(s.turn_reach_embed512),
            s.answer_turns,
            opt(s.answer_page),
            opt(s.answer_observations),
            opt(s.answer_embed512),
            s.question_ceiling_page,
            opt(s.question_ceiling_observations),
            opt(s.question_ceiling_embed512),
        ));
    }
    md
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(words: &[&str]) -> HashSet<String> {
        words.iter().map(|w| (*w).to_string()).collect()
    }

    #[test]
    fn content_tokens_drop_stopwords_and_short_words_but_keep_numbers() {
        let t = content_tokens("I bought THE boots for $45 in 2 days, it's ok.");
        assert_eq!(t, set(&["bought", "boots", "45", "2", "days"]));
    }

    fn question(sessions: serde_json::Value, ids: &[&str], answer: &str) -> Question {
        let n = ids.len();
        serde_json::from_value(json!({
            "question_id": "q",
            "question_type": "single-session-user",
            "question": "?",
            "answer": answer,
            "question_date": "d",
            "haystack_dates": vec!["d"; n],
            "haystack_session_ids": ids,
            "haystack_sessions": sessions,
            "answer_session_ids": [ids[0]]
        }))
        .unwrap()
    }

    #[test]
    fn distinctive_tokens_are_rare_across_the_haystack() {
        // "weather" occurs in all five sessions, "quokka" only in the first.
        let mut sessions = vec![json!([
            {"role": "user", "content": "weather talk about my quokka", "has_answer": true}
        ])];
        for _ in 0..4 {
            sessions.push(json!([{"role": "user", "content": "weather again"}]));
        }
        let q = question(json!(sessions), &["a", "b", "c", "d", "e"], "quokka");
        let turns = evidence_turns(&q);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].distinctive, set(&["talk", "quokka"]));
        assert!(!turns[0].fallback);
        assert_eq!(turns[0].answer, set(&["quokka"]));
    }

    #[test]
    fn a_turn_without_rare_tokens_falls_back_to_all_content_tokens() {
        let sessions: Vec<_> = (0..5)
            .map(|i| json!([{"role": "user", "content": "common words", "has_answer": i == 0}]))
            .collect();
        let q = question(json!(sessions), &["a", "b", "c", "d", "e"], "x");
        let turns = evidence_turns(&q);
        assert_eq!(turns.len(), 1);
        assert!(turns[0].fallback);
        assert_eq!(turns[0].distinctive, set(&["common", "words"]));
        assert!(turns[0].answer.is_empty());
    }

    #[test]
    fn repeated_sessions_count_once_for_frequency_and_evidence() {
        let s = json!([{"role": "user", "content": "rare zebra", "has_answer": true}]);
        let q = question(
            json!([s.clone(), s.clone(), s.clone(), s]),
            &["a", "a", "a", "a"],
            "z",
        );
        let turns = evidence_turns(&q);
        // One distinct session: df = 1, one evidence turn.
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].distinctive, set(&["rare", "zebra"]));
    }

    #[test]
    fn pre_truncation_matches_the_embedder_byte_budget() {
        let short = "a".repeat(EMBED_PRE_TRUNCATE_BYTES);
        assert_eq!(pre_truncate(&short).len(), EMBED_PRE_TRUNCATE_BYTES);
        let long = "é".repeat(EMBED_PRE_TRUNCATE_BYTES);
        let cut = pre_truncate(&long);
        assert!(cut.len() <= EMBED_PRE_TRUNCATE_BYTES - "…".len());
        assert!(cut.len() >= EMBED_PRE_TRUNCATE_BYTES - "…".len() - 1);
    }

    /// Runs only where the model has been fetched (`evals/models/`).
    #[test]
    fn the_embed_window_stops_at_512_tokens() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("models");
        let Ok(window) = EmbedWindow::load(&root) else {
            return;
        };
        let words: Vec<String> = (0..2000).map(|i| format!("w{i}")).collect();
        let body = words.join(" ");
        let kept = window.window(&body).unwrap();
        assert!(kept.len() < body.len());
        assert!(body.starts_with(kept));
        let short = "a short body";
        assert_eq!(window.window(short).unwrap(), short);
    }

    #[test]
    fn coverage_and_answer_checks() {
        let target = set(&["quokka", "leather", "boots", "january"]);
        let surface = set(&["quokka", "boots", "other"]);
        assert_eq!(coverage(&target, &surface), Some(0.5));
        assert_eq!(coverage(&HashSet::new(), &surface), None);
        assert_eq!(
            contains_all(&set(&["quokka", "boots"]), &surface),
            Some(true)
        );
        assert_eq!(
            contains_all(&set(&["quokka", "january"]), &surface),
            Some(false)
        );
        assert_eq!(contains_all(&HashSet::new(), &surface), None);
    }

    #[test]
    fn a_title_cut_word_does_not_count_as_reached() {
        // The page title keeps "kitche…", which must not match "kitchen".
        let page = content_tokens("[session date: 2023/05/30] I got new kitche…");
        assert!(!page.contains("kitchen"));
        assert!(page.contains("kitche"));
    }

    fn reach(page: f64, obs: Option<f64>) -> TurnReach {
        TurnReach {
            page,
            observations: obs,
            embed512: None,
            answer_page: Some(page >= 1.0),
            answer_observations: None,
            answer_embed512: None,
            fallback: false,
        }
    }

    #[test]
    fn aggregation_reports_turn_shares_and_the_question_ceiling() {
        let q1 = QuestionReach {
            question_id: "q1".into(),
            question_type: "a".into(),
            evidence_sessions: 1,
            pages_present: 1,
            pages_truncated: 0,
            turns: vec![reach(0.2, Some(1.0)), reach(1.0, Some(1.0))],
        };
        let q2 = QuestionReach {
            question_id: "q2".into(),
            question_type: "b".into(),
            evidence_sessions: 2,
            pages_present: 1,
            pages_truncated: 0,
            turns: vec![reach(0.0, Some(0.6))],
        };
        let agg = aggregate(&[q1, q2]);
        let all = &agg["overall"];
        assert_eq!(all.evidence_turns, 3);
        assert!((all.turn_reach_page - 1.0 / 3.0).abs() < 1e-9);
        assert_eq!(all.turn_reach_observations, Some(1.0));
        assert_eq!(all.turn_reach_embed512, None);
        // q1 has a page-reachable turn, q2 does not.
        assert_eq!(all.question_ceiling_page, 0.5);
        assert_eq!(all.question_ceiling_observations, Some(1.0));
        assert_eq!(all.question_ceiling_embed512, None);
        assert_eq!(all.pages_present, 2);
        assert_eq!(all.evidence_sessions, 3);
        assert_eq!(agg["a"].questions, 1);
    }
}
