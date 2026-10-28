//! `ai-memory render-plugins` (hidden) — generate the marketplace plugins.
//!
//! Every file under `plugins/` and the marketplace catalogs at the repository
//! root (`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`)
//! come from here, built from the sources `install-hooks` and
//! `install-skills` already use: the event lists in [`super::render_shared`]
//! and the managed routing skills in `ai-memory-core`. Two callers keep the
//! committed tree honest: the CLI suite's drift test, which fails when the
//! committed files differ from this output, and `bin/release`, which re-renders
//! after the version bump so every manifest and catalog `ref` names the tag
//! being cut (#1166).
//!
//! The plugins stay thin: manifests, skills, and one POSIX launcher that hands
//! each lifecycle event to the installed binary's native `hook` command. No
//! build step, no bundled binary, no first-run download.

use std::path::Path;

use ai_memory_core::routing_skills::MANAGED_SKILLS;
use anyhow::{Context as _, Result};
use serde_json::{Value, json};

use super::render_shared::{CLAUDE_CODE_EVENTS, CODEX_EVENTS};
use crate::cli::RenderPluginsArgs;

/// The repository the catalogs point at.
const REPOSITORY_URL: &str = "https://github.com/akitaonrails/ai-memory";
/// The project's landing page, used for every manifest's `homepage`.
const HOMEPAGE_URL: &str = "https://aimemory.sh";
/// The marketplace name and the plugin name; installs as `ai-memory@ai-memory`.
pub(crate) const MARKETPLACE_NAME: &str = "ai-memory";
/// The plugin's name inside its marketplace.
pub(crate) const PLUGIN_NAME: &str = "ai-memory";

const LAUNCHER: &str = include_str!("../../templates/plugin/ai-memory-hook.sh");
const LICENSE: &str = include_str!("../../../../LICENSE");
const OVERVIEW_README: &str = include_str!("../../templates/plugin/README.md");
const CLAUDE_README: &str = include_str!("../../templates/plugin/claude-code-README.md");
const CODEX_README: &str = include_str!("../../templates/plugin/codex-README.md");
const STATUS_SKILL: &str = include_str!("../../templates/plugin/status-SKILL.md");

/// The launcher's path inside a plugin directory.
const LAUNCHER_PATH: &str = "scripts/ai-memory-hook";

const CLAUDE_DESCRIPTION: &str = "Long-term memory across sessions and harnesses. Hands each \
    lifecycle event to the installed ai-memory binary, which applies your capture exclusions and \
    sends a sanitized record only to your ai-memory server (default http://127.0.0.1:49374). Adds \
    the ai-memory MCP tools. No telemetry. Requires the ai-memory binary, 3.0 or later. In \
    Cowork, capture runs on your computer and needs ai-memory installed there; the memory tools \
    still work.";
const CODEX_DESCRIPTION: &str = "Long-term memory across sessions and harnesses, backed by the \
    installed ai-memory binary (3.0 or later) and your ai-memory server. No telemetry. Codex runs \
    the hooks only \
    after you trust them in /hooks.";

/// One generated file, relative to the repository root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginFile {
    /// Path relative to the repository root, `/`-separated.
    pub path: String,
    /// Exact file contents.
    pub contents: String,
    /// Whether the file is executable (the launcher).
    pub executable: bool,
}

impl PluginFile {
    /// Every constructor goes through here. The templates and LICENSE are
    /// `include_str!`ed, so a CRLF checkout (Windows `core.autocrlf`) would
    /// otherwise ship `/bin/sh^M` launchers and break the drift test.
    fn text(path: impl Into<String>, contents: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            contents: contents.into().replace("\r\n", "\n"),
            executable: false,
        }
    }

    fn script(path: impl Into<String>, contents: impl Into<String>) -> Self {
        Self {
            executable: true,
            ..Self::text(path, contents)
        }
    }

    fn json(path: impl Into<String>, value: &Value) -> Self {
        let mut contents = serde_json::to_string_pretty(value).unwrap_or_default();
        contents.push('\n');
        Self::text(path, contents)
    }
}

/// Every generated file for `version` (the workspace version, without `v`).
#[must_use]
pub fn render(version: &str) -> Vec<PluginFile> {
    let mut files = vec![
        PluginFile::json(".claude-plugin/marketplace.json", &claude_catalog(version)),
        PluginFile::json(".agents/plugins/marketplace.json", &codex_catalog(version)),
        PluginFile::text("plugins/README.md", OVERVIEW_README),
    ];
    files.extend(claude_code_plugin(version));
    files.extend(codex_plugin(version));
    files
}

