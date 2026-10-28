//! Cross-scope wikilink validation for LLM-produced page bodies (#1218).
//!
//! The consolidation prompts tell the model not to invent
//! `[[project:path]]` / `[[_global:path]]` links, but a prompt cannot
//! guarantee it (#1207 shipped the wording; this is the code backstop).
//! Whatever the lint pass would later flag as a dangling cross-project
//! dependency is instead caught here, before the write: every cross-scope
//! wikilink in a proposed body is resolved against the store with no-create
//! lookups, and an unresolved one is rewritten to its plain label text
//! (brackets dropped, label kept) so the prose still reads. Resolved links
//! survive byte-identical; same-project `[[target]]` links are by design
//! allowed to dangle (the target may be written later) and are never
//! touched.

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

use ai_memory_core::{PagePath, ProjectId, WorkspaceId};
use ai_memory_store::{ReaderPool, ScopeResolutionError, lookup_existing_scope};
use tracing::warn;

/// A normalised link key as `ai_memory_wiki::extract_links` yields it:
/// `(workspace, project, path)`, with `workspace`/`project` `None` for a
/// same-project link.
pub(crate) type LinkKey = (Option<String>, Option<String>, String);

/// Collect generated links that do not resolve to an existing latest page.
/// Cross-scope body links and every typed relation are checked. Same-project
/// body links remain deliberately unchecked, while same-project relations may
/// also target another page proposed in this atomic batch.
///
/// Lookups are no-create and batched: each named scope is resolved once via
/// [`lookup_existing_scope`], then every path under it is checked in a
/// single query. A missing workspace, a missing project, or an ambiguous
/// project name all count as unresolved — the link can never resolve
/// deterministically, so keeping it would only mint a lint finding. A
/// genuine store failure propagates rather than stripping links that may be
/// fine.
///
/// `source_workspace_id` supplies the workspace name for project-only
/// `[[project:path]]` links, exactly as the write-path link resolver treats
/// a missing workspace qualifier as "the source page's workspace".
#[derive(Debug, Default)]
pub(crate) struct UnresolvedGeneratedLinks {
    pub body: BTreeSet<LinkKey>,
    pub relations: BTreeSet<LinkKey>,
}

impl UnresolvedGeneratedLinks {
    pub(crate) fn is_empty(&self) -> bool {
        self.body.is_empty() && self.relations.is_empty()
    }
}

