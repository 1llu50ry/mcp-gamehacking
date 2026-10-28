//! Shared model-path sanitization for LLM-produced wiki paths.
//!
//! Bootstrap (#847), per-session consolidation (#848), and auto-improve
//! review all accept a page path straight from LLM structured output.
//! Bootstrap and consolidation hand it to `Wiki::apply_batch`, which is
//! atomic: a single path that fails `PagePath::ensure_portable` at write
//! time aborts every page in that batch, not just its own. Auto-improve
//! stages the path and only hits `ensure_portable` on approve, so a bad
//! path becomes an unapplyable proposal. `PagePath::new` is deliberately
//! tolerant (see its doc comment) and does not catch this, so callers must
//! sanitize the raw model path themselves before constructing a `PagePath`.

/// Filename characters Windows refuses, mirroring
/// `ai_memory_core::ids`'s reserved-char set, plus `\` — `PagePath::new`
/// already rejects a literal backslash anywhere in the raw path (it reads as
/// a separator), so a component containing one must be cleaned before
/// `PagePath::new` ever sees it, not after.
use ai_memory_core::ids::is_dos_device_name;

pub(crate) const PATH_ILLEGAL_CHARS: &[char] = &['<', '>', ':', '"', '|', '?', '*', '\\'];

/// Clean a model-produced page path so it survives `PagePath::new` and
/// `ensure_portable`.
///
/// The LLM sometimes echoes free text — a conventional-commit subject like
/// `build(sandbox): orchestrate` — straight into a page path. That passes
/// `PagePath::new` (deliberately tolerant; see its doc comment) but fails
/// `ensure_portable`, which `Wiki::apply_batch` enforces atomically: one bad
/// path there aborts every page in the batch, not just its own (#847, #848).
/// Auto-improve review stages the path and hits the same check on approve.
/// Replace every Windows-illegal character and ASCII control byte in each
/// `/`-separated component with `-`, keeping the `dir/subdir/name.md` shape
/// intact so the model's intended layout survives.
///
/// The model also omits the `.md` extension on multi-page paths (`decisions/
/// smart-model-luna` instead of `.../smart-model-luna.md`, #885). The rule
/// branch in `build_update` always appends `.md` itself, but the non-rule
/// branch — and bootstrap and auto-improve — route straight through this
/// helper, so a bare path would be stored extensionless and read back as a
/// non-portable wiki page. Append `.md` to the final component when it lacks
/// it (case-insensitive), which is idempotent: a path already ending in `.md`
/// is left untouched.
pub(crate) fn slugify_page_path(raw: &str) -> String {
    let mut segments: Vec<String> = raw
        .split('/')
        .map(|segment| {
            segment
                .chars()
                .map(|c| {
                    if PATH_ILLEGAL_CHARS.contains(&c) || (c as u32) < 0x20 {
                        '-'
                    } else {
                        c
                    }
                })
                .collect::<String>()
        })
        .map(make_component_portable)
        .collect();
    // Append the `.md` extension when the model omitted it on the filename
    // component (#885). The check is case-insensitive so `NAME.MD` is not
    // double-extended, keeping the whole operation idempotent. Skip an empty
    // final component: an empty or trailing-slash path has no filename to
    // extend, and fabricating `.md` there would turn a missing/invalid path
    // into a plausible-looking one that slips past the callers' own
    // empty-path rejection (auto-improve reported `unsupported_path_prefix`
    // instead of `invalid_path`). An empty path stays empty and is rejected
    // upstream as before.
    if let Some(last) = segments.last_mut()
        && !last.is_empty()
        && !last.to_ascii_lowercase().ends_with(".md")
    {
        last.push_str(".md");
    }
    segments.join("/")
}

