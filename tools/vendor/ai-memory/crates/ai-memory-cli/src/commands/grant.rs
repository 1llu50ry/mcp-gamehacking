//! Grant management for `ai-memory user grant|revoke|grants` and `ai-memory
//! project grants` (#708).
//!
//! Thin HTTP client over `/admin/users/{username}/grant|revoke|grants` and
//! `/admin/projects/grants`. The caller's bearer token must authenticate as
//! root: grants are an operator action, and the server is usually somewhere the
//! operator's laptop cannot open the database directly.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::cli::{ProjectGrantsArgs, UserGrantArgs, UserGrantsArgs, UserRevokeArgs};
use crate::commands::user::url_encode;
use crate::http_client::{ServerEndpoint, get_json, post_json};

#[derive(Debug, Serialize)]
struct GrantRequest<'a> {
    workspace: &'a str,
    project: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    level: Option<&'a str>,
}

#[derive(Debug, Deserialize, Serialize)]
struct GrantRow {
    username: String,
    workspace: String,
    project: String,
    level: String,
}

#[derive(Debug, Deserialize)]
struct GrantList {
    grants: Vec<GrantRow>,
}

fn print_grants(grants: &[GrantRow], json: bool) -> Result<()> {
    if json {
        println!("{}", serde_json::to_string_pretty(grants)?);
        return Ok(());
    }
    if grants.is_empty() {
        // Say what empty means: nothing is lost on an open project.
        println!("(no grants)");
        println!(
            "Open projects admit every user regardless; a restricted project with no \
             grants admits only root."
        );
        return Ok(());
    }
    // Written through a locked stdout handle rather than `print!` so the table
    // leaves the process in one write, as `project_init` already does for its
    // own bulk output.
    write_grants(grants, &mut std::io::stdout().lock())
}

/// Lay out the grants table using terminal display-cell widths. Workspace and
/// project names come from a checkout's directory basename or a marker's
/// `project` key, so they are free-form UTF-8.
fn write_grants(grants: &[GrantRow], out: &mut impl std::io::Write) -> Result<()> {
    let project_w = grants
        .iter()
        .map(|g| {
            unicode_width::UnicodeWidthStr::width(format!("{}/{}", g.workspace, g.project).as_str())
        })
        .max()
        .unwrap_or(7)
        .max(7);
    let user_w = grants
        .iter()
        .map(|g| unicode_width::UnicodeWidthStr::width(g.username.as_str()))
        .max()
        .unwrap_or(8)
        .max(8);
    writeln!(
        out,
        "{}  {}  LEVEL",
        pad_cell("PROJECT", project_w),
        pad_cell("USERNAME", user_w)
    )?;
    for g in grants {
        let project = format!("{}/{}", g.workspace, g.project);
        writeln!(
            out,
            "{}  {}  {}",
            pad_cell(&project, project_w),
            pad_cell(&g.username, user_w),
            g.level
        )?;
    }
    Ok(())
}

fn pad_cell(value: &str, width: usize) -> String {
    let padding = width.saturating_sub(unicode_width::UnicodeWidthStr::width(value));
    format!("{value}{}", " ".repeat(padding))
}

/// `ai-memory user grants [--user NAME]`.
///
/// # Errors
/// Transport failures, a non-root token, or an unknown user.
pub async fn list_for_user(ep: &ServerEndpoint, args: &UserGrantsArgs) -> Result<()> {
    let resp: GrantList = match &args.user {
        Some(user) => get_json(
            ep,
            &format!("/admin/users/{}/grants", url_encode(user)),
            &[],
        )
        .await
        .with_context(|| format!("listing {user}'s grants"))?,
        None => get_json(ep, "/admin/projects/grants", &[])
            .await
            .context("listing grants")?,
    };
    print_grants(&resp.grants, args.json)
}

/// `ai-memory project grants --workspace W --project P`.
///
/// # Errors
/// Transport failures, a non-root token, or an unknown project.
pub async fn list_for_project(ep: &ServerEndpoint, args: &ProjectGrantsArgs) -> Result<()> {
    let resp: GrantList = get_json(
        ep,
        "/admin/projects/grants",
        &[("workspace", &args.workspace), ("project", &args.project)],
    )
    .await
    .with_context(|| format!("listing grants on {}/{}", args.workspace, args.project))?;
    print_grants(&resp.grants, args.json)
}

#[derive(Debug, Deserialize)]
struct GrantResponse {
    level: String,
    changed: bool,
    previous: Option<String>,
}

