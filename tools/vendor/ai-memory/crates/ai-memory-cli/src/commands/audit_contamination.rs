//! `ai-memory audit-contamination` — structural cross-project contamination audit.
//!
//! Thin HTTP client. Calls `GET /admin/audit-contamination` on the configured
//! server and renders the report as human text or JSON. Read-only — the server
//! only reports, never mutates; remediation is a separate operator step.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

use crate::cli::AuditContaminationArgs;
use crate::config::Config;
use crate::http_client::{ServerEndpoint, get_json};

/// Server-shaped response. Mirrors `ai_memory_store::ContaminationReport`.
#[derive(Debug, Default, Deserialize, Serialize)]
struct Report {
    #[serde(default)]
    summary: Summary,
    #[serde(default)]
    findings: Vec<Finding>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct Summary {
    #[serde(default)]
    sessions_misbucketed: usize,
}

#[derive(Debug, Deserialize, Serialize)]
struct Finding {
    check: String,
    confidence: String,
    entity_kind: String,
    entity_id: String,
    landed_workspace: String,
    landed_project: String,
    #[serde(default)]
    expected_project: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
}

/// Run the `audit-contamination` subcommand.
///
/// # Errors
/// Returns an error if the server is unreachable, returns non-2xx, or the
/// response can't be parsed.
pub async fn run(config: &Config, args: AuditContaminationArgs) -> Result<()> {
    let ep = ServerEndpoint::from_config_resolving_auth(config).await;
    let query = scope_query(&args)?;
    let report: Report = get_json(&ep, "/admin/audit-contamination", &query).await?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
        return Ok(());
    }

    if report.findings.is_empty() {
        println!("No structural contamination found (no session mis-bucketed by cwd).");
        return Ok(());
    }
    println!(
        "Contamination audit: {} session(s) mis-bucketed.",
        report.summary.sessions_misbucketed
    );
    for f in &report.findings {
        let expected = f.expected_project.as_deref().unwrap_or("?");
        match f.check.as_str() {
            "session_wrong_bucket" => println!(
                "  [{}] session {} landed in {}/{} but its cwd ({}) resolves to project {}",
                f.confidence,
                f.entity_id,
                f.landed_workspace,
                f.landed_project,
                f.cwd.as_deref().unwrap_or("?"),
                expected,
            ),
            other => println!(
                "  [{}] {} {} in {}/{}",
                f.confidence, other, f.entity_id, f.landed_workspace, f.landed_project
            ),
        }
    }
    Ok(())
}

fn scope_query(args: &AuditContaminationArgs) -> Result<Vec<(&str, &str)>> {
    match (args.workspace.as_deref(), args.project.as_deref()) {
        (Some(ws), Some(proj)) => Ok(vec![("workspace", ws), ("project", proj)]),
        (None, None) => Ok(Vec::new()),
        _ => bail!("--workspace and --project must be provided together"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(workspace: Option<&str>, project: Option<&str>) -> AuditContaminationArgs {
        AuditContaminationArgs {
            workspace: workspace.map(str::to_string),
            project: project.map(str::to_string),
            json: false,
        }
    }

    #[test]
    fn scope_query_rejects_partial_scope() {
        assert!(scope_query(&args(Some("default"), None)).is_err());
        assert!(scope_query(&args(None, Some("ai-memory"))).is_err());
    }

    #[test]
    fn scope_query_accepts_global_or_complete_scope() {
        assert!(scope_query(&args(None, None)).unwrap().is_empty());
        assert_eq!(
            scope_query(&args(Some("default"), Some("ai-memory"))).unwrap(),
            vec![("workspace", "default"), ("project", "ai-memory")]
        );
    }
}
