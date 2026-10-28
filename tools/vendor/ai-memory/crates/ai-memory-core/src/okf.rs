//! Open Knowledge Format (OKF) v0.2 conformance.
//!
//! From 2.0 on, every wiki page is natively an OKF concept file: YAML
//! frontmatter with a non-empty `type`, trust/provenance keys following
//! the spec's actor convention, and ai-memory's own fields riding along
//! as spec-safe extensions ("consumers MUST NOT reject documents with
//! unrecognized fields"). Design: `docs/okf.md`. Spec:
//! `GoogleCloudPlatform/knowledge-catalog`, `okf/SPEC.md`.
//!
//! Split matters here:
//!
//! - [`conform_frontmatter`] fills only keys that are **deterministic**
//!   for a given (path, frontmatter) — `type`, `generated.by`,
//!   `sources`, `stale_after`, `description`. Calling it twice yields
//!   identical bytes, so the store's identical-content idempotency
//!   check keeps working.
//! - `generated.at` is deliberately NOT set here: it changes per
//!   version, so the store stamps it only when content actually
//!   changed (see `upsert_page_in_tx`), comparing idempotency modulo
//!   [`strip_generated_at`].

use serde_json::{Map, Value, json};

/// OKF version this build writes and understands.
pub const OKF_VERSION: &str = "0.2";

/// `generated.by` for pages produced by ai-memory itself (the zero-LLM
/// consolidator, scaffolding, sweeps) — the spec's `process:<id>` actor
/// form, versioned so a bundle records which build wrote what.
#[must_use]
pub fn process_actor() -> String {
    format!("process:ai-memory/{}", env!("CARGO_PKG_VERSION"))
}

/// Derive the required OKF `type` from the page's path family, with an
/// explicit `kind`/`slot_kind` frontmatter value taking precedence over
/// the path default.
#[must_use]
pub fn derive_type(path: &str, frontmatter: &Value) -> String {
    if let Some(kind) = frontmatter.get("kind").and_then(Value::as_str) {
        match kind {
            "fact" => return "Fact".into(),
            "note" => return "Note".into(),
            "procedure" => return "Procedure".into(),
            "decision" => return "Decision".into(),
            _ => {}
        }
    }
    if let Some(slot) = frontmatter.get("slot_kind").and_then(Value::as_str) {
        match slot {
            "invariant" => return "Invariant".into(),
            "state" => return "State".into(),
            _ => {}
        }
    }
    let family = path.split('/').next().unwrap_or("");
    match family {
        "sessions" => "Session Summary",
        "_rules" => "Rule",
        "gotchas" => "Gotcha",
        "decisions" => "Decision",
        "procedures" => "Procedure",
        "concepts" => "Concept",
        "notes" => "Note",
        "runbooks" => "Runbook",
        "_slots" => "State",
        "_lint" => "Lint Report",
        "_pending" => "Pending Note",
        _ => "Note",
    }
    .into()
}

