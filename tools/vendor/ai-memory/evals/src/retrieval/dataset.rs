//! LongMemEval (v1, S variant) dataset loading.
//!
//! The file is NOT committed (278 MB); it lives gitignored under
//! `evals/datasets/` and is fetched on demand from HuggingFace with a
//! pinned sha256. Dataset: `xiaowu0162/longmemeval` (MIT license).
//!
//! Two pinned variants load: the original `longmemeval_s` (every published
//! ai-memory baseline) and the later `longmemeval_s_cleaned` re-release,
//! which keeps the same 500 questions and evidence labels but replaces
//! distractor sessions that also held the answer. Other systems publish on
//! the cleaned file, so a comparison has to say which one it ran.

use std::path::Path;

use anyhow::{Context, Result, bail};
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// Canonical download URL for the S variant.
pub const LONGMEMEVAL_S_URL: &str =
    "https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main/longmemeval_s";

/// sha256 of `longmemeval_s` as pinned on 2026-09-01. A drifted upstream
/// file fails loudly instead of silently changing published numbers.
pub const LONGMEMEVAL_S_SHA256: &str =
    "08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894";

/// One pinned dataset file the harness accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DatasetVariant {
    /// Name recorded in reports.
    pub name: &'static str,
    /// Default location under the repo root.
    pub default_path: &'static str,
    /// Download URL (revision-pinned where upstream allows it).
    pub url: &'static str,
    /// Expected sha256 of the file.
    pub sha256: &'static str,
}

/// The original S file every published ai-memory baseline uses.
pub const VARIANT_S: DatasetVariant = DatasetVariant {
    name: "longmemeval_s",
    default_path: "evals/datasets/longmemeval_s.json",
    url: LONGMEMEVAL_S_URL,
    sha256: LONGMEMEVAL_S_SHA256,
};

/// The cleaned S re-release (`xiaowu0162/longmemeval-cleaned`, revision
/// `98d7416c`), the input agentmemory's 2026-10-09 baseline reports on.
pub const VARIANT_S_CLEANED: DatasetVariant = DatasetVariant {
    name: "longmemeval_s_cleaned",
    default_path: "evals/datasets/longmemeval_s_cleaned.json",
    url: "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/98d7416c24c778c2fee6e6f3006e7a073259d48f/longmemeval_s_cleaned.json",
    sha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
};

/// One chat turn inside a haystack session.
#[derive(Debug, Clone, Deserialize)]
pub struct Turn {
    pub role: String,
    pub content: String,
    /// The dataset's evidence flag: this turn carries (part of) the answer.
    /// Absent on most turns; only the reachability report reads it.
    #[serde(default)]
    pub has_answer: Option<bool>,
}

impl Turn {
    /// True when the dataset marks this turn as answer-bearing.
    pub fn is_evidence(&self) -> bool {
        self.has_answer == Some(true)
    }
}

/// One benchmark question with its private haystack of chat sessions.
#[derive(Debug, Clone, Deserialize)]
pub struct Question {
    pub question_id: String,
    pub question_type: String,
    pub question: String,
    /// Gold answer. Usually a JSON string; occasionally a richer value.
    /// Read via [`Question::gold_answer_text`] for the QA judge (R2b).
    pub answer: serde_json::Value,
    #[allow(dead_code)]
    pub question_date: String,
    pub haystack_dates: Vec<String>,
    pub haystack_session_ids: Vec<String>,
    pub haystack_sessions: Vec<Vec<Turn>>,
    /// Dataset session ids of the sessions holding the evidence.
    pub answer_session_ids: Vec<String>,
}

impl Question {
    /// Abstention questions (`*_abs`) deliberately have a false premise;
    /// no session contains an answer, so they are excluded from recall
    /// metrics and reported separately.
    pub fn is_abstention(&self) -> bool {
        self.question_id.ends_with("_abs")
    }

    /// The gold answer as text for the LLM-as-judge (R2b QA mode). A JSON
    /// string is unwrapped to its contents; any other shape is rendered as
    /// compact JSON so the judge still sees the reference value.
    pub fn gold_answer_text(&self) -> String {
        match &self.answer {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        }
    }
}

/// Load the dataset, verifying `variant`'s pinned sha256 first.
pub fn load(path: &Path, variant: &DatasetVariant) -> Result<Vec<Question>> {
    let bytes = std::fs::read(path).with_context(|| {
        format!(
            "reading dataset at {} (use --fetch to download)",
            path.display()
        )
    })?;
    let digest = hex::encode(Sha256::digest(&bytes));
    if digest != variant.sha256 {
        bail!(
            "dataset sha256 mismatch at {}: got {digest}, pinned {} for {}. \
             Refusing to benchmark against an unpinned file.",
            path.display(),
            variant.sha256,
            variant.name
        );
    }
    let questions: Vec<Question> =
        serde_json::from_slice(&bytes).context("parsing longmemeval_s JSON")?;
    for q in &questions {
        if q.haystack_sessions.len() != q.haystack_session_ids.len()
            || q.haystack_sessions.len() != q.haystack_dates.len()
        {
            bail!(
                "question {}: sessions/ids/dates length mismatch ({}/{}/{})",
                q.question_id,
                q.haystack_sessions.len(),
                q.haystack_session_ids.len(),
                q.haystack_dates.len()
            );
        }
    }
    Ok(questions)
}

