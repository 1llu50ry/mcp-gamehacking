//! `ai-memory read-page` — display the full body of a wiki page.
//!
//! Two resolution modes:
//! - `--path <path>`: fetch the page at that exact wiki path.
//! - positional `<query>`: FTS5 search scoped to the current project;
//!   fetches the top-ranking hit's full body.
//!
//! The project is auto-detected from the current directory (same heuristic
//! as `search`). Pass `--project` to target a different project explicitly.
//!
//! Thin HTTP client. Never opens the store or wiki directly.

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

use crate::cli::ReadPageArgs;
use crate::config::Config;
use crate::http_client::{ServerEndpoint, get_json};

/// Mirrors the `ReadPageResponse` struct on the server side.
#[derive(Debug, Deserialize, Serialize)]
struct PageContent {
    path: String,
    #[serde(default)]
    workspace: String,
    #[serde(default)]
    project: String,
    title: Option<String>,
    body: String,
    frontmatter: serde_json::Value,
    /// Set by the server when the page's `expires_at` TTL has passed: the
    /// exact-path read still answers, while `search` no longer lists the page.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    expired: bool,
}

/// Run the `read-page` subcommand.
///
/// # Errors
/// Returns an error if the server is unreachable, returns non-2xx,
/// or neither `--path` nor a query is supplied.
pub async fn run(config: &Config, args: ReadPageArgs) -> Result<()> {
    let ep = ServerEndpoint::from_config_resolving_auth(config).await;
    let (workspace, project) =
        super::resolve_scope(config, args.workspace.as_deref(), args.project.as_deref())?;

    let page: PageContent = if let Some(ref raw_path) = args.path {
        get_json(
            &ep,
            "/admin/read-page",
            &[
                ("workspace", workspace.as_str()),
                ("project", project.as_str()),
                ("path", raw_path.as_str()),
            ],
        )
        .await?
    } else if let Some(ref query) = args.query {
        get_json(
            &ep,
            "/admin/read-page",
            &[
                ("workspace", workspace.as_str()),
                ("project", project.as_str()),
                ("q", query.as_str()),
            ],
        )
        .await?
    } else {
        bail!("provide a query (positional) or --path <wiki-path>");
    };

    if args.json {
        println!("{}", serde_json::to_string_pretty(&page)?);
    } else {
        print!("{}", render_text(&page));
    }
    Ok(())
}

fn render_text(page: &PageContent) -> String {
    let mut out = String::new();
    if let Some(title) = &page.title {
        out.push_str(&format!("# {title}\n"));
    }
    out.push_str(&format!("path: {}\n", page.path));
    if page.expired {
        out.push_str("expired: true\n");
    }
    out.push('\n');
    out.push_str(&page.body);
    if !page.body.ends_with('\n') {
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(expired: bool) -> PageContent {
        PageContent {
            path: "notes/example.md".into(),
            workspace: "default".into(),
            project: "app".into(),
            title: Some("Example".into()),
            body: "body".into(),
            frontmatter: serde_json::json!({}),
            expired,
        }
    }

    #[test]
    fn text_output_marks_only_expired_pages() {
        assert_eq!(
            render_text(&page(false)),
            "# Example\npath: notes/example.md\n\nbody\n"
        );
        assert_eq!(
            render_text(&page(true)),
            "# Example\npath: notes/example.md\nexpired: true\n\nbody\n"
        );
    }

    #[test]
    fn older_server_response_defaults_to_live() {
        let parsed: PageContent = serde_json::from_value(serde_json::json!({
            "path": "notes/example.md",
            "title": null,
            "body": "body\n",
            "frontmatter": {}
        }))
        .unwrap();
        assert!(!parsed.expired);
    }
}
