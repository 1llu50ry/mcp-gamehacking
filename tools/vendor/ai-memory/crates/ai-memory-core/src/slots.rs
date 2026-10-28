//! Naming rules for memory slots (`_slots/…`).
//!
//! A slot is a small mutable page — "what I am working on", pending items,
//! project context — that the engine injects into every session start for its
//! project. On a server shared by several people that makes one operator's
//! working context everybody's, so slots can optionally be namespaced per
//! operator:
//!
//! * `_slots/current-focus.md` — **shared** with the whole project. Every
//!   pre-existing slot has this shape, and it stays visible to everyone.
//! * `_slots/u-alice/current-focus.md` — belongs to the operator whose
//!   [`IdentityKey::path_segment`] is `u-alice`; only they see it in their
//!   brief.
//!
//! The namespace segment is always [`IdentityKey::path_segment`] — never a raw
//! username or subject. Raw values could not carry this weight: a subject is
//! often a URL, and a name containing a GLOB metacharacter would read every
//! other operator's namespace through the SQL patterns the store builds. The
//! segment encoding settles both at the type: it is **total** (path-hostile
//! values use a bounded deterministic identifier, so every identified
//! operator owns a namespace) and it is `[A-Za-z0-9._-]` by construction
//! (nothing to escape, nowhere to traverse).
//!
//! Shared-when-unprefixed mirrors the `NULL owner = shared` rule ownership
//! uses elsewhere ([`crate::OwnerFilter`]), so turning the feature on cannot
//! orphan or reinterpret anything already stored. One consequence is worth
//! naming: a nested path written BEFORE the feature (`_slots/backend/…`)
//! names a segment no qualified identity can produce, so with `[slots]
//! per_user` on it is nobody's — hidden from every brief until the feature is
//! turned back off or an admin re-homes it. With the feature off it stays an
//! ordinary shared slot, exactly as it always was.

use crate::IdentityKey;

/// Path prefix marking a slot page.
pub const SLOT_PREFIX: &str = "_slots/";

/// Is this a slot page (shared or personal)?
#[must_use]
pub fn is_slot_path(path: &str) -> bool {
    path.starts_with(SLOT_PREFIX)
}

/// The namespace segment a slot belongs to, or `None` when it is shared.
///
/// Only the FIRST path segment after the prefix is considered, and only when
/// the slot has a nested shape: `_slots/u-alice/current-focus.md` belongs to
/// the `u-alice` namespace, `_slots/current-focus.md` is shared.
#[must_use]
pub fn slot_owner(path: &str) -> Option<&str> {
    let rest = path.strip_prefix(SLOT_PREFIX)?;
    let (owner, remainder) = rest.split_once('/')?;
    if owner.is_empty() || remainder.is_empty() {
        return None;
    }
    Some(owner)
}

/// Which slot pages a reader is allowed to see.
///
/// "Per-user slots are off" and "per-user slots are on but the viewer is
/// unidentified" are different rules, and an `Option<&str>` cannot tell them
/// apart. The difference is load-bearing: with the feature off a pre-existing
/// `_slots/backend/context.md` is an ordinary shared slot that everyone must
/// keep seeing, while with it on the same shape names a namespace the viewer
/// may not own.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum SlotVisibility {
    /// Every `_slots/…` page, personal namespaces included.
    ///
    /// The rule that predates per-user slots, hence the default: with
    /// `[slots] per_user` off a nested slot path carries no ownership meaning,
    /// so hiding it would silently drop a page from an existing brief. Also the
    /// right rule for views that deliberately show the whole wiki.
    #[default]
    All,
    /// Shared (un-namespaced) slots, plus the viewer's own namespace when the
    /// request names anyone. What `[slots] per_user` turns a session brief
    /// into.
    Owner {
        /// The viewer's [`IdentityKey::path_segment`]. `None` — an
        /// unattributed request — sees the shared slots only.
        namespace: Option<String>,
    },
}

