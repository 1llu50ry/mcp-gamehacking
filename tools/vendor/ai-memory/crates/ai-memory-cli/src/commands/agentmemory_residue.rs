//! `ai-memory doctor`'s read-only check for configuration left behind by
//! agentmemory after a migration.
//!
//! Two leftovers keep confusing agents once agentmemory is gone: an MCP
//! server entry still registered in a harness config, and the memory-usage
//! guideline block `agentmemory connect` writes into native rules files. An
//! agent reading that block keeps calling tools that no longer exist, and one
//! of them, `memory_consolidate`, is also an ai-memory tool with different
//! arguments.
//!
//! This check only reads. It names each file and what it found there and
//! prints the line to fix by hand; it never edits or deletes another tool's
//! files.

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// agentmemory MCP tool names that ai-memory does not have. A rules file
/// naming one of these is following agentmemory's guidance.
pub(crate) const AGENTMEMORY_ONLY_TOOLS: &[&str] = &[
    "memory_action_create",
    "memory_action_update",
    "memory_audit",
    "memory_checkpoint",
    "memory_claude_bridge_sync",
    "memory_commit_lookup",
    "memory_commits",
    "memory_compress_file",
    "memory_crystallize",
    "memory_diagnose",
    "memory_export",
    "memory_facet_query",
    "memory_facet_tag",
    "memory_file_history",
    "memory_frontier",
    "memory_governance_delete",
    "memory_graph_query",
    "memory_heal",
    "memory_insight_list",
    "memory_lease",
    "memory_lesson_recall",
    "memory_lesson_save",
    "memory_mesh_sync",
    "memory_next",
    "memory_obsidian_export",
    "memory_patterns",
    "memory_profile",
    "memory_recall",
    "memory_reflect",
    "memory_relations",
    "memory_routine_run",
    "memory_save",
    "memory_sentinel_create",
    "memory_sentinel_trigger",
    "memory_sessions",
    "memory_signal_read",
    "memory_signal_send",
    "memory_sketch_create",
    "memory_sketch_promote",
    "memory_slot_append",
    "memory_slot_create",
    "memory_slot_delete",
    "memory_slot_get",
    "memory_slot_list",
    "memory_slot_replace",
    "memory_smart_search",
    "memory_snapshot_create",
    "memory_team_feed",
    "memory_team_share",
    "memory_timeline",
    "memory_verify",
    "memory_vision_search",
];

/// Tool names both servers expose, with different arguments and meaning.
pub(crate) const COLLIDING_TOOLS: &[&str] = &["memory_consolidate"];

/// The npm package agentmemory's MCP entries launch.
const MCP_PACKAGE: &str = "@agentmemory/";
/// The server name agentmemory registers itself under.
const SERVER_NAME: &str = "agentmemory";
/// A rules file larger than this is not a rules file; skip it.
const MAX_RULES_BYTES: u64 = 4 * 1024 * 1024;
/// Harness configs can be large (`~/.claude.json` keeps per-project history).
const MAX_CONFIG_BYTES: u64 = 64 * 1024 * 1024;
/// Bound on the files read from one rules directory.
const MAX_DIR_ENTRIES: usize = 256;

/// One leftover, with the fix line to show the operator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ResidueFinding {
    /// `mcp_server` or `rules_block`.
    pub(crate) kind: &'static str,
    pub(crate) path: String,
    /// Where in the file: the config key path, or the line range.
    pub(crate) location: String,
    /// agentmemory tool names the block mentions that ai-memory also has.
    pub(crate) colliding_tools: Vec<String>,
    pub(crate) fix: String,
}

/// Scan `mcp_configs` and every known rules file. Read-only; a file that is
/// missing, unreadable, oversized or unparsable contributes nothing.
pub(crate) fn scan(home: &Path, repo_root: &Path, mcp_configs: &[PathBuf]) -> Vec<ResidueFinding> {
    let mut findings = Vec::new();
    for path in mcp_configs {
        if let Some(text) = read_bounded(path, MAX_CONFIG_BYTES) {
            findings.extend(scan_mcp_config(path, &text));
        }
    }
    for path in rules_file_candidates(home, repo_root) {
        if let Some(text) = read_bounded(&path, MAX_RULES_BYTES)
            && let Some(finding) = scan_rules_file(&path, &text)
        {
            findings.push(finding);
        }
    }
    findings
}