pub(crate) async fn unresolved_generated_links(
    reader: &ReaderPool,
    source_workspace_id: WorkspaceId,
    source_project_id: ProjectId,
    pages: &[(&PagePath, &str, &serde_json::Value)],
) -> Result<UnresolvedGeneratedLinks, ScopeResolutionError> {
    let proposed_paths: BTreeSet<String> = pages
        .iter()
        .map(|(path, _, _)| path.as_str().to_string())
        .collect();
    let mut body_targets: BTreeSet<LinkKey> = BTreeSet::new();
    let mut relation_targets: BTreeSet<LinkKey> = BTreeSet::new();
    for (page_path, body, frontmatter) in pages {
        for link in ai_memory_wiki::extract_links(body, page_path) {
            if link.project.is_some() {
                body_targets.insert((link.workspace, link.project, link.path.as_str().to_string()));
            }
        }
        relation_targets.extend(
            ai_memory_wiki::extract_relation_links(frontmatter)
                .into_iter()
                .map(|link| (link.workspace, link.project, link.path.as_str().to_string())),
        );
    }
    if body_targets.is_empty() && relation_targets.is_empty() {
        return Ok(UnresolvedGeneratedLinks::default());
    }

    let mut result = UnresolvedGeneratedLinks::default();
    let local_relations: Vec<LinkKey> = relation_targets
        .iter()
        .filter(|(workspace, project, _)| workspace.is_none() && project.is_none())
        .cloned()
        .collect();
    let local_paths: Vec<String> = local_relations
        .iter()
        .map(|(_, _, path)| path.clone())
        .filter(|path| !proposed_paths.contains(path))
        .collect();
    let existing_local: BTreeSet<String> = reader
        .existing_latest_paths(source_workspace_id, source_project_id, local_paths)
        .await?
        .into_iter()
        .collect();
    for key in local_relations {
        if !proposed_paths.contains(&key.2) && !existing_local.contains(&key.2) {
            warn!(target = %key.2, "dropping same-project relation: no such page");
            result.relations.insert(key);
        }
    }

    let cross_targets: BTreeSet<LinkKey> = body_targets
        .iter()
        .chain(relation_targets.iter())
        .filter(|(_, project, _)| project.is_some())
        .cloned()
        .collect();
    if cross_targets.is_empty() {
        return Ok(result);
    }

    // The source workspace exists by construction — the session's
    // observations landed in it — so a miss here is a genuine store
    // inconsistency worth failing on rather than silently de-linking.
    let source_workspace = reader
        .workspace_name_by_id(source_workspace_id)
        .await?
        .ok_or_else(|| ScopeResolutionError::WorkspaceNotFound {
            workspace: source_workspace_id.to_string(),
        })?;

    let mut by_scope: BTreeMap<(String, String), Vec<LinkKey>> = BTreeMap::new();
    for key in cross_targets {
        let workspace = key.0.clone().unwrap_or_else(|| source_workspace.clone());
        let project = key.1.clone().unwrap_or_default();
        by_scope.entry((workspace, project)).or_default().push(key);
    }

    for ((workspace, project), keys) in by_scope {
        let scope = match lookup_existing_scope(reader, &workspace, &project).await {
            Ok(scope) => scope,
            Err(
                error @ (ScopeResolutionError::WorkspaceNotFound { .. }
                | ScopeResolutionError::ProjectNotFoundInWorkspace { .. }
                | ScopeResolutionError::ProjectNameAmbiguous { .. }),
            ) => {
                warn!(
                    target_scope = %format!("{workspace}/{project}"),
                    error = %error,
                    "de-linking cross-scope wikilinks: the named scope does not resolve",
                );
                for key in keys {
                    if body_targets.contains(&key) {
                        result.body.insert(key.clone());
                    }
                    if relation_targets.contains(&key) {
                        result.relations.insert(key);
                    }
                }
                continue;
            }
            Err(error) => return Err(error),
        };
        let paths: Vec<String> = keys.iter().map(|key| key.2.clone()).collect();
        let existing: std::collections::HashSet<String> = reader
            .existing_latest_paths(scope.workspace_id, scope.project_id, paths)
            .await?
            .into_iter()
            .collect();
        for key in keys {
            if !existing.contains(&key.2) {
                warn!(
                    target = %format!("{}:{}", key.1.as_deref().unwrap_or_default(), key.2),
                    "de-linking cross-scope wikilink: no such page in the target project",
                );
                if body_targets.contains(&key) {
                    result.body.insert(key.clone());
                }
                if relation_targets.contains(&key) {
                    result.relations.insert(key);
                }
            }
        }
    }
    Ok(result)
}

/// Rewrite `body`, replacing every wikilink whose key is in `unresolved`
/// with its plain label text. A borrowed no-op when the set is empty.
pub(crate) fn delink_body<'a>(
    body: &'a str,
    page_path: &PagePath,
    unresolved: &BTreeSet<LinkKey>,
) -> Cow<'a, str> {
    if unresolved.is_empty() {
        return Cow::Borrowed(body);
    }
    Cow::Owned(ai_memory_wiki::delink_wikilinks(
        body, page_path, unresolved,
    ))
}