/// Fill the deterministic OKF keys into `frontmatter`, touching nothing
/// already present and inventing nothing non-derivable. Idempotent:
/// conforming conformed frontmatter is a no-op.
pub fn conform_frontmatter(path: &str, frontmatter: &mut Value) {
    if !frontmatter.is_object() {
        *frontmatter = Value::Object(Map::new());
    }
    let derived_type = derive_type(path, frontmatter);
    let map = frontmatter.as_object_mut().expect("object ensured above");

    if map
        .get("type")
        .and_then(Value::as_str)
        .is_none_or(|t| t.trim().is_empty())
    {
        map.insert("type".into(), Value::String(derived_type));
    }

    // description ← existing summary (recommended key; only when we
    // actually have one).
    if !map.contains_key("description")
        && let Some(summary) = map.get("summary").and_then(Value::as_str)
        && !summary.trim().is_empty()
    {
        map.insert("description".into(), Value::String(summary.to_string()));
    }

    // stale_after ← existing TTL. OKF timestamps must carry an explicit
    // UTC offset, but `expires_at` also accepts a bare `YYYY-MM-DD`
    // (end of that day, UTC): render that as the instant it names. An
    // RFC 3339 value already conforms and is carried verbatim.
    if !map.contains_key("stale_after")
        && let Some(expires) = map.get("expires_at").and_then(Value::as_str)
        && let Some(instant) = crate::page::parse_expires_at_instant(expires)
    {
        let stale_after = if expires.trim().parse::<jiff::Timestamp>().is_ok() {
            expires.to_string()
        } else {
            instant.to_string()
        };
        map.insert("stale_after".into(), Value::String(stale_after));
    }
    // A page an older build conformed carries the bare date it copied;
    // any rewrite of it (a restore, a hand edit, a reindex) repairs it.
    repair_date_only_stale_after_in(map);

    // sources ← session provenance already stamped by the consolidator.
    if !map.contains_key("sources")
        && let Some(session) = map.get("session_id").and_then(Value::as_str)
    {
        let mut entry = Map::new();
        entry.insert(
            "resource".into(),
            Value::String(format!("ai-memory://session/{session}")),
        );
        if let Some(agent) = map.get("agent").and_then(Value::as_str) {
            // The OKF actor grammar (§5.1) requires `<producer>/<version>`
            // for agents or `process:<id>` for automated processes; a bare
            // `claude-code` matches neither. We don't track a per-harness
            // semantic version, so `<producer>/<version>` isn't honestly
            // derivable — `process:<id>` is the correct, non-fabricated
            // choice.
            entry.insert("author".into(), Value::String(format!("process:{agent}")));
        }
        map.insert("sources".into(), Value::Array(vec![Value::Object(entry)]));
    }

    // generated.by — the actor that produced the content. LLM-written
    // pages carry a model identity in `generated_by_model` (when the
    // consolidator knows it); everything else is this process.
    let by = map
        .get("generated_by_model")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(process_actor);
    match map.get_mut("generated") {
        Some(Value::Object(generated)) => {
            generated
                .entry("by".to_string())
                .or_insert(Value::String(by));
        }
        _ => {
            map.insert("generated".into(), json!({ "by": by }));
        }
    }
}

/// Repair a `stale_after` that a build before this rule copied verbatim from
/// a date-only `expires_at`. The signature is exact: `stale_after` equals
/// `expires_at` and is not an RFC 3339 instant. It becomes the instant the
/// TTL expires the page, which is what [`conform_frontmatter`] derives today,
/// so a repaired page matches one written fresh. Returns whether it changed
/// anything; a `stale_after` that differs from `expires_at` is left alone.
pub fn repair_date_only_stale_after(frontmatter: &mut Value) -> bool {
    frontmatter
        .as_object_mut()
        .is_some_and(repair_date_only_stale_after_in)
}

fn repair_date_only_stale_after_in(map: &mut Map<String, Value>) -> bool {
    let (Some(Value::String(stale)), Some(Value::String(expires))) =
        (map.get("stale_after"), map.get("expires_at"))
    else {
        return false;
    };
    if stale != expires || stale.trim().parse::<jiff::Timestamp>().is_ok() {
        return false;
    }
    let Some(instant) = crate::page::parse_expires_at_instant(expires) else {
        return false;
    };
    map.insert("stale_after".into(), Value::String(instant.to_string()));
    true
}

/// Clone `frontmatter` with `generated.at` removed — the store compares
/// idempotency on this projection so an unchanged page never supersedes
/// itself over a timestamp.
#[must_use]
pub fn strip_generated_at(frontmatter: &Value) -> Value {
    let mut out = frontmatter.clone();
    if let Some(generated) = out.get_mut("generated").and_then(Value::as_object_mut) {
        generated.remove("at");
    }
    out
}