/// The MCP config files `install-mcp` knows for every client (resolved
/// through `env`, so harness home relocations apply), plus the project
/// files.
pub(crate) fn mcp_config_candidates(
    repo_root: &Path,
    env: &dyn Fn(&str) -> Option<OsString>,
) -> Vec<PathBuf> {
    use clap::ValueEnum as _;
    let mut paths: Vec<PathBuf> = crate::cli::McpClient::value_variants()
        .iter()
        .filter_map(|client| super::install_mcp::mcp_config_path_with(*client, env).ok())
        .collect();
    paths.extend(project_mcp_configs(repo_root));
    dedup(paths)
}

/// The project-scoped MCP files harnesses read from the repository root.
fn project_mcp_configs(repo_root: &Path) -> Vec<PathBuf> {
    [
        ".mcp.json",
        ".cursor/mcp.json",
        ".gemini/settings.json",
        ".vscode/mcp.json",
    ]
    .iter()
    .map(|name| repo_root.join(name))
    .collect()
}

/// Rules files where harnesses read standing instructions, globally and in
/// the repository: the places a memory-usage guideline block can sit.
pub(crate) fn rules_file_candidates(home: &Path, repo_root: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = [
        "AGENTS.md",
        "CLAUDE.md",
        "GEMINI.md",
        "QWEN.md",
        ".cursorrules",
        ".windsurfrules",
        ".clinerules",
        ".rules",
        ".github/copilot-instructions.md",
    ]
    .iter()
    .map(|name| repo_root.join(name))
    .collect();
    files.extend(
        [
            ".claude/CLAUDE.md",
            ".codex/AGENTS.md",
            ".gemini/GEMINI.md",
            ".qwen/QWEN.md",
            ".factory/AGENTS.md",
            ".copilot/copilot-instructions.md",
            ".config/opencode/AGENTS.md",
        ]
        .iter()
        .map(|name| home.join(name)),
    );
    let dirs: Vec<PathBuf> = [
        ".cursor/rules",
        ".clinerules",
        ".kiro/steering",
        ".continue/rules",
        ".windsurf/rules",
    ]
    .iter()
    .map(|name| repo_root.join(name))
    .chain(
        [".kiro/steering", ".continue/rules", "Documents/Cline/Rules"]
            .iter()
            .map(|name| home.join(name)),
    )
    .collect();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut found: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file()
                    && path
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .is_some_and(|ext| matches!(ext, "md" | "mdc" | "txt"))
            })
            .take(MAX_DIR_ENTRIES)
            .collect();
        found.sort();
        files.extend(found);
    }
    dedup(files)
}

fn dedup(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = BTreeSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn read_bounded(path: &Path, max: u64) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > max {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// Find agentmemory MCP server entries in one harness config (JSON, JSONC or
/// TOML): an entry named `agentmemory`, or any entry launching the
/// `@agentmemory/` package.
pub(crate) fn scan_mcp_config(path: &Path, text: &str) -> Vec<ResidueFinding> {
    let value = if path.extension().and_then(|e| e.to_str()) == Some("toml") {
        text.parse::<toml_edit::DocumentMut>()
            .ok()
            .map(|doc| toml_to_json(doc.as_item()))
    } else {
        jsonc_parser::cst::CstRootNode::parse(text, &jsonc_parser::ParseOptions::default())
            .ok()
            .and_then(|root| root.value())
            .and_then(|node| node.to_serde_value())
    };
    let Some(value) = value else {
        return Vec::new();
    };
    let mut locations = Vec::new();
    walk(&value, &mut Vec::new(), &mut locations);
    locations
        .into_iter()
        .map(|location| ResidueFinding {
            kind: "mcp_server",
            path: path.display().to_string(),
            fix: format!(
                "remove the `{location}` entry from {}; agentmemory is no longer running",
                path.display()
            ),
            location,
            colliding_tools: COLLIDING_TOOLS.iter().map(|t| (*t).to_owned()).collect(),
        })
        .collect()
}

/// A TOML document as JSON, enough for the entry walk: tables become objects,
/// arrays arrays, strings strings, and every other scalar its text.
fn toml_to_json(item: &toml_edit::Item) -> serde_json::Value {
    fn convert(value: &toml_edit::Value) -> serde_json::Value {
        match value {
            toml_edit::Value::String(s) => serde_json::Value::String(s.value().clone()),
            toml_edit::Value::Array(items) => items.iter().map(convert).collect(),
            toml_edit::Value::InlineTable(table) => table
                .iter()
                .map(|(k, v)| (k.to_owned(), convert(v)))
                .collect::<serde_json::Map<_, _>>()
                .into(),
            other => serde_json::Value::String(other.to_string().trim().to_owned()),
        }
    }
    match item {
        toml_edit::Item::Table(table) => table
            .iter()
            .map(|(k, v)| (k.to_owned(), toml_to_json(v)))
            .collect::<serde_json::Map<_, _>>()
            .into(),
        toml_edit::Item::ArrayOfTables(tables) => tables
            .iter()
            .map(|table| toml_to_json(&toml_edit::Item::Table(table.clone())))
            .collect(),
        toml_edit::Item::Value(v) => convert(v),
        toml_edit::Item::None => serde_json::Value::Null,
    }
}

/// Collect the key path of every object that is an agentmemory server entry.
fn walk(value: &serde_json::Value, trail: &mut Vec<String>, out: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map {
                trail.push(key.clone());
                let named = key.eq_ignore_ascii_case(SERVER_NAME) && child.is_object();
                if named || (child.is_object() && launches_package(child)) {
                    out.push(trail.join("."));
                } else {
                    walk(child, trail, out);
                }
                trail.pop();
            }
        }
        serde_json::Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                trail.push(index.to_string());
                walk(child, trail, out);
                trail.pop();
            }
        }
        _ => {}
    }
}