impl SlotVisibility {
    /// The rule for `viewer` when `[slots] per_user` is `per_user`.
    ///
    /// `viewer` is [`crate::ActorContext::identity_key`] — the same accessor
    /// every ownership decision keys on, so the read filter and the write
    /// placement below cannot disagree about which namespace is the viewer's.
    #[must_use]
    pub fn for_viewer(per_user: bool, viewer: Option<&IdentityKey>) -> Self {
        if !per_user {
            return Self::All;
        }
        Self::Owner {
            namespace: viewer.map(IdentityKey::path_segment),
        }
    }

    /// The viewer's own namespace, when the rule grants one.
    ///
    /// Total for an identified viewer: [`IdentityKey::path_segment`] exists
    /// for every identity, so — unlike the raw names this rule was first
    /// written against — there is no "named but unusable" case to filter.
    #[must_use]
    pub fn own_namespace(&self) -> Option<&str> {
        match self {
            Self::All => None,
            Self::Owner { namespace } => namespace.as_deref(),
        }
    }

    /// Does this rule hide the slots of namespaces other than the viewer's?
    #[must_use]
    pub fn hides_other_namespaces(&self) -> bool {
        matches!(self, Self::Owner { .. })
    }

    /// May the viewer see `path`?
    ///
    /// The in-memory twin of the SQL the store builds; non-slot paths are not
    /// this rule's business and always pass.
    #[must_use]
    pub fn allows(&self, path: &str) -> bool {
        let Some(owner) = slot_owner(path) else {
            return true;
        };
        match self {
            Self::All => true,
            Self::Owner { .. } => self.own_namespace() == Some(owner),
        }
    }
}

/// Where a slot write belongs once slots are namespaced per operator.
///
/// "Leave it as given" and "this namespace is not the writer's" must stay
/// distinct cases, because collapsing them makes the guard fail open: the
/// model picks these paths, so an `AsGiven` for `_slots/<someone else>/…`
/// is a licence to plant text in anybody's next session brief.
///
/// The raw-name version of this rule needed a third refusal — a writer whose
/// name could not be a path segment, who must not fall back onto the shared
/// slot everyone reads. [`IdentityKey::path_segment`] is total, so that case
/// is now unrepresentable: every identified writer owns a namespace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlotPlacement {
    /// Not a slot, already the writer's own namespace, or a shared slot
    /// written by an unattributed actor — write the path unchanged.
    AsGiven,
    /// Write to this per-operator path instead.
    Personal(String),
    /// The path names a namespace that is not the writer's. With per-user
    /// slots on the caller must refuse: `_slots/<segment>/…` bodies are
    /// injected verbatim into that operator's next session brief, so writing
    /// one under a segment that is not yours puts chosen text into somebody
    /// else's agent context.
    ForeignNamespace,
}

/// Decide where a slot write by `writer` belongs.
///
/// `writer` is `None` for an unattributed actor. That is not the same as "any
/// namespace will do": an unattributed writer keeps the shared path — the
/// behaviour that predates per-user slots — but owns no namespace, so every
/// namespaced slot is foreign to it.
#[must_use]
pub fn slot_placement(path: &str, writer: Option<&IdentityKey>) -> SlotPlacement {
    if !is_slot_path(path) {
        return SlotPlacement::AsGiven;
    }
    let namespace = writer.map(IdentityKey::path_segment);
    if let Some(owner) = slot_owner(path) {
        return match namespace.as_deref() {
            Some(ns) if ns == owner => SlotPlacement::AsGiven,
            _ => SlotPlacement::ForeignNamespace,
        };
    }
    let Some(namespace) = namespace else {
        return SlotPlacement::AsGiven;
    };
    match path.strip_prefix(SLOT_PREFIX) {
        Some(rest) if !rest.is_empty() => {
            SlotPlacement::Personal(format!("{SLOT_PREFIX}{namespace}/{rest}"))
        }
        _ => SlotPlacement::AsGiven,
    }
}

