//! Narrow repair for hook JSON cut between UTF-16 surrogate escapes.

/// Replace each `\u` escape that names half of a UTF-16 surrogate pair without
/// its other half with U+FFFD. Harnesses that cut tool output mid-emoji can
/// emit such JSON, and `serde_json` rejects the whole event for one bad escape.
/// An escaped backslash (`\\ud83d`) is text and stays unchanged.
///
/// Returns `None` when nothing was replaced.
#[must_use]
pub fn replace_lone_surrogate_escapes(text: &str) -> Option<String> {
    let code_unit_at = |at: usize| {
        let digits = text.as_bytes().get(at..at + 6)?.strip_prefix(b"\\u")?;
        u16::from_str_radix(std::str::from_utf8(digits).ok()?, 16).ok()
    };
    let (mut out, mut copied, mut at) = (String::new(), 0, 0);
    while let Some(offset) = text.get(at..).and_then(|rest| rest.find('\\')) {
        at += offset;
        match code_unit_at(at) {
            // `\\`, `\n`, `\"` and the like: skip the escaped character too.
            None => at += 2,
            Some(0xD800..=0xDBFF) if matches!(code_unit_at(at + 6), Some(0xDC00..=0xDFFF)) => {
                at += 12;
            }
            Some(0xD800..=0xDFFF) => {
                out.push_str(&text[copied..at]);
                out.push(char::REPLACEMENT_CHARACTER);
                at += 6;
                copied = at;
            }
            Some(_) => at += 6,
        }
    }
    if copied == 0 {
        return None;
    }
    out.push_str(&text[copied..]);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::replace_lone_surrogate_escapes;

    #[test]
    fn repairs_only_unpaired_surrogate_escapes() {
        let raw = r#"{"text":"\ud83d \ud83d\ude00 \\ud83d \\\ude00"}"#;
        assert_eq!(
            replace_lone_surrogate_escapes(raw).as_deref(),
            Some(r#"{"text":"� \ud83d\ude00 \\ud83d \\�"}"#)
        );
        assert!(replace_lone_surrogate_escapes(r#"{"text":"\ud83d\ude00"}"#).is_none());
    }
}