fn author() -> Value {
    json!({ "name": "AkitaOnRails", "url": "https://github.com/akitaonrails" })
}

fn git_subdir(path: &str, version: &str) -> Value {
    json!({
        "source": "git-subdir",
        "url": format!("{REPOSITORY_URL}.git"),
        "path": path,
        "ref": format!("v{version}"),
    })
}

fn claude_catalog(version: &str) -> Value {
    json!({
        "name": MARKETPLACE_NAME,
        "owner": author(),
        "description": "ai-memory plugins: lifecycle capture and memory tools for coding agents, \
            backed by your own ai-memory server.",
        "plugins": [{
            "name": PLUGIN_NAME,
            "description": "Long-term memory across sessions and harnesses.",
            "version": version,
            "source": git_subdir("plugins/claude-code", version),
        }],
    })
}

fn codex_catalog(version: &str) -> Value {
    json!({
        "name": MARKETPLACE_NAME,
        "interface": { "displayName": "ai-memory" },
        "plugins": [{
            "name": PLUGIN_NAME,
            "source": git_subdir("plugins/codex", version),
            "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
            "category": "Productivity",
        }],
    })
}

/// The files every plugin directory carries: launcher, routing skills, the
/// status skill and the license.
fn common_files(dir: &str) -> Vec<PluginFile> {
    let mut files = vec![
        PluginFile::script(format!("{dir}/{LAUNCHER_PATH}"), LAUNCHER),
        PluginFile::text(format!("{dir}/LICENSE"), LICENSE),
        PluginFile::text(format!("{dir}/skills/status/SKILL.md"), STATUS_SKILL),
    ];
    files.extend(MANAGED_SKILLS.iter().map(|skill| {
        PluginFile::text(
            format!("{dir}/skills/{}", skill.relative_path),
            skill.content,
        )
    }));
    files
}

fn claude_code_plugin(version: &str) -> Vec<PluginFile> {
    const DIR: &str = "plugins/claude-code";
    let option = |title: &str, description: &str, default: &str| json!({ "type": "string", "title": title, "description": description, "default": default });
    let manifest = json!({
        "name": PLUGIN_NAME,
        "displayName": "ai-memory",
        "version": version,
        "description": CLAUDE_DESCRIPTION,
        "author": author(),
        "homepage": HOMEPAGE_URL,
        "repository": REPOSITORY_URL,
        "license": "MIT",
        "keywords": ["memory", "mcp", "hooks", "handoff", "context"],
        "userConfig": {
            "server_url": option(
                "ai-memory server URL",
                "Base URL of the ai-memory server. Leave empty to use the server_url from your \
                 ai-memory config (http://127.0.0.1:49374 for a local install).",
                "",
            ),
            "ai_memory_bin": option(
                "ai-memory executable",
                "Absolute path to the ai-memory binary, only needed when it is not on PATH. A \
                 relative path is ignored.",
                "ai-memory",
            ),
            "data_dir": option(
                "ai-memory data directory",
                "Only for an install that uses a non-default data directory.",
                "",
            ),
        },
    });
    // Run through `sh`, as the Codex plugin does, rather than executing the
    // launcher: a plugin uploaded as a desktop zip can lose the exec bit, and
    // Windows Git Bash does not honour it at all.
    let mut hooks = serde_json::Map::new();
    for (name, script) in CLAUDE_CODE_EVENTS {
        let event = script.trim_end_matches(".sh");
        hooks.insert(
            name.to_owned(),
            json!([{ "matcher": "", "hooks": [{
                "type": "command",
                "command": format!("sh \"${{CLAUDE_PLUGIN_ROOT}}/{LAUNCHER_PATH}\" claude-code {event}"),
            }]}]),
        );
    }
    let hooks = json!({
        "description": "ai-memory lifecycle capture through the installed ai-memory binary",
        "hooks": hooks,
    });
    // The session-aware bridge, as `install-mcp --client claude-code`
    // registers it: the plugin MCP process receives CLAUDE_CODE_SESSION_ID.
    // An unset server_url option arrives as "" and means "use the config".
    let mcp = json!({
        "mcpServers": {
            "ai-memory": {
                "command": "${user_config.ai_memory_bin}",
                "args": ["mcp-bridge", "--server-url", "${user_config.server_url}"],
            }
        }
    });
    let mut files = vec![
        PluginFile::json(format!("{DIR}/.claude-plugin/plugin.json"), &manifest),
        PluginFile::json(format!("{DIR}/hooks/hooks.json"), &hooks),
        PluginFile::json(format!("{DIR}/.mcp.json"), &mcp),
        PluginFile::text(format!("{DIR}/README.md"), CLAUDE_README),
    ];
    files.extend(common_files(DIR));
    files
}

