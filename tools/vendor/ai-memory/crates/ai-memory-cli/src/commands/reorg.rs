//! `ai-memory reorg --dry-run`
//!
//! Thin HTTP client — delegates all store reads/writes to the server.

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::cli::ReorgArgs;
use crate::config::Config;
use crate::http_client::{ServerEndpoint, post_json};

/// Request sent to `POST /admin/reorg`.
#[derive(Serialize)]
struct ReorgRequest {
    dry_run: bool,
}

/// One entry in the server's reorg plan.
#[derive(Deserialize)]
struct ReorgPlanEntry {
    session_id: String,
    cwd: String,
    new_project: String,
}

/// Summary counts from the server response.
#[derive(Deserialize)]
struct ReorgSummaryJson {
    sessions_moved: usize,
    observations_updated: usize,
    pages_graveyarded: usize,
    distinct_new_projects: usize,
}

/// Full response from `POST /admin/reorg`.
#[derive(Deserialize)]
struct ReorgReport {
    dry_run: bool,
    plan: Vec<ReorgPlanEntry>,
    summary: ReorgSummaryJson,
}

/// Run the `reorg` subcommand.
///
/// # Errors
/// Returns an error if the server is unreachable or returns a non-2xx
/// response.
pub async fn run(config: &Config, args: ReorgArgs) -> Result<()> {
    let endpoint = ServerEndpoint::from_config_resolving_auth(config).await;
    let report: ReorgReport = post_json(
        &endpoint,
        "/admin/reorg",
        &ReorgRequest {
            dry_run: args.dry_run,
        },
    )
    .await?;

    if report.plan.is_empty() {
        println!("All sessions are already in the correct per-cwd project; nothing to do.");
        return Ok(());
    }

    if report.dry_run {
        println!("{} session(s) would be moved:\n", report.plan.len());
        println!("{:<38} {:<20} cwd", "session_id", "new_project");
        println!("{}", "-".repeat(80));
        for e in &report.plan {
            println!("{:<38} {:<20} {}", e.session_id, e.new_project, e.cwd);
        }
        println!("\n(dry-run; omit --dry-run to apply)");
    } else {
        println!("Reorg complete:");
        println!("  sessions moved:        {}", report.summary.sessions_moved);
        println!(
            "  observations updated:  {}",
            report.summary.observations_updated
        );
        println!(
            "  pages graveyarded:     {}",
            report.summary.pages_graveyarded
        );
        println!(
            "  distinct new projects: {}",
            report.summary.distinct_new_projects
        );
    }
    Ok(())
}