/// Whether a server entry's command, args or URL names the agentmemory
/// package, looking only at its own string fields.
fn launches_package(entry: &serde_json::Value) -> bool {
    let mentions = |value: &serde_json::Value| match value {
        serde_json::Value::String(s) => s.contains(MCP_PACKAGE),
        serde_json::Value::Array(items) => items
            .iter()
            .any(|item| item.as_str().is_some_and(|s| s.contains(MCP_PACKAGE))),
        _ => false,
    };
    ["command", "args", "url"]
        .iter()
        .any(|field| entry.get(field).is_some_and(mentions))
}

/// Find an agentmemory guideline block in one rules file: the lines that
/// name agentmemory-only tools, its package, or an `agentmemory` comment
/// marker. A file that only mentions agentmemory in prose is not flagged.
pub(crate) fn scan_rules_file(path: &Path, text: &str) -> Option<ResidueFinding> {
    let mut first = None;
    let mut last = 0usize;
    for (index, line) in text.lines().enumerate() {
        let lower = line.to_ascii_lowercase();
        let marker =
            (lower.contains("<!--") && lower.contains(SERVER_NAME)) || lower.contains(MCP_PACKAGE);
        if marker
            || AGENTMEMORY_ONLY_TOOLS
                .iter()
                .any(|tool| has_word(line, tool))
        {
            first.get_or_insert(index + 1);
            last = index + 1;
        }
    }
    let first = first?;
    let block: Vec<&str> = text
        .lines()
        .skip(first - 1)
        .take(last + 1 - first)
        .collect();
    let colliding: Vec<String> = COLLIDING_TOOLS
        .iter()
        .filter(|tool| block.iter().any(|line| has_word(line, tool)))
        .map(|tool| (*tool).to_owned())
        .collect();
    let location = if first == last {
        format!("line {first}")
    } else {
        format!("lines {first}-{last}")
    };
    Some(ResidueFinding {
        kind: "rules_block",
        path: path.display().to_string(),
        fix: format!(
            "delete the agentmemory guideline block ({location}) from {}; run `ai-memory install-instructions` if this file should carry ai-memory's routing instead",
            path.display()
        ),
        location,
        colliding_tools: colliding,
    })
}

/// `needle` as a whole identifier in `line`.
fn has_word(line: &str, needle: &str) -> bool {
    let is_ident = |c: char| c.is_ascii_alphanumeric() || c == '_';
    line.match_indices(needle).any(|(at, _)| {
        let before = line[..at].chars().next_back();
        let after = line[at + needle.len()..].chars().next();
        !before.is_some_and(is_ident) && !after.is_some_and(is_ident)
    })
}