/// `ai-memory user grant --user U --workspace W --project P --level L`.
///
/// # Errors
/// Transport failures, a non-root token, an unknown user, project or level.
pub async fn grant(ep: &ServerEndpoint, args: &UserGrantArgs) -> Result<()> {
    let body = GrantRequest {
        workspace: &args.workspace,
        project: &args.project,
        level: Some(&args.level),
    };
    let resp: GrantResponse = post_json(
        ep,
        &format!("/admin/users/{}/grant", url_encode(&args.user)),
        &body,
    )
    .await
    .with_context(|| {
        format!(
            "granting {} on {}/{}",
            args.user, args.workspace, args.project
        )
    })?;
    let who = &args.user;
    let project = format!("{}/{}", args.workspace, args.project);
    match (resp.changed, resp.previous) {
        (false, _) => println!(
            "{who} already holds {} on {project}; nothing changed.",
            resp.level
        ),
        (true, Some(previous)) => println!("{who}: {previous} -> {} on {project}.", resp.level),
        (true, None) => println!("{who} now holds {} on {project}.", resp.level),
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct RevokeResponse {
    revoked: bool,
}

/// `ai-memory user revoke --user U --workspace W --project P`.
///
/// # Errors
/// Transport failures, a non-root token, an unknown user or project.
pub async fn revoke(ep: &ServerEndpoint, args: &UserRevokeArgs) -> Result<()> {
    let body = GrantRequest {
        workspace: &args.workspace,
        project: &args.project,
        level: None,
    };
    let resp: RevokeResponse = post_json(
        ep,
        &format!("/admin/users/{}/revoke", url_encode(&args.user)),
        &body,
    )
    .await
    .with_context(|| {
        format!(
            "revoking {} on {}/{}",
            args.user, args.workspace, args.project
        )
    })?;
    let project = format!("{}/{}", args.workspace, args.project);
    if resp.revoked {
        println!("{} no longer holds anything on {project}.", args.user);
    } else {
        println!("{} held nothing on {project}; nothing changed.", args.user);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grant(project: &str, username: &str) -> GrantRow {
        GrantRow {
            username: username.to_owned(),
            workspace: "default".to_owned(),
            project: project.to_owned(),
            level: "read".to_owned(),
        }
    }

    /// The display-cell offset at which `line` carries `username`, or `None`.
    fn username_column(line: &str, username: &str) -> Option<usize> {
        line.find(username)
            .map(|byte| unicode_width::UnicodeWidthStr::width(&line[..byte]))
    }

    #[test]
    fn grants_table_columns_line_up_past_ascii() {
        let rows = [grant("caf\u{e9}", "ana"), grant("web", "bob")];
        let mut buf = Vec::new();
        write_grants(&rows, &mut buf).expect("rendering to a buffer cannot fail");
        let table = String::from_utf8(buf).expect("the table is utf-8");
        let header = table.lines().next().expect("a header row");
        // The header is ASCII, so its byte offset is its character offset.
        let user_col = header.find("USERNAME").expect("a USERNAME column");
        // `café` is one byte longer than it is wide, so a byte-measured width
        // pads that row one column too far and shifts USERNAME and LEVEL.
        for (line, row) in table.lines().skip(1).zip(rows.iter()) {
            assert_eq!(
                username_column(line, &row.username),
                Some(user_col),
                "USERNAME column moved on {line:?}:\n{table}"
            );
        }
        // Control: an ASCII-only table lines up under either measure, so the
        // non-ASCII row above is what carries the assertion.
        let ascii_rows = [grant("cafe", "ana"), grant("web", "bob")];
        let mut ascii_buf = Vec::new();
        write_grants(&ascii_rows, &mut ascii_buf).expect("rendering to a buffer cannot fail");
        let ascii = String::from_utf8(ascii_buf).expect("the table is utf-8");
        for (line, row) in ascii.lines().skip(1).zip(ascii_rows.iter()) {
            assert_eq!(
                username_column(line, &row.username),
                Some(user_col),
                "ascii rows must line up as well:\n{ascii}"
            );
        }

        let cjk_rows = [grant("記憶管理", "利用者"), grant("web", "bob")];
        let mut cjk_buf = Vec::new();
        write_grants(&cjk_rows, &mut cjk_buf).unwrap();
        let cjk = String::from_utf8(cjk_buf).unwrap();
        let cjk_user_col = username_column(cjk.lines().next().unwrap(), "USERNAME").unwrap();
        for (line, row) in cjk.lines().skip(1).zip(cjk_rows.iter()) {
            assert_eq!(
                username_column(line, &row.username),
                Some(cjk_user_col),
                "{cjk}"
            );
        }
    }
}
