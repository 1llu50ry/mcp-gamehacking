//! `ai-memory restore-page` — restore one wiki page from a git checkpoint.

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use crate::cli::RestorePageArgs;
use crate::config::Config;
use crate::http_client::{ServerEndpoint, post_json};

#[derive(Serialize)]
struct RestorePageRequest {
    workspace: String,
    project: String,
    path: String,
    rev: String,
}

#[derive(Deserialize, Serialize)]
struct RestorePageResponse {
    page_id: String,
    path: String,
    restored_from: String,
    #[serde(default)]
    pre_checkpoint: Option<String>,
    #[serde(default)]
    checkpoint: Option<String>,
}

/// Run the `restore-page` subcommand.
///
/// # Errors
/// Returns an error if an explicit scope flag, `--path`, or `--from` is empty;
/// the server is unreachable; the checkpoint/path cannot be restored; or the
/// restored page cannot be reindexed.
pub async fn run(config: &Config, args: RestorePageArgs) -> Result<()> {
    super::refuse_empty_explicit(args.workspace.as_deref(), "--workspace")?;
    super::refuse_empty_explicit(args.project.as_deref(), "--project")?;
    if args.path.trim().is_empty() {
        bail!("--path was passed empty; specify the wiki page path to restore");
    }
    if args.from.trim().is_empty() {
        bail!("--from was passed empty; specify the git checkpoint to restore from");
    }
    let (workspace, project) =
        super::resolve_scope(config, args.workspace.as_deref(), args.project.as_deref())?;
    let endpoint = ServerEndpoint::from_config_resolving_auth(config).await;
    let resp: RestorePageResponse = post_json(
        &endpoint,
        "/admin/restore-page",
        &RestorePageRequest {
            workspace: workspace.clone(),
            project: project.clone(),
            path: args.path.clone(),
            rev: args.from.clone(),
        },
    )
    .await
    .context("restoring page via server")?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&resp)?);
        return Ok(());
    }

    println!(
        "restored {} under {}/{} from {} (page_id={})",
        resp.path,
        workspace,
        project,
        resp.restored_from,
        super::write_page::short_page_id(&resp.page_id)
    );
    if let Some(pre) = resp.pre_checkpoint {
        println!("pre-restore checkpoint: {pre}");
    }
    if let Some(cp) = resp.checkpoint {
        println!("restore checkpoint: {cp}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(path: &str, from: &str) -> RestorePageArgs {
        RestorePageArgs {
            path: path.into(),
            from: from.into(),
            workspace: None,
            project: None,
            json: false,
        }
    }

    #[tokio::test]
    async fn an_empty_path_is_refused_before_scope_or_network_work() {
        for empty in ["", " \t "] {
            let error = run(&Config::default(), args(empty, "HEAD~1"))
                .await
                .unwrap_err();
            assert!(
                error.to_string().contains("--path was passed empty"),
                "unexpected error: {error}"
            );
        }
    }

    #[tokio::test]
    async fn an_empty_revision_is_refused_before_scope_or_network_work() {
        for empty in ["", " \t "] {
            let error = run(&Config::default(), args("notes/example.md", empty))
                .await
                .unwrap_err();
            assert!(
                error.to_string().contains("--from was passed empty"),
                "unexpected error: {error}"
            );
        }
    }
}