fn codex_plugin(version: &str) -> Vec<PluginFile> {
    const DIR: &str = "plugins/codex";
    // Codex's own manifest location. Codex 0.162.1 installs a plugin whose
    // only manifest is the Agent Plugins root `plugin.json` but discovers no
    // hooks in it, so the native `.codex-plugin/plugin.json` is the one that
    // works; `mcpServers` has to name the MCP file there.
    let manifest = json!({
        "name": PLUGIN_NAME,
        "version": version,
        "description": CODEX_DESCRIPTION,
        "author": author(),
        "homepage": HOMEPAGE_URL,
        "repository": REPOSITORY_URL,
        "license": "MIT",
        "mcpServers": "./mcp.json",
    });
    // Session-less: Codex forwards no lifecycle session id to MCP servers.
    let mcp = json!({
        "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        "mcpServers": {
            "ai-memory": { "type": "stdio", "command": "ai-memory", "args": ["mcp-bridge", "--no-session-id"] }
        }
    });
    // The commands reference ${PLUGIN_ROOT}, never a versioned path, and
    // stay byte-identical across releases: Codex keys hook trust on a hash of
    // the unexpanded command, so a plugin upgrade keeps it.
    let mut hooks = serde_json::Map::new();
    for (name, script) in CODEX_EVENTS {
        let event = script.trim_end_matches(".sh");
        hooks.insert(
            name.to_owned(),
            json!([{ "hooks": [{
                "type": "command",
                "command": format!("sh \"${{PLUGIN_ROOT}}/{LAUNCHER_PATH}\" codex {event}"),
                "commandWindows": format!("ai-memory hook --event {event} --agent codex"),
            }]}]),
        );
    }
    let hooks = json!({ "hooks": hooks });
    let mut files = vec![
        PluginFile::json(format!("{DIR}/.codex-plugin/plugin.json"), &manifest),
        PluginFile::json(format!("{DIR}/mcp.json"), &mcp),
        PluginFile::json(format!("{DIR}/hooks/hooks.json"), &hooks),
        PluginFile::text(format!("{DIR}/README.md"), CODEX_README),
    ];
    files.extend(common_files(DIR));
    files
}

/// Write every generated file below `out`.
///
/// # Errors
/// When a directory or file cannot be written.
pub fn run(args: RenderPluginsArgs) -> Result<()> {
    write_all(&args.out, &render(env!("CARGO_PKG_VERSION")))
}