/// Human lines for the doctor report; empty when nothing was found.
pub(crate) fn render(findings: &[ResidueFinding]) -> String {
    if findings.is_empty() {
        return String::new();
    }
    let mut out = format!(
        "⚠ agentmemory configuration is still present ({} place(s)). Agents reading it call \
         tools that no longer exist; `memory_consolidate` also exists in ai-memory with \
         different arguments. Nothing was changed; fix by hand:\n",
        findings.len()
    );
    for finding in findings {
        let what = match finding.kind {
            "mcp_server" => "MCP server entry",
            _ => "guideline block",
        };
        out.push_str(&format!(
            "  - {what} in {} ({})\n      fix: {}\n",
            finding.path, finding.location, finding.fix
        ));
        if !finding.colliding_tools.is_empty() && finding.kind == "rules_block" {
            out.push_str(&format!(
                "      names {}, which ai-memory also has: an agent following this block would call ai-memory's tool with agentmemory's arguments\n",
                finding.colliding_tools.join(", ")
            ));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A guideline block shaped like the ones `agentmemory connect` writes.
    const BLOCK: &str = "# Project rules\n\nUse tabs.\n\n<!-- agentmemory:start -->\n## Memory\nBefore a task, call `memory_smart_search`.\nSave decisions with memory_save.\nRun memory_consolidate at the end of a day.\n<!-- agentmemory:end -->\n\nMore rules.\n";

    #[test]
    fn a_guideline_block_is_found_with_its_line_range_and_collisions() {
        let finding = scan_rules_file(Path::new("/r/AGENTS.md"), BLOCK).unwrap();
        assert_eq!(finding.kind, "rules_block");
        assert_eq!(finding.location, "lines 5-10");
        assert_eq!(finding.colliding_tools, ["memory_consolidate"]);
        assert!(finding.fix.contains("/r/AGENTS.md"));
    }

    #[test]
    fn a_block_without_markers_is_still_found_by_tool_names() {
        let text = "Rules\n\nRecall with memory_recall before answering.\n";
        let finding = scan_rules_file(Path::new("GEMINI.md"), text).unwrap();
        assert_eq!(finding.location, "line 3");
        assert!(finding.colliding_tools.is_empty());
    }

    #[test]
    fn clean_files_and_prose_mentions_are_not_flagged() {
        for clean in [
            "# Rules\n\nUse memory_query to recall; memory_write_page to save.\n",
            "We migrated off agentmemory last month.\n",
            "Run memory_consolidate after a long session.\n",
            "my_memory_save_helper and memory_recall_count are our own names.\n",
            "",
        ] {
            assert_eq!(
                scan_rules_file(Path::new("AGENTS.md"), clean),
                None,
                "{clean:?}"
            );
        }
    }

    /// Everything ai-memory itself tells agents: the routing snippet and the
    /// managed skills.
    fn ai_memory_surface() -> Vec<&'static str> {
        std::iter::once(ai_memory_core::SNIPPET_BODY)
            .chain(
                ai_memory_core::routing_skills::MANAGED_SKILLS
                    .iter()
                    .map(|s| s.content),
            )
            .collect()
    }

    #[test]
    fn ai_memory_s_own_routing_is_clean() {
        for text in ai_memory_surface() {
            assert_eq!(scan_rules_file(Path::new("AGENTS.md"), text), None);
        }
    }

    #[test]
    fn the_tool_lists_agree_with_ai_memory_s_surface() {
        let surface = ai_memory_surface();
        for tool in COLLIDING_TOOLS {
            assert!(
                surface.iter().any(|text| has_word(text, tool)),
                "{tool} must be an ai-memory tool to collide"
            );
        }
        for tool in AGENTMEMORY_ONLY_TOOLS {
            assert!(
                !surface.iter().any(|text| has_word(text, tool)),
                "{tool} is an ai-memory tool; it must not mark agentmemory residue"
            );
        }
    }

    #[test]
    fn mcp_entries_are_found_by_name_or_package_in_json_jsonc_and_toml() {
        let cursor = r#"{"mcpServers": {"ai-memory": {"url": "http://127.0.0.1:49374/mcp"}, "agentmemory": {"command": "npx", "args": ["-y", "@agentmemory/mcp"]}}}"#;
        let found = scan_mcp_config(Path::new("/h/.cursor/mcp.json"), cursor);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].location, "mcpServers.agentmemory");
        assert_eq!(found[0].colliding_tools, ["memory_consolidate"]);

        // Renamed entry, JSONC with comments, nested per-project map.
        let claude = "{\n  // user config\n  \"projects\": {\"/w/api\": {\"mcpServers\": {\"mem\": {\"command\": \"npx\", \"args\": [\"@agentmemory/mcp\"]}}}}\n}";
        let found = scan_mcp_config(Path::new("/h/.claude.json"), claude);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].location, "projects./w/api.mcpServers.mem");

        let codex = "[mcp_servers.agentmemory]\ncommand = \"npx\"\nargs = [\"-y\", \"@agentmemory/mcp\"]\n\n[mcp_servers.agentmemory.env]\nAGENTMEMORY_URL = \"http://localhost:3111\"\n";
        let found = scan_mcp_config(Path::new("/h/.codex/config.toml"), codex);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].location, "mcp_servers.agentmemory");
    }

    #[test]
    fn clean_or_unparsable_configs_report_nothing() {
        for (name, text) in [
            (
                "mcp.json",
                r#"{"mcpServers": {"ai-memory": {"url": "http://127.0.0.1:49374/mcp"}}}"#,
            ),
            (
                "mcp.json",
                r#"{"note": "we used @agentmemory/mcp before", "agentmemory": true}"#,
            ),
            ("mcp.json", "{ not json"),
            (
                "config.toml",
                "[mcp_servers.ai-memory]\nurl = \"http://127.0.0.1:49374/mcp\"\n",
            ),
        ] {
            assert!(scan_mcp_config(Path::new(name), text).is_empty(), "{text}");
        }
    }

    #[test]
    fn scan_reads_planted_files_and_never_writes() {
        let home = tempfile::tempdir().unwrap();
        let repo = tempfile::tempdir().unwrap();
        std::fs::write(repo.path().join("AGENTS.md"), BLOCK).unwrap();
        std::fs::create_dir_all(repo.path().join(".cursor/rules")).unwrap();
        std::fs::write(
            repo.path().join(".cursor/rules/memory.mdc"),
            "Call memory_lesson_save.\n",
        )
        .unwrap();
        std::fs::write(repo.path().join("CLAUDE.md"), "@AGENTS.md\n").unwrap();
        std::fs::write(
            repo.path().join(".mcp.json"),
            r#"{"mcpServers": {"agentmemory": {"command": "npx", "args": ["@agentmemory/mcp"]}}}"#,
        )
        .unwrap();
        std::fs::create_dir_all(home.path().join(".gemini")).unwrap();
        std::fs::write(
            home.path().join(".gemini/GEMINI.md"),
            "Use memory_smart_search.\n",
        )
        .unwrap();
        let before: Vec<(PathBuf, Vec<u8>)> = walk_files(repo.path())
            .into_iter()
            .chain(walk_files(home.path()))
            .map(|p| {
                let bytes = std::fs::read(&p).unwrap();
                (p, bytes)
            })
            .collect();

        let findings = scan(home.path(), repo.path(), &project_mcp_configs(repo.path()));
        // Compare as paths, not display strings: on Windows the scanner joins
        // `.cursor/rules` and `memory.mdc` with `\\`, which `Path` treats as
        // the same separator as `/`.
        let mut paths: Vec<PathBuf> = findings.iter().map(|f| PathBuf::from(&f.path)).collect();
        paths.sort_unstable();
        let mut expected = [
            repo.path().join("AGENTS.md"),
            repo.path().join(".cursor/rules/memory.mdc"),
            repo.path().join(".mcp.json"),
            home.path().join(".gemini/GEMINI.md"),
        ];
        expected.sort();
        assert_eq!(paths, expected);
        for (path, bytes) in before {
            assert_eq!(
                std::fs::read(&path).unwrap(),
                bytes,
                "{} changed",
                path.display()
            );
        }
        let text = render(&findings);
        assert!(text.contains("Nothing was changed"), "{text}");
        assert!(text.contains("memory_consolidate"), "{text}");

        let clean_home = tempfile::tempdir().unwrap();
        let clean_repo = tempfile::tempdir().unwrap();
        std::fs::write(clean_repo.path().join("AGENTS.md"), "Use memory_query.\n").unwrap();
        assert!(
            scan(
                clean_home.path(),
                clean_repo.path(),
                &project_mcp_configs(clean_repo.path())
            )
            .is_empty()
        );
        assert_eq!(render(&[]), "");
    }

    fn walk_files(root: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap().filter_map(Result::ok) {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    out.push(path);
                }
            }
        }
        out
    }
}
