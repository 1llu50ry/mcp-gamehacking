//! Compile-time prompt assembly. The `## WIKILINKS` section is shared by the
//! single, batch and bootstrap prompts; each `.md` carries a `{{wikilinks}}`
//! line and the fragment's `{{sources}}` and `{{basis}}` slots take the per-prompt wording.
//! Done in const evaluation so the prompts stay `const &str`.

/// Shared wikilink guidance; `{{sources}}` names where link targets may come from
/// and `{{basis}}` what the same-project links must clearly relate to.
pub(crate) const WIKILINKS: &str = include_str!("../prompts/wikilinks_fragment.md");

const fn matches_at(t: &[u8], k: &[u8], i: usize) -> bool {
    if i + k.len() > t.len() {
        return false;
    }
    let mut j = 0;
    while j < k.len() {
        if t[i + j] != k[j] {
            return false;
        }
        j += 1;
    }
    true
}

const fn count(t: &[u8], k: &[u8]) -> usize {
    let (mut i, mut n) = (0, 0);
    while i < t.len() {
        if matches_at(t, k, i) {
            n += 1;
            i += k.len();
        } else {
            i += 1;
        }
    }
    n
}

pub(crate) const fn count_str(t: &str, k: &str) -> usize {
    count(t.as_bytes(), k.as_bytes())
}

pub(crate) const fn replaced_len(t: &str, k: &str, v: &str) -> usize {
    t.len() - count(t.as_bytes(), k.as_bytes()) * k.len()
        + count(t.as_bytes(), k.as_bytes()) * v.len()
}

pub(crate) const fn replaced<const N: usize>(t: &str, k: &str, v: &str) -> [u8; N] {
    let (t, k, v) = (t.as_bytes(), k.as_bytes(), v.as_bytes());
    let mut out = [0u8; N];
    let (mut i, mut o) = (0, 0);
    while i < t.len() {
        if matches_at(t, k, i) {
            let mut j = 0;
            while j < v.len() {
                out[o] = v[j];
                o += 1;
                j += 1;
            }
            i += k.len();
        } else {
            out[o] = t[i];
            o += 1;
            i += 1;
        }
    }
    out
}

/// `replace!(template, key, value)` as a `&'static str` constant.
macro_rules! replace {
    ($t:expr, $k:expr, $v:expr) => {{
        const N: usize = $crate::prompt_template::replaced_len($t, $k, $v);
        const BYTES: [u8; N] = $crate::prompt_template::replaced::<N>($t, $k, $v);
        match ::core::str::from_utf8(&BYTES) {
            Ok(s) => s,
            Err(_) => panic!("prompt template is not UTF-8"),
        }
    }};
}

/// Expands the shared wikilink fragment into `$template`, naming `$sources`
/// as the allowed origin of cross-scope link targets and `$basis` as what
/// same-project links must clearly relate to.
macro_rules! prompt_with_wikilinks {
    ($template:expr, $sources:expr, $basis:expr) => {{
        const WITH_SOURCES: &str = $crate::prompt_template::replace!(
            $crate::prompt_template::WIKILINKS,
            "{{sources}}",
            $sources
        );
        const FRAGMENT: &str = $crate::prompt_template::replace!(WITH_SOURCES, "{{basis}}", $basis);
        // Match the placeholder's own line ending so a CRLF checkout still expands.
        const LF: &str = $crate::prompt_template::replace!($template, "{{wikilinks}}\n", FRAGMENT);
        const OUT: &str = $crate::prompt_template::replace!(LF, "{{wikilinks}}\r\n", FRAGMENT);
        const _: () = assert!(
            $crate::prompt_template::count_str(OUT, "{{wikilinks}}") == 0
                && $crate::prompt_template::count_str($template, "{{wikilinks}}") == 1,
            "prompt must hold exactly one expanded wikilinks placeholder"
        );
        OUT
    }};
}
pub(crate) use {prompt_with_wikilinks, replace};

#[cfg(test)]
mod tests {
    const TPL_LF: &str = "a\n{{wikilinks}}\nb\n";
    const TPL_CRLF: &str = "a\r\n{{wikilinks}}\r\nb\r\n";

    #[test]
    fn expands_placeholder_for_lf_and_crlf_templates() {
        let lf = prompt_with_wikilinks!(TPL_LF, "the input", "the input");
        let crlf = prompt_with_wikilinks!(TPL_CRLF, "the input", "the input");
        for out in [lf, crlf] {
            assert!(
                !out.contains("{{wikilinks}}")
                    && !out.contains("{{sources}}")
                    && !out.contains("{{basis}}")
            );
            assert_eq!(out.matches("## WIKILINKS").count(), 1);
        }
    }

    #[test]
    fn shipped_prompts_have_no_leftover_placeholder() {
        for p in [
            crate::consolidator::BATCH_SYSTEM_PROMPT,
            crate::consolidator::SYSTEM_PROMPT,
            crate::bootstrap::SYSTEM_PROMPT,
        ] {
            assert!(
                !p.contains("{{wikilinks}}")
                    && !p.contains("{{sources}}")
                    && !p.contains("{{basis}}")
            );
            assert_eq!(p.matches("## WIKILINKS").count(), 1);
        }
    }

    #[test]
    fn per_prompt_wording_fills_the_slots() {
        let flat = |p: &str| p.split_whitespace().collect::<Vec<_>>().join(" ");
        for p in [
            crate::consolidator::BATCH_SYSTEM_PROMPT,
            crate::consolidator::SYSTEM_PROMPT,
        ] {
            let p = flat(p);
            assert!(
                p.contains("only if that exact path appears in the observations or page body.")
            );
            assert!(p.contains("same-project page the observations clearly relate to."));
        }
        let p = flat(crate::bootstrap::SYSTEM_PROMPT);
        assert!(p.contains("only if that exact path appears in the supplied sources."));
        assert!(p.contains("same-project page the sources clearly relate to."));
    }
}