fn write_all(out: &Path, files: &[PluginFile]) -> Result<()> {
    for file in files {
        let path = out.join(&file.path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating {}", parent.display()))?;
        }
        std::fs::write(&path, &file.contents)
            .with_context(|| format!("writing {}", path.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = if file.executable { 0o755 } else { 0o644 };
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode))
                .with_context(|| format!("setting the mode of {}", path.display()))?;
        }
    }
    println!(
        "rendered {} plugin file(s) under {}",
        files.len(),
        out.display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file<'a>(files: &'a [PluginFile], path: &str) -> &'a PluginFile {
        files
            .iter()
            .find(|f| f.path == path)
            .unwrap_or_else(|| panic!("{path} not rendered"))
    }

    fn json_of(files: &[PluginFile], path: &str) -> Value {
        serde_json::from_str(&file(files, path).contents).unwrap()
    }

    #[test]
    fn every_manifest_and_catalog_names_the_version_and_its_tag() {
        let files = render("9.8.7");
        let claude = json_of(&files, "plugins/claude-code/.claude-plugin/plugin.json");
        assert_eq!(claude["version"], "9.8.7");
        let codex = json_of(&files, "plugins/codex/.codex-plugin/plugin.json");
        assert_eq!(codex["version"], "9.8.7");
        let catalog = json_of(&files, ".claude-plugin/marketplace.json");
        assert_eq!(catalog["plugins"][0]["source"]["ref"], "v9.8.7");
        assert_eq!(catalog["plugins"][0]["version"], "9.8.7");
        let catalog = json_of(&files, ".agents/plugins/marketplace.json");
        assert_eq!(catalog["plugins"][0]["source"]["ref"], "v9.8.7");
    }

    /// The plugin wires exactly the events `install-hooks` wires, through the
    /// launcher, with the agent each harness's native hook expects.
    #[test]
    fn hooks_cover_the_install_hooks_events_through_the_launcher() {
        let files = render("1.0.0");
        let claude = json_of(&files, "plugins/claude-code/hooks/hooks.json");
        let names: Vec<&String> = claude["hooks"].as_object().unwrap().keys().collect();
        assert_eq!(names.len(), CLAUDE_CODE_EVENTS.len());
        for (name, script) in CLAUDE_CODE_EVENTS {
            let command = claude["hooks"][name][0]["hooks"][0]["command"]
                .as_str()
                .unwrap();
            assert_eq!(
                command,
                format!(
                    "sh \"${{CLAUDE_PLUGIN_ROOT}}/scripts/ai-memory-hook\" claude-code {}",
                    script.trim_end_matches(".sh")
                )
            );
        }
        let codex = json_of(&files, "plugins/codex/hooks/hooks.json");
        assert_eq!(
            codex["hooks"].as_object().unwrap().len(),
            CODEX_EVENTS.len()
        );
        for (name, _) in CODEX_EVENTS {
            let command = codex["hooks"][name][0]["hooks"][0]["command"]
                .as_str()
                .unwrap();
            assert!(command.contains("${PLUGIN_ROOT}") && command.contains(" codex "));
        }
    }

    /// The plugins never call the curl script bundle, which sits outside
    /// capture-policy v1, and never carry a credential.
    #[test]
    fn plugins_use_only_the_native_hook_and_carry_no_credential() {
        for file in render("1.0.0") {
            let lower = file.contents.to_ascii_lowercase();
            if file.path.ends_with(".json") {
                // The homepage URL ends in `.sh"`; a script path must not.
                let without_homepage = lower.replace(HOMEPAGE_URL, "");
                assert!(!lower.contains("hooks/claude-code/"), "{}", file.path);
                assert!(!without_homepage.contains(".sh\""), "{}", file.path);
                assert!(!lower.contains("authorization"), "{}", file.path);
                assert!(!lower.contains("auth_token"), "{}", file.path);
                assert!(!lower.contains("auth-token"), "{}", file.path);
            }
        }
        let files = render("1.0.0");
        let launcher = &file(&files, "plugins/claude-code/scripts/ai-memory-hook").contents;
        assert!(launcher.contains("exec \"$bin\" \"$@\""));
        assert!(!launcher.contains("curl"));
        assert!(!launcher.contains("wget"));
    }

    #[test]
    fn mcp_entries_match_the_install_mcp_bridge_shapes() {
        let files = render("1.0.0");
        let claude = json_of(&files, "plugins/claude-code/.mcp.json");
        let args = claude["mcpServers"]["ai-memory"]["args"]
            .as_array()
            .unwrap();
        assert!(!args.iter().any(|a| a == "--no-session-id"));
        let codex = json_of(&files, "plugins/codex/mcp.json");
        let args = codex["mcpServers"]["ai-memory"]["args"].as_array().unwrap();
        assert!(args.iter().any(|a| a == "--no-session-id"));
    }

    #[test]
    fn skills_are_the_managed_routing_skills_plus_status() {
        let files = render("1.0.0");
        for dir in ["plugins/claude-code", "plugins/codex"] {
            for skill in MANAGED_SKILLS {
                assert_eq!(
                    file(&files, &format!("{dir}/skills/{}", skill.relative_path)).contents,
                    skill.content
                );
            }
            assert!(
                file(&files, &format!("{dir}/skills/status/SKILL.md"))
                    .contents
                    .contains("ai-memory doctor")
            );
            assert!(file(&files, &format!("{dir}/scripts/ai-memory-hook")).executable);
        }
    }

    #[test]
    fn rendered_files_are_lf_even_from_a_crlf_checkout() {
        let launcher = PluginFile::script("x", "#!/bin/sh\r\nexec \"$bin\"\r\n");
        assert_eq!(launcher.contents, "#!/bin/sh\nexec \"$bin\"\n");
        assert!(launcher.executable);
        assert_eq!(PluginFile::text("y", "a\r\nb").contents, "a\nb");
        for file in render("1.0.0") {
            assert!(!file.contents.contains('\r'), "{}", file.path);
        }
    }

    #[test]
    fn render_writes_the_tree_with_an_executable_launcher() {
        let temp = tempfile::tempdir().unwrap();
        let files = render("1.0.0");
        write_all(temp.path(), &files).unwrap();
        for file in &files {
            assert_eq!(
                std::fs::read_to_string(temp.path().join(&file.path)).unwrap(),
                file.contents
            );
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(
                temp.path()
                    .join("plugins/claude-code/scripts/ai-memory-hook"),
            )
            .unwrap()
            .permissions()
            .mode();
            assert_eq!(mode & 0o111, 0o111);
        }
    }
}