/// Drop every `relations:` entry whose target is in `unresolved`, then any
/// relation left empty, then an empty `relations` map. Entries are matched
/// through [`ai_memory_wiki::extract_relation_links`], so a target is keyed
/// exactly as the write boundary will parse it.
pub(crate) fn prune_relations(frontmatter: &mut serde_json::Value, unresolved: &BTreeSet<LinkKey>) {
    if unresolved.is_empty() {
        return;
    }
    let Some(relations) = frontmatter
        .get_mut("relations")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return;
    };
    for (relation, targets) in relations.iter_mut() {
        let Some(list) = targets.as_array_mut() else {
            continue;
        };
        list.retain(|entry| {
            let probe = serde_json::json!({ "relations": { relation.as_str(): [entry] } });
            let links = ai_memory_wiki::extract_relation_links(&probe);
            !links.is_empty()
                && links.into_iter().all(|link| {
                    !unresolved.contains(&(
                        link.workspace,
                        link.project,
                        link.path.as_str().to_string(),
                    ))
                })
        });
    }
    relations.retain(|_, targets| targets.as_array().is_none_or(|list| !list.is_empty()));
    if relations.is_empty()
        && let Some(map) = frontmatter.as_object_mut()
    {
        map.remove("relations");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(project: &str, path: &str) -> LinkKey {
        (None, Some(project.to_string()), path.to_string())
    }

    #[test]
    fn prune_relations_drops_only_unresolved_cross_scope_entries() {
        let mut fm = serde_json::json!({
            "title": "t",
            "relations": {
                "causes": ["ghost:notes/missing.md", "billing:notes/live.md", "local/page.md"],
                "fixes": ["ghost:other"],
            },
        });
        prune_relations(
            &mut fm,
            &BTreeSet::from([key("ghost", "notes/missing.md"), key("ghost", "other.md")]),
        );
        assert_eq!(
            fm["relations"]["causes"],
            serde_json::json!(["billing:notes/live.md", "local/page.md"])
        );
        assert!(
            fm["relations"].get("fixes").is_none(),
            "an emptied relation is removed"
        );
    }

    #[test]
    fn prune_relations_removes_an_emptied_map_and_ignores_an_empty_set() {
        let original = serde_json::json!({ "relations": { "causes": ["ghost:x.md"] } });
        let mut untouched = original.clone();
        prune_relations(&mut untouched, &BTreeSet::new());
        assert_eq!(untouched, original);

        let mut fm = original;
        prune_relations(&mut fm, &BTreeSet::from([key("ghost", "x.md")]));
        assert!(fm.get("relations").is_none());
    }

    #[test]
    fn prune_relations_drops_unparseable_entries() {
        let mut fm = serde_json::json!({
            "relations": {
                "contradicts": [
                    "upgrade 3.0.0 to 3.1.0 with residue",
                    "notes/",
                    "notes/.md",
                    "local/valid.md"
                ]
            }
        });
        prune_relations(&mut fm, &BTreeSet::from([key("ghost", "x.md")]));
        assert_eq!(
            fm["relations"]["contradicts"],
            serde_json::json!(["local/valid.md"])
        );
    }

    #[tokio::test]
    async fn same_project_relations_require_existing_or_same_batch_targets() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ai_memory_store::Store::open(tmp.path()).unwrap();
        let ws = store
            .writer
            .get_or_create_workspace("default")
            .await
            .unwrap();
        let proj = store
            .writer
            .get_or_create_project(ws, "app", None)
            .await
            .unwrap();
        let source = PagePath::new("notes/source.md").unwrap();
        let peer = PagePath::new("notes/peer.md").unwrap();
        let source_frontmatter = serde_json::json!({
            "relations": {"causes": ["notes/peer.md", "notes/missing.md"]}
        });
        let peer_frontmatter = serde_json::json!({});
        let unresolved = unresolved_generated_links(
            &store.reader,
            ws,
            proj,
            &[
                (
                    &source,
                    "A pending [[notes/missing.md]] body link stays valid.",
                    &source_frontmatter,
                ),
                (&peer, "Peer", &peer_frontmatter),
            ],
        )
        .await
        .unwrap();

        assert!(unresolved.body.is_empty(), "local body links may dangle");
        assert_eq!(
            unresolved.relations,
            BTreeSet::from([(None, None, "notes/missing.md".to_string())])
        );
    }
}