/// Stamp `generated.at` (ISO-8601, UTC seconds) onto conformed
/// frontmatter. Called only when the store decided content changed.
pub fn stamp_generated_at(frontmatter: &mut Value, at_iso8601: &str) {
    if let Some(generated) = frontmatter
        .get_mut("generated")
        .and_then(Value::as_object_mut)
    {
        generated.insert("at".into(), Value::String(at_iso8601.to_string()));
    }
}

/// The `generated.at` value, when present.
#[must_use]
pub fn generated_at(frontmatter: &Value) -> Option<&str> {
    frontmatter.get("generated")?.get("at")?.as_str()
}

/// A file-level conformance verdict for one page's frontmatter.
#[must_use]
pub fn is_conformant(frontmatter: &Value) -> bool {
    frontmatter
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|t| !t.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_families_map_to_types() {
        for (path, expected) in [
            ("sessions/0192.md", "Session Summary"),
            ("_rules/deploy.md", "Rule"),
            ("gotchas/build.md", "Gotcha"),
            ("decisions/arch.md", "Decision"),
            ("procedures/release.md", "Procedure"),
            ("concepts/writer.md", "Concept"),
            ("notes/misc.md", "Note"),
            ("runbooks/oncall.md", "Runbook"),
            ("_lint/report.md", "Lint Report"),
            ("_pending/queue.md", "Pending Note"),
            ("unknown/where.md", "Note"),
        ] {
            assert_eq!(derive_type(path, &json!({})), expected, "{path}");
        }
    }

    #[test]
    fn kind_and_slot_kind_win_over_the_path_default() {
        assert_eq!(derive_type("notes/x.md", &json!({"kind": "fact"})), "Fact");
        assert_eq!(
            derive_type("_slots/current.md", &json!({"slot_kind": "invariant"})),
            "Invariant"
        );
        assert_eq!(
            derive_type("_slots/current.md", &json!({"slot_kind": "state"})),
            "State"
        );
    }

    #[test]
    fn conform_is_idempotent_and_preserves_existing_keys() {
        let mut fm = json!({
            "title": "T",
            "tier": "episodic",
            "session_id": "0192aaaa-0000-7000-8000-000000000000",
            "agent": "claude-code",
            "summary": "what happened",
            "expires_at": "2027-01-01T00:00:00Z",
        });
        conform_frontmatter("sessions/0192.md", &mut fm);
        let once = fm.clone();
        conform_frontmatter("sessions/0192.md", &mut fm);
        assert_eq!(once, fm, "second conform changed bytes");

        assert_eq!(fm["type"], "Session Summary");
        assert_eq!(fm["description"], "what happened");
        assert_eq!(fm["stale_after"], "2027-01-01T00:00:00Z");
        assert_eq!(
            fm["sources"][0]["resource"],
            "ai-memory://session/0192aaaa-0000-7000-8000-000000000000"
        );
        assert_eq!(fm["sources"][0]["author"], "process:claude-code");
        assert!(
            fm["generated"]["by"]
                .as_str()
                .unwrap()
                .starts_with("process:ai-memory/")
        );
        // extensions untouched
        assert_eq!(fm["tier"], "episodic");
    }

    #[test]
    fn a_date_only_ttl_becomes_an_offset_bearing_stale_after() {
        let mut fm = json!({"expires_at": "2026-10-01"});
        conform_frontmatter("notes/x.md", &mut fm);
        let once = fm.clone();
        conform_frontmatter("notes/x.md", &mut fm);
        assert_eq!(once, fm, "second conform changed bytes");
        // The TTL's own reading of a bare date: the end of that day, UTC.
        assert_eq!(fm["stale_after"], "2026-10-01T23:59:59.999999Z");
        assert_eq!(fm["expires_at"], "2026-10-01");
    }

    #[test]
    fn an_rfc3339_ttl_is_carried_into_stale_after_verbatim() {
        let mut fm = json!({"expires_at": "2026-10-01T12:00:00-03:00"});
        conform_frontmatter("notes/x.md", &mut fm);
        assert_eq!(fm["stale_after"], "2026-10-01T12:00:00-03:00");
    }

    #[test]
    fn an_unparseable_ttl_derives_no_stale_after() {
        let mut fm = json!({"expires_at": "soon"});
        conform_frontmatter("notes/x.md", &mut fm);
        assert!(fm.get("stale_after").is_none());
    }

    #[test]
    fn a_stale_after_copied_from_a_date_only_ttl_is_repaired() {
        let mut fm = json!({"expires_at": "2026-10-01", "stale_after": "2026-10-01"});
        assert!(repair_date_only_stale_after(&mut fm));
        assert_eq!(fm["stale_after"], "2026-10-01T23:59:59.999999Z");
        assert!(
            !repair_date_only_stale_after(&mut fm),
            "repair is idempotent"
        );

        // conform_frontmatter repairs it too, so any rewrite heals the page.
        let mut old = json!({"expires_at": "2026-10-01", "stale_after": "2026-10-01"});
        conform_frontmatter("notes/x.md", &mut old);
        assert_eq!(old["stale_after"], "2026-10-01T23:59:59.999999Z");
    }

    #[test]
    fn a_stale_after_that_is_not_the_verbatim_copy_is_left_alone() {
        for mut fm in [
            json!({"expires_at": "2026-10-01", "stale_after": "2026-09-01"}),
            json!({"expires_at": "2026-10-01T12:00:00Z", "stale_after": "2026-10-01T12:00:00Z"}),
            json!({"stale_after": "2026-10-01"}),
        ] {
            let before = fm.clone();
            assert!(!repair_date_only_stale_after(&mut fm));
            assert_eq!(fm, before);
        }
    }

    #[test]
    fn an_explicit_type_is_never_overwritten() {
        let mut fm = json!({"type": "Custom Thing"});
        conform_frontmatter("notes/x.md", &mut fm);
        assert_eq!(fm["type"], "Custom Thing");
    }

    #[test]
    fn an_empty_type_is_repaired() {
        let mut fm = json!({"type": "  "});
        conform_frontmatter("gotchas/x.md", &mut fm);
        assert_eq!(fm["type"], "Gotcha");
    }

    #[test]
    fn generated_at_round_trip_is_invisible_to_the_idempotency_projection() {
        let mut fm = json!({"title": "T"});
        conform_frontmatter("notes/x.md", &mut fm);
        let before = strip_generated_at(&fm);
        stamp_generated_at(&mut fm, "2026-09-01T12:00:00Z");
        assert_eq!(fm["generated"]["at"], "2026-09-01T12:00:00Z");
        assert_eq!(strip_generated_at(&fm), before);
    }

    #[test]
    fn an_llm_model_identity_becomes_generated_by() {
        let mut fm = json!({"generated_by_model": "openai-compat/qwen3:32b"});
        conform_frontmatter("sessions/x.md", &mut fm);
        assert_eq!(fm["generated"]["by"], "openai-compat/qwen3:32b");
    }

    #[test]
    fn sources_author_uses_the_process_actor_form() {
        // OKF §5.1's actor grammar requires `<producer>/<version>` for an
        // agent or `process:<id>` for an automated process; a bare agent
        // name like `claude-code` matches neither. We don't track a
        // per-harness semantic version, so `process:<agent>` is the honest
        // choice, not a fabricated version.
        let mut fm = json!({
            "session_id": "0192aaaa-0000-7000-8000-000000000000",
            "agent": "codex",
        });
        conform_frontmatter("sessions/x.md", &mut fm);
        assert_eq!(fm["sources"][0]["author"], "process:codex");
    }

    #[test]
    fn conformance_verdict_requires_a_non_empty_type() {
        assert!(!is_conformant(&json!({})));
        assert!(!is_conformant(&json!({"type": ""})));
        assert!(is_conformant(&json!({"type": "Note"})));
    }
}
