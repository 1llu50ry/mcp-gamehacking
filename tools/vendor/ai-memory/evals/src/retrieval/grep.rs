//! `--engine grep`: a whole-session term-overlap baseline with no server.
//!
//! It reproduces agentmemory's `eval/runner/adapters/grep.ts` so the two
//! harnesses can be calibrated against each other on the same questions:
//!
//! - a session's document is `[Source session date: <date>]` followed by
//!   every turn as `[<role>] <content>`, joined by blank lines (their
//!   `sessionText` over `loadLongMemEval`'s flattening);
//! - query terms are the lowercased `[a-z0-9_]+` runs longer than two
//!   characters, duplicates kept;
//! - a session scores one point per query term that occurs anywhere in its
//!   lowercased document (substring match, so `boot` matches `boots`);
//! - sessions with no matching term are dropped, and ties keep haystack
//!   order (a stable sort, as in JavaScript);
//! - a repeated session id keeps its first position (their loader
//!   coalesces repeats into the first occurrence).
//!
//! It measures what plain lexical overlap over the full raw transcript can
//! reach, before any capture, truncation, or ranking choice of ours.

use std::collections::HashSet;

use super::dataset::{Question, Turn};
use super::ingest::stored_session_uuid;

/// Query terms, agentmemory-compatible: lowercase, split on anything that
/// is not `[a-z0-9_]`, keep tokens longer than two characters. Duplicates
/// are kept, so a repeated query word counts twice.
pub fn tokenize(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'))
        .filter(|t| t.len() > 2)
        .map(str::to_owned)
        .collect()
}

/// One session rendered as a single document (see the module docs).
pub fn session_text(date: &str, turns: &[Turn]) -> String {
    let body = turns
        .iter()
        .map(|t| format!("[{}] {}", t.role, t.content))
        .collect::<Vec<_>>()
        .join("\n\n");
    format!("[Source session date: {date}]\n{body}")
}

/// Rank `(id, lowercased document)` pairs for `query`, best first.
pub fn rank<'a, T: Copy>(query: &str, docs: impl IntoIterator<Item = (T, &'a str)>) -> Vec<T> {
    let terms = tokenize(query);
    let mut scored: Vec<(T, usize)> = docs
        .into_iter()
        .filter_map(|(id, body)| {
            let hits = terms.iter().filter(|t| body.contains(t.as_str())).count();
            (hits > 0).then_some((id, hits))
        })
        .collect();
    // `sort_by_key` is stable: equal scores keep haystack order.
    scored.sort_by_key(|(_, hits)| std::cmp::Reverse(*hits));
    scored.into_iter().map(|(id, _)| id).collect()
}

/// Rank one question's haystack sessions, returning stored session uuids.
pub fn rank_question(q: &Question) -> Vec<uuid::Uuid> {
    let mut seen = HashSet::new();
    let docs: Vec<(uuid::Uuid, String)> = q
        .haystack_session_ids
        .iter()
        .zip(&q.haystack_dates)
        .zip(&q.haystack_sessions)
        .filter(|((id, _), _)| seen.insert(id.as_str()))
        .map(|((id, date), turns)| {
            (
                stored_session_uuid(q, id),
                session_text(date, turns).to_lowercase(),
            )
        })
        .collect();
    rank(
        &q.question,
        docs.iter().map(|(id, body)| (*id, body.as_str())),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(role: &str, content: &str) -> Turn {
        Turn {
            role: role.into(),
            content: content.into(),
            has_answer: None,
        }
    }

    #[test]
    fn tokenize_matches_the_reference_adapter() {
        // `[^a-z0-9_]+` split after lowercasing, then length > 2.
        assert_eq!(
            tokenize("What's my dog's NAME, in 2023? a_b x"),
            ["what", "dog", "name", "2023", "a_b"]
        );
        // Duplicates are kept: the reference does not dedupe query terms.
        assert_eq!(tokenize("boot boot"), ["boot", "boot"]);
        // Non-ASCII letters split words, as `[^a-z0-9_]` does.
        assert_eq!(tokenize("café latte"), ["caf", "latte"]);
    }

    #[test]
    fn session_text_flattens_roles_under_a_date_line() {
        let t = session_text("2023/05/20", &[turn("user", "hi"), turn("assistant", "yo")]);
        assert_eq!(
            t,
            "[Source session date: 2023/05/20]\n[user] hi\n\n[assistant] yo"
        );
    }

    #[test]
    fn rank_counts_term_occurrence_drops_zero_and_keeps_tie_order() {
        let docs = [
            (1, "nothing relevant"),
            (2, "my boots are leather"),
            (3, "leather boots and leather care"),
            (4, "boots only"),
        ];
        // query terms: leather, boots → doc 2 and 3 score 2, doc 4 scores 1.
        let ranked = rank("leather boots", docs);
        assert_eq!(ranked, [2, 3, 4]);
    }

    #[test]
    fn substring_matching_credits_inflections() {
        assert_eq!(rank("boot", [(1, "two boots")]), [1]);
    }

    #[test]
    fn repeated_query_terms_weigh_double() {
        let docs = [(1, "alpha"), (2, "beta")];
        assert_eq!(rank("beta beta alpha", docs), [2, 1]);
    }

    #[test]
    fn repeated_session_ids_keep_their_first_position() {
        let q: Question = serde_json::from_value(serde_json::json!({
            "question_id": "q",
            "question_type": "multi-session",
            "question": "quokka",
            "answer": "a",
            "question_date": "d",
            "haystack_dates": ["d1", "d2", "d3"],
            "haystack_session_ids": ["s_a", "s_b", "s_a"],
            "haystack_sessions": [
                [{"role": "user", "content": "quokka"}],
                [{"role": "user", "content": "quokka"}],
                [{"role": "user", "content": "quokka"}]
            ],
            "answer_session_ids": ["s_b"]
        }))
        .unwrap();
        let ranked = rank_question(&q);
        assert_eq!(
            ranked,
            [
                stored_session_uuid(&q, "s_a"),
                stored_session_uuid(&q, "s_b")
            ]
        );
    }
}
