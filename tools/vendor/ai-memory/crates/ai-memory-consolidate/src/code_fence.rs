//! Fenced code block tracking for the line scanners in this crate.
//!
//! Auto-improve's heading parser and profile harvesting both walk a page
//! line by line and must skip fenced code. Toggling on any fence line lets
//! a lone ```` ``` ```` inside a `~~~` block (or a shorter run inside a
//! longer fence) end the block early, so code after it reads as headings
//! or prose (#1316). This follows CommonMark §4.5 the way
//! `ai_memory_wiki`'s link scanner does.

/// The open fence's glyph and run length.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CodeFence {
    glyph: char,
    len: usize,
}

impl CodeFence {
    /// The fence state after `line`, and whether `line` is a fence line or
    /// code inside a fence.
    pub(crate) fn step(current: Option<Self>, line: &str) -> (Option<Self>, bool) {
        let in_fence = current.is_some();
        let leading_spaces = line.as_bytes().iter().take_while(|&&b| b == b' ').count();
        if leading_spaces > 3 {
            return (current, in_fence);
        }
        let trimmed = &line[leading_spaces..];
        let glyph = match trimmed.chars().next() {
            Some(c @ ('`' | '~')) => c,
            _ => return (current, in_fence),
        };
        let len = trimmed.chars().take_while(|&c| c == glyph).count();
        if len < 3 {
            return (current, in_fence);
        }
        let info = &trimmed[len..];
        match current {
            // A backtick fence's info string cannot contain a backtick, so
            // ```` ```code``` text ```` is a paragraph with an inline span.
            None if glyph == '`' && info.contains('`') => (None, false),
            None => (Some(Self { glyph, len }), true),
            // Only a run of the same glyph, at least as long and with no
            // info string, closes the fence.
            Some(open) if open.glyph == glyph && len >= open.len && info.trim().is_empty() => {
                (None, true)
            }
            Some(open) => (Some(open), true),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::CodeFence;

    fn code_lines(text: &str) -> Vec<bool> {
        let mut fence = None;
        text.lines()
            .map(|line| {
                let (next, is_code) = CodeFence::step(fence, line);
                fence = next;
                is_code
            })
            .collect()
    }

    #[test]
    fn a_fence_closes_only_on_its_own_glyph_with_a_run_at_least_as_long() {
        assert_eq!(
            code_lines("~~~sh\n```\nx\n~~~\nprose"),
            [true, true, true, true, false]
        );
        assert_eq!(
            code_lines("````md\n```\nx\n```\n````\nprose"),
            [true, true, true, true, true, false]
        );
        assert_eq!(
            code_lines("```\nx\n``` rust\ny\n```\nprose"),
            [true, true, true, true, true, false]
        );
    }

    #[test]
    fn a_backtick_run_with_a_backtick_in_its_info_string_is_not_a_fence() {
        assert_eq!(code_lines("```code``` text\nprose"), [false, false]);
        assert_eq!(
            code_lines("~~~ `ok`\nx\n~~~\nprose"),
            [true, true, true, false]
        );
    }

    #[test]
    fn a_run_shorter_than_three_is_not_a_fence() {
        assert_eq!(code_lines("``\nprose"), [false, false]);
    }

    #[test]
    fn only_zero_to_three_ascii_spaces_may_prefix_a_fence() {
        for spaces in 0..=3 {
            let prefix = " ".repeat(spaces);
            assert_eq!(
                code_lines(&format!("{prefix}````md\ninside\n{prefix}````\nafter")),
                [true, true, true, false],
                "{spaces} spaces"
            );
        }

        for prefix in ["    ", "\t", "\u{2003}"] {
            assert_eq!(
                code_lines(&format!("{prefix}````md\ninside\n{prefix}````\nafter")),
                [false, false, false, false],
                "prefix {prefix:?} must not delimit a fence"
            );
            assert_eq!(
                code_lines(&format!("````md\n{prefix}````\nstill code\n````\nafter")),
                [true, true, true, true, false],
                "prefix {prefix:?} must not close a fence"
            );
        }
    }
}