/// Does this slot path end in `name` (e.g. `current-focus.md`), whether it is
/// shared or namespaced?
///
/// Code that recognises a specific slot by literal equality breaks the moment
/// slots can be namespaced — `_slots/u-alice/current-focus.md` stops matching
/// `_slots/current-focus.md` and gets treated as a brand-new page.
#[must_use]
pub fn is_slot_named(path: &str, name: &str) -> bool {
    match path.strip_prefix(SLOT_PREFIX) {
        Some(rest) => rest == name || rest.rsplit_once('/').is_some_and(|(_, tail)| tail == name),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(name: &str) -> IdentityKey {
        IdentityKey::User(name.into())
    }

    fn subject(sub: &str) -> IdentityKey {
        IdentityKey::Subject {
            issuer: "https://idp.example".into(),
            subject: sub.into(),
        }
    }

    #[test]
    fn unprefixed_slots_are_shared() {
        assert!(is_slot_path("_slots/current-focus.md"));
        assert_eq!(slot_owner("_slots/current-focus.md"), None);
    }

    #[test]
    fn nested_slots_belong_to_their_first_segment() {
        assert_eq!(
            slot_owner("_slots/u-alice/current-focus.md"),
            Some("u-alice")
        );
        // Deeper nesting still attributes to the first segment only.
        assert_eq!(slot_owner("_slots/u-alice/sub/x.md"), Some("u-alice"));
    }

    #[test]
    fn non_slot_paths_have_no_owner() {
        assert!(!is_slot_path("_rules/style.md"));
        assert_eq!(slot_owner("notes/x.md"), None);
    }

    #[test]
    fn personal_rewrite_is_idempotent_and_conservative() {
        assert_eq!(
            slot_placement("_slots/current-focus.md", Some(&user("alice"))),
            SlotPlacement::Personal("_slots/u-alice/current-focus.md".into())
        );
        // Already the writer's own namespace: leave alone.
        assert_eq!(
            slot_placement("_slots/u-alice/current-focus.md", Some(&user("alice"))),
            SlotPlacement::AsGiven
        );
        // Not a slot: leave alone.
        assert_eq!(
            slot_placement("notes/x.md", Some(&user("alice"))),
            SlotPlacement::AsGiven
        );
    }

    /// A path that already names an operator must be distinguishable from "no
    /// rewrite needed": the model picks these paths, so `AsGiven` there is a
    /// licence to write into anybody's namespace.
    #[test]
    fn another_operators_namespace_is_its_own_case() {
        assert_eq!(
            slot_placement("_slots/u-alice/current-focus.md", Some(&user("bob"))),
            SlotPlacement::ForeignNamespace
        );
        // Deeper nesting attributes to the first segment, so it is foreign too.
        assert_eq!(
            slot_placement("_slots/u-alice/sub/x.md", Some(&user("bob"))),
            SlotPlacement::ForeignNamespace
        );
        // An unattributed writer owns no namespace at all.
        assert_eq!(
            slot_placement("_slots/u-alice/current-focus.md", None),
            SlotPlacement::ForeignNamespace
        );
        // …but still keeps the shared path, the pre-feature behaviour.
        assert_eq!(
            slot_placement("_slots/current-focus.md", None),
            SlotPlacement::AsGiven
        );
    }

    /// The aliasing the qualified segments exist to kill, at this layer too:
    /// a username equal to somebody else's subject is a DIFFERENT operator,
    /// so neither may write — or read — the other's namespace.
    #[test]
    fn a_username_never_claims_an_equal_subjects_namespace() {
        let by_subject_ns = format!("{SLOT_PREFIX}{}/focus.md", subject("alice").path_segment());
        assert_eq!(
            slot_placement(&by_subject_ns, Some(&user("alice"))),
            SlotPlacement::ForeignNamespace
        );
        assert!(!SlotVisibility::for_viewer(true, Some(&user("alice"))).allows(&by_subject_ns));
        assert!(SlotVisibility::for_viewer(true, Some(&subject("alice"))).allows(&by_subject_ns));
    }

    /// A path-hostile identity still owns a working namespace — the case that
    /// used to be an explicit fail-closed refusal when namespaces were raw
    /// names. The bounded segment is what makes the refusal unnecessary: the
    /// shared slot is never touched, and the page lands somewhere its own
    /// writer can read back.
    #[test]
    fn path_hostile_identities_get_a_bounded_namespace_not_the_shared_slot() {
        let url_sub = subject("https://idp.example/id/42");
        let placed = slot_placement("_slots/current-focus.md", Some(&url_sub));
        let SlotPlacement::Personal(personal) = placed else {
            panic!("a hostile identity must be re-homed, got {placed:?}");
        };
        assert!(
            personal.starts_with("_slots/o-"),
            "OIDC namespace expected: {personal}"
        );
        // The read half admits exactly the namespace the write half chose.
        let vis = SlotVisibility::for_viewer(true, Some(&url_sub));
        assert!(vis.allows(&personal), "{personal}");
        assert!(!vis.allows("_slots/u-alice/focus.md"));
        // And the segment carries no GLOB metacharacter for the SQL pattern.
        assert!(
            vis.own_namespace()
                .unwrap()
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')),
        );
    }

    /// Feature OFF is not the same rule as "feature on, viewer unknown": with
    /// it off a nested slot path carries no ownership meaning and stays
    /// visible.
    #[test]
    fn visibility_off_shows_every_slot() {
        let off = SlotVisibility::for_viewer(false, None);
        assert_eq!(off, SlotVisibility::All);
        assert!(off.allows("_slots/backend/context.md"));
        assert!(!off.hides_other_namespaces());
        // Even a named viewer sees everything while the feature is off.
        assert!(
            SlotVisibility::for_viewer(false, Some(&user("alice"))).allows("_slots/u-bob/focus.md")
        );
    }

    #[test]
    fn visibility_on_admits_shared_and_own_only() {
        let alice = SlotVisibility::for_viewer(true, Some(&user("alice")));
        assert!(alice.allows("_slots/current-focus.md"));
        assert!(alice.allows("_slots/u-alice/current-focus.md"));
        assert!(!alice.allows("_slots/u-bob/current-focus.md"));
        assert_eq!(alice.own_namespace(), Some("u-alice"));

        // An unattributed viewer collapses to shared-only.
        let anon = SlotVisibility::for_viewer(true, None);
        assert_eq!(anon.own_namespace(), None);
        assert!(anon.allows("_slots/current-focus.md"));
        assert!(!anon.allows("_slots/u-alice/current-focus.md"));
    }

    /// A legacy nested path (`_slots/alice/…`, written when nesting meant
    /// nothing) names a segment no qualified identity can produce, so with the
    /// feature on it belongs to nobody — not even the operator whose raw name
    /// it happens to spell.
    #[test]
    fn legacy_raw_name_namespaces_belong_to_nobody_once_the_feature_is_on() {
        assert_eq!(
            slot_placement("_slots/alice/current-focus.md", Some(&user("alice"))),
            SlotPlacement::ForeignNamespace
        );
        assert!(
            !SlotVisibility::for_viewer(true, Some(&user("alice")))
                .allows("_slots/alice/current-focus.md")
        );
        // With the feature off it is an ordinary shared slot, as it always was.
        assert!(SlotVisibility::All.allows("_slots/alice/current-focus.md"));
    }

    #[test]
    fn named_slot_matches_shared_and_personal() {
        assert!(is_slot_named("_slots/current-focus.md", "current-focus.md"));
        assert!(is_slot_named(
            "_slots/u-alice/current-focus.md",
            "current-focus.md"
        ));
        assert!(!is_slot_named(
            "_slots/u-alice/other.md",
            "current-focus.md"
        ));
        assert!(!is_slot_named("notes/current-focus.md", "current-focus.md"));
    }
}