/// Fix the two component shapes `ensure_portable` refuses that character
/// replacement alone cannot: a trailing dot or space (Windows strips it on
/// create) is trimmed, and a DOS device stem (`CON`, `aux`, `nul.md`) gets a
/// `-` appended to the stem so it no longer names a device. Components that
/// are nothing but dots or spaces are left for `PagePath::new` to reject.
fn make_component_portable(segment: String) -> String {
    let trimmed = segment.trim_end_matches(['.', ' ']);
    let segment = if trimmed.is_empty() {
        segment
    } else {
        trimmed.to_string()
    };
    let stem_len = segment.split('.').next().map_or(0, str::len);
    if is_dos_device_name(&segment[..stem_len]) {
        let mut renamed = segment;
        renamed.insert(stem_len, '-');
        return renamed;
    }
    segment
}

#[cfg(test)]
mod tests {
    use super::slugify_page_path;
    use ai_memory_core::ids::PagePath;

    #[test]
    fn slugify_page_path_repairs_trailing_and_dos_device_components() {
        // Each of these is one of the component shapes repaired here. Other
        // portability checks (for example the 255-byte component limit) stay
        // fail-closed in `ensure_portable` instead of silently rewriting a
        // model path beyond recognition.
        for (raw, expected) in [
            ("notes/v2./roadmap.md", "notes/v2/roadmap.md"),
            ("notes/q3 plan /roadmap.md", "notes/q3 plan/roadmap.md"),
            ("decisions/why? /x", "decisions/why-/x.md"),
            ("concepts/aux.md", "concepts/aux-.md"),
            ("CON/notes.md", "CON-/notes.md"),
            ("decisions/nul", "decisions/nul-.md"),
        ] {
            let slug = slugify_page_path(raw);
            assert_eq!(slug, expected, "{raw:?}");
            PagePath::new(&slug)
                .and_then(|path| path.ensure_portable())
                .unwrap_or_else(|err| panic!("{raw:?} -> {slug:?} still not portable: {err}"));
        }
    }

    #[test]
    fn slugify_page_path_replaces_illegal_chars_and_keeps_slashes() {
        assert_eq!(
            slugify_page_path("concepts/build(sandbox): orchestrate the run.md"),
            "concepts/build(sandbox)- orchestrate the run.md"
        );
        assert_eq!(
            slugify_page_path("a/b<c>d:e\"f|g?h*i\\j.md"),
            "a/b-c-d-e-f-g-h-i-j.md"
        );
        assert_eq!(
            slugify_page_path("concepts/clean-path.md"),
            "concepts/clean-path.md",
            "an already-portable path must be left unchanged"
        );
    }

    #[test]
    fn slugify_page_path_appends_md_when_the_model_omits_it() {
        // #885: multi-page consolidation echoes a bare model path with no
        // extension; the helper must land it as a portable `.md` page.
        let slug = slugify_page_path("decisions/smart-model-luna");
        assert!(
            slug.ends_with("-luna.md"),
            "bare model path must gain a .md extension, got {slug:?}"
        );
        assert_eq!(slug, "decisions/smart-model-luna.md");
    }

    #[test]
    fn slugify_page_path_extension_append_is_idempotent() {
        // A path already ending in `.md` (any casing) keeps its single
        // extension — the helper never double-extends.
        assert_eq!(
            slugify_page_path("decisions/smart-model-luna.md"),
            "decisions/smart-model-luna.md"
        );
        assert_eq!(
            slugify_page_path("decisions/SHOUTING.MD"),
            "decisions/SHOUTING.MD",
            "an existing .MD extension is recognized case-insensitively"
        );
    }

    #[test]
    fn slugify_page_path_does_not_fabricate_a_filename_from_an_empty_path() {
        // #885 regression: appending `.md` to an empty final component would
        // turn a missing/invalid path into `.md` (or `dir/.md`), which slips
        // past a caller's own empty-path rejection. An empty path stays empty,
        // and a trailing slash keeps its empty final component, so the missing
        // filename is still rejected upstream (auto-improve `invalid_path`).
        assert_eq!(slugify_page_path(""), "");
        assert_eq!(slugify_page_path("decisions/"), "decisions/");
    }
}