/// Download the dataset to `path` (atomically: tmp + rename) and verify
/// the pinned sha256 before the rename lands it.
pub async fn fetch(path: &Path, variant: &DatasetVariant) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    tracing::info!(url = variant.url, "downloading {} (~278 MB)", variant.name);
    let resp = reqwest::get(variant.url).await?.error_for_status()?;
    let bytes = resp.bytes().await?;
    let digest = hex::encode(Sha256::digest(&bytes));
    if digest != variant.sha256 {
        bail!(
            "downloaded dataset sha256 {digest} does not match pin {}",
            variant.sha256
        );
    }
    let tmp = path.with_extension("part");
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// First `per_type` questions of each question type, types in sorted order
/// (the same deterministic selection as agentmemory's `stratifySample`).
/// A prefix sample (`--sample`) only covers the first type, because the file
/// is grouped by type; this one covers every slice.
pub fn stratify(questions: Vec<Question>, per_type: usize) -> Vec<Question> {
    let mut buckets: std::collections::BTreeMap<String, Vec<Question>> =
        std::collections::BTreeMap::new();
    for q in questions {
        let bucket = buckets.entry(q.question_type.clone()).or_default();
        if bucket.len() < per_type {
            bucket.push(q);
        }
    }
    buckets.into_values().flatten().collect()
}

mod hex {
    /// Minimal lowercase hex, avoiding a dependency for one call site.
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes.as_ref().iter().map(|b| format!("{b:02x}")).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_json() -> serde_json::Value {
        serde_json::json!([{
            "question_id": "q1",
            "question_type": "single-session-user",
            "question": "what degree?",
            "answer": "Business",
            "question_date": "2023/05/30 (Tue) 23:40",
            "haystack_dates": ["2023/05/20 (Sat) 02:21"],
            "haystack_session_ids": ["sharegpt_abc_0"],
            "haystack_sessions": [[
                {"role": "user", "content": "I studied Business", "has_answer": true},
                {"role": "assistant", "content": "Nice."}
            ]],
            "answer_session_ids": ["sharegpt_abc_0"]
        }])
    }

    #[test]
    fn parses_the_dataset_shape() {
        let qs: Vec<Question> = serde_json::from_value(sample_json()).unwrap();
        assert_eq!(qs.len(), 1);
        assert_eq!(qs[0].haystack_sessions[0][0].role, "user");
        assert!(!qs[0].is_abstention());
    }

    #[test]
    fn gold_answer_unwraps_a_json_string_and_renders_other_shapes() {
        let mut qs: Vec<Question> = serde_json::from_value(sample_json()).unwrap();
        assert_eq!(qs[0].gold_answer_text(), "Business");
        qs[0].answer = serde_json::json!(["a", "b"]);
        assert_eq!(qs[0].gold_answer_text(), "[\"a\",\"b\"]");
    }

    #[test]
    fn abstention_is_detected_from_the_id_suffix() {
        let mut qs: Vec<Question> = serde_json::from_value(sample_json()).unwrap();
        qs[0].question_id = "q1_abs".into();
        assert!(qs[0].is_abstention());
    }

    #[test]
    fn a_tampered_dataset_fails_the_pin() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("longmemeval_s.json");
        std::fs::write(&p, serde_json::to_vec(&sample_json()).unwrap()).unwrap();
        let err = load(&p, &VARIANT_S).unwrap_err().to_string();
        assert!(err.contains("sha256 mismatch"), "{err}");
        let err = load(&p, &VARIANT_S_CLEANED).unwrap_err().to_string();
        assert!(err.contains("longmemeval_s_cleaned"), "{err}");
    }

    #[test]
    fn the_evidence_flag_is_read_and_defaults_to_absent() {
        let qs: Vec<Question> = serde_json::from_value(sample_json()).unwrap();
        let turns = &qs[0].haystack_sessions[0];
        assert!(turns[0].is_evidence());
        assert_eq!(turns[1].has_answer, None);
        assert!(!turns[1].is_evidence());
    }

    #[test]
    fn stratify_takes_a_prefix_of_every_type_in_sorted_order() {
        let mut qs: Vec<Question> = Vec::new();
        let base: Vec<Question> = serde_json::from_value(sample_json()).unwrap();
        for (i, ty) in ["b-type", "a-type", "b-type", "b-type", "a-type"]
            .iter()
            .enumerate()
        {
            let mut q = base[0].clone();
            q.question_id = format!("q{i}");
            q.question_type = (*ty).into();
            qs.push(q);
        }
        let picked: Vec<String> = stratify(qs, 2).into_iter().map(|q| q.question_id).collect();
        assert_eq!(picked, ["q1", "q4", "q0", "q2"]);
    }
}
