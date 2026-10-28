//! Small text helpers shared by provider implementations.

/// Truncate to at most `max_bytes` without splitting a UTF-8 codepoint.
pub(crate) fn truncate_with_ellipsis(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }

    let mut end = 0;
    for (idx, ch) in s.char_indices() {
        let next = idx + ch.len_utf8();
        if next > max_bytes {
            break;
        }
        end = next;
    }
    format!("{}…", &s[..end])
}

/// Return a suffix no longer than `max_bytes`, aligned to a UTF-8 boundary.
pub(crate) fn suffix_within_bytes(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let start = s
        .char_indices()
        .map(|(idx, _)| idx)
        .find(|idx| s.len() - idx <= max_bytes)
        .unwrap_or(s.len());
    &s[start..]
}

/// Truncate text so it fits provider input limits (e.g. OpenAI/OpenRouter
/// 8192 tokens). Dense markdown/code can approach ~1 byte/token, so we cap
/// both a token budget (optimistic prose) and a hard byte ceiling.
pub(crate) fn truncate_for_embedding(text: &str, max_tokens: usize) -> String {
    const HARD_MAX_BYTES: usize = 8_000;
    const ELLIPSIS_BYTES: usize = "…".len();
    let token_budget_bytes = max_tokens.saturating_mul(3);
    let max_bytes = token_budget_bytes.min(HARD_MAX_BYTES);
    if text.len() <= max_bytes {
        return text.to_string();
    }
    if max_bytes <= ELLIPSIS_BYTES {
        return String::new();
    }
    truncate_with_ellipsis(text, max_bytes - ELLIPSIS_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_keeps_ascii_prefix() {
        assert_eq!(truncate_with_ellipsis("abcdef", 3), "abc…");
        assert_eq!(truncate_with_ellipsis("abc", 3), "abc");
    }

    #[test]
    fn truncate_never_splits_utf8() {
        let s = format!("{}é", "x".repeat(1023));
        let truncated = truncate_with_ellipsis(&s, 1024);
        assert!(truncated.ends_with('…'));
        assert_eq!(truncated.chars().last(), Some('…'));
    }

    #[test]
    fn suffix_never_splits_utf8() {
        let s = format!("é{}", "x".repeat(1023));
        assert_eq!(suffix_within_bytes(&s, 1024), "x".repeat(1023));
    }

    #[test]
    fn truncate_for_embedding_caps_long_input() {
        let long = "x".repeat(50_000);
        let out = truncate_for_embedding(&long, 6000);
        assert!(out.ends_with('…'));
        assert!(out.len() < long.len());
        assert!(out.len() <= 8_000);
    }
}
