//! `ai-memory project` — local marker setup and server project settings (#708).
//!
//! `project init` creates a local `.ai-memory.toml` and never contacts the
//! server. The remaining actions are thin HTTP clients over `/admin/projects/*`,
//! root-only like `ai-memory grant`: access is an operator decision, made
//! against the server rather than a database the operator's laptop usually
//! cannot open.

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::cli::{ProjectAccessArgs, ProjectArgs, ProjectCommand};
use crate::config::Config;
use crate::http_client::{ServerEndpoint, post_json};

/// Dispatch a `project` subcommand.
///
/// # Errors
/// Local marker initialization failures, or a transport failure, non-root
/// token, unknown project, or invalid mode for a server-side action.
pub async fn run(config: &Config, args: ProjectArgs) -> Result<()> {
    match args.command {
        ProjectCommand::Init(args) => crate::commands::project_init::run(config, args),
        ProjectCommand::Access(args) => {
            let ep = ServerEndpoint::from_config_resolving_auth(config).await;
            access(&ep, args).await
        }
        ProjectCommand::Grants(args) => {
            let ep = ServerEndpoint::from_config_resolving_auth(config).await;
            crate::commands::grant::list_for_project(&ep, &args).await
        }
    }
}

#[derive(Debug, Deserialize)]
struct AccessResponse {
    mode: String,
    previous: String,
    changed: bool,
    without_access: Vec<String>,
}

async fn access(ep: &ServerEndpoint, args: ProjectAccessArgs) -> Result<()> {
    let resp: AccessResponse = post_json(
        ep,
        "/admin/projects/access",
        &serde_json::json!({
            "workspace": args.workspace,
            "project": args.project,
            "mode": args.mode,
        }),
    )
    .await
    .context("setting project access")?;
    let repo = format!("{}/{}", args.workspace, args.project);
    if resp.changed {
        println!("{repo} is now {} (was {}).", resp.mode, resp.previous);
    } else {
        println!("{repo} was already {}; nothing changed.", resp.mode);
    }
    if !resp.without_access.is_empty() {
        println!();
        println!("These users have written to {repo} and hold no grant, so they are now refused:");
        for name in &resp.without_access {
            println!("  {name}");
        }
        println!(
            "Grant the ones who should keep access: ai-memory user grant --user <name> \
             --workspace {} --project {} --level write",
            args.workspace, args.project
        );
    }
    Ok(())
}
