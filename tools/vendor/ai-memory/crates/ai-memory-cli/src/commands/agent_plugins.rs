//! The ai-memory marketplace plugins (#1166) as Claude Code and Codex record
//! them on this machine: whether one is installed and enabled, and at which
//! version. `setup` and `ai-memory run` use it to stop writing the parallel
//! settings-file wiring, `doctor` to report the plugin and any double
//! install, `upgrade` to update the Claude Code plugin with the binary, and
//! `uninstall` to remove the plugins.
//!
//! Only the user-level install is read: Claude Code's
//! `<config dir>/plugins/installed_plugins.json` plus `enabledPlugins` in the
//! user `settings.json`, and Codex's `[plugins."ai-memory@ai-memory"]` in
//! `config.toml`. A plugin enabled only in one project's settings is not seen.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::user_service::CommandRunner;

/// The id both harnesses record the plugin under: plugin `ai-memory` from
/// marketplace `ai-memory`.
pub(crate) const PLUGIN_ID: &str = "ai-memory@ai-memory";
/// The marketplace name, for `marketplace update`.
const MARKETPLACE: &str = "ai-memory";

/// Which harness a plugin belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PluginHarness {
    /// Claude Code (`plugins/claude-code`).
    ClaudeCode,
    /// Codex (`plugins/codex`).
    Codex,
}

impl PluginHarness {
    /// The agent name, as `--agent` spells it.
    pub(crate) fn agent(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::Codex => "codex",
        }
    }

    /// The command that removes the plugin.
    pub(crate) fn uninstall_command(self) -> (&'static str, [&'static str; 3]) {
        match self {
            Self::ClaudeCode => ("claude", ["plugin", "uninstall", PLUGIN_ID]),
            Self::Codex => ("codex", ["plugin", "remove", PLUGIN_ID]),
        }
    }
}

/// An installed ai-memory plugin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct InstalledPlugin {
    /// The harness it is installed in.
    pub(crate) harness: PluginHarness,
    /// The installed plugin version, when the harness records one.
    pub(crate) version: Option<String>,
    /// Whether the harness loads it.
    pub(crate) enabled: bool,
}

impl InstalledPlugin {
    /// The plugin version when it differs from this binary's.
    pub(crate) fn version_skew(&self) -> Option<&str> {
        self.version
            .as_deref()
            .filter(|version| *version != env!("CARGO_PKG_VERSION"))
    }
}

/// Claude Code's config root: `CLAUDE_CONFIG_DIR`, else `<home>/.claude`.
pub(crate) fn claude_root(home: &Path, env: &dyn Fn(&str) -> Option<OsString>) -> PathBuf {
    super::path_util::claude_config_dir(env("CLAUDE_CONFIG_DIR"))
        .unwrap_or_else(|| home.join(".claude"))
}

/// Codex's home: `CODEX_HOME`, else `<home>/.codex`.
pub(crate) fn codex_home(home: &Path, env: &dyn Fn(&str) -> Option<OsString>) -> PathBuf {
    super::path_util::agent_config_home(env("CODEX_HOME")).unwrap_or_else(|| home.join(".codex"))
}

/// Both plugins as installed under `home`, honouring the relocation
/// variables `env` reports.
pub(crate) fn installed(
    home: &Path,
    env: &dyn Fn(&str) -> Option<OsString>,
) -> Vec<InstalledPlugin> {
    [
        claude_code_at(&claude_root(home, env)),
        codex_at(&codex_home(home, env)),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// The enabled plugin for `harness` under `home`, if any.
pub(crate) fn enabled(
    harness: PluginHarness,
    home: &Path,
    env: &dyn Fn(&str) -> Option<OsString>,
) -> Option<InstalledPlugin> {
    installed(home, env)
        .into_iter()
        .find(|plugin| plugin.harness == harness && plugin.enabled)
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// The Claude Code plugin under the config root `root`.
pub(crate) fn claude_code_at(root: &Path) -> Option<InstalledPlugin> {
    let installed = read_json(&root.join("plugins").join("installed_plugins.json"))?;
    let entries = installed.get("plugins")?.get(PLUGIN_ID)?.as_array()?;
    let entry = entries
        .iter()
        .find(|entry| entry.get("scope").and_then(serde_json::Value::as_str) == Some("user"))
        .or_else(|| entries.first())?;
    let version = entry
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let enabled = read_json(&root.join("settings.json"))
        .and_then(|settings| settings.get("enabledPlugins")?.get(PLUGIN_ID)?.as_bool())
        .unwrap_or(false);
    Some(InstalledPlugin {
        harness: PluginHarness::ClaudeCode,
        version,
        enabled,
    })
}

/// The Codex plugin under `codex_home`. Codex keeps one cache directory per
/// installed version; the newest one names the version.
pub(crate) fn codex_at(codex_home: &Path) -> Option<InstalledPlugin> {
    let config = std::fs::read_to_string(codex_home.join("config.toml")).ok()?;
    let document = config.parse::<toml_edit::DocumentMut>().ok()?;
    let entry = document.get("plugins")?.get(PLUGIN_ID)?;
    let enabled = entry
        .get("enabled")
        .and_then(toml_edit::Item::as_bool)
        .unwrap_or(true);
    let cache = codex_home
        .join("plugins")
        .join("cache")
        .join(MARKETPLACE)
        .join("ai-memory");
    let version = std::fs::read_dir(&cache)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|dir| {
            let modified = dir.metadata().and_then(|m| m.modified()).ok()?;
            let manifest = read_json(&dir.path().join(".codex-plugin").join("plugin.json"))?;
            let version = manifest.get("version")?.as_str()?.to_owned();
            Some((modified, version))
        })
        .max()
        .map(|(_, version)| version);
    Some(InstalledPlugin {
        harness: PluginHarness::Codex,
        version,
        enabled,
    })
}

/// Bring the Claude Code plugin up to the newest release the marketplace
/// lists. Third-party marketplaces do not auto-update by default, so
/// `upgrade` runs this after replacing the binary to keep the two in step.
/// Returns what to tell the operator; a failure is reported, never fatal.
pub(crate) fn update_claude_code(runner: &dyn CommandRunner) -> Vec<String> {
    let steps: [&[&str]; 2] = [
        &["plugin", "marketplace", "update", MARKETPLACE],
        &["plugin", "update", PLUGIN_ID],
    ];
    let mut lines = Vec::new();
    for args in steps {
        let shown = format!("claude {}", args.join(" "));
        match runner.run("claude", args) {
            Ok(outcome) if outcome.success => lines.push(format!("✓ {shown}")),
            Ok(outcome) => {
                lines.push(format!(
                    "⚠ {shown} failed: {}; run it yourself",
                    outcome.stderr.trim()
                ));
                break;
            }
            Err(error) => {
                lines.push(format!(
                    "⚠ {shown} could not start ({error:#}); run it yourself"
                ));
                break;
            }
        }
    }
    lines
}

/// Fixtures shared by the plugin-aware commands' tests.
#[cfg(test)]
pub(crate) mod test_support {
    use std::cell::RefCell;
    use std::path::Path;

    use super::super::user_service::{CommandOutcome, CommandRunner};

    /// Records every command; the call numbered `fail_at` (1-based) fails.
    pub(crate) struct RecordingRunner {
        pub(crate) calls: RefCell<Vec<String>>,
        fail_at: Option<usize>,
    }

    impl RecordingRunner {
        pub(crate) fn new(fail_at: Option<usize>) -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                fail_at,
            }
        }
    }

    impl CommandRunner for RecordingRunner {
        fn run(&self, program: &str, args: &[&str]) -> anyhow::Result<CommandOutcome> {
            let mut calls = self.calls.borrow_mut();
            calls.push(format!("{program} {}", args.join(" ")));
            Ok(CommandOutcome {
                success: self.fail_at != Some(calls.len()),
                stdout: String::new(),
                stderr: "boom".to_owned(),
            })
        }
    }

    /// Record the Claude Code plugin as installed (at `version`) under
    /// `<home>/.claude`, enabled or not.
    pub(crate) fn install_claude_plugin(home: &Path, version: &str, enabled: bool) {
        let root = home.join(".claude");
        std::fs::create_dir_all(root.join("plugins")).unwrap();
        std::fs::write(
            root.join("plugins/installed_plugins.json"),
            format!(
                r#"{{"version":2,"plugins":{{"ai-memory@ai-memory":[{{"scope":"user","version":"{version}"}}]}}}}"#
            ),
        )
        .unwrap();
        let settings = root.join("settings.json");
        let mut doc: serde_json::Value = std::fs::read_to_string(&settings)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        doc["enabledPlugins"]["ai-memory@ai-memory"] = enabled.into();
        std::fs::write(settings, doc.to_string()).unwrap();
    }

    /// Record the Codex plugin as installed and enabled under `<home>/.codex`.
    pub(crate) fn install_codex_plugin(home: &Path) {
        let root = home.join(".codex");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("config.toml"),
            "[plugins.\"ai-memory@ai-memory\"]\nenabled = true\n",
        )
        .unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::RecordingRunner;
    use super::*;

    fn no_env(_: &str) -> Option<OsString> {
        None
    }

    fn write(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn claude_code_plugin_is_read_from_installed_plugins_and_settings() {
        let home = tempfile::tempdir().unwrap();
        let root = home.path().join(".claude");
        assert_eq!(claude_code_at(&root), None);

        write(
            &root.join("plugins/installed_plugins.json"),
            r#"{"version":2,"plugins":{"ai-memory@ai-memory":[{"scope":"project","version":"0.1.0"},{"scope":"user","installPath":"/x","version":"3.0.0"}],"other@x":[{"scope":"user","version":"9"}]}}"#,
        );
        let plugin = claude_code_at(&root).unwrap();
        assert_eq!(plugin.version.as_deref(), Some("3.0.0"));
        assert!(!plugin.enabled, "installed but not enabled");

        write(
            &root.join("settings.json"),
            r#"{"enabledPlugins":{"ai-memory@ai-memory":true}}"#,
        );
        assert!(claude_code_at(&root).unwrap().enabled);
        assert!(enabled(PluginHarness::ClaudeCode, home.path(), &no_env).is_some());
        assert!(enabled(PluginHarness::Codex, home.path(), &no_env).is_none());

        write(
            &root.join("settings.json"),
            r#"{"enabledPlugins":{"ai-memory@ai-memory":false}}"#,
        );
        assert!(enabled(PluginHarness::ClaudeCode, home.path(), &no_env).is_none());
    }

    #[test]
    fn claude_root_honours_claude_config_dir() {
        let home = Path::new("/home/me");
        assert_eq!(claude_root(home, &no_env), home.join(".claude"));
        let relocated = |name: &str| (name == "CLAUDE_CONFIG_DIR").then(|| OsString::from("/cc"));
        assert_eq!(claude_root(home, &relocated), PathBuf::from("/cc"));
    }

    #[test]
    fn codex_plugin_is_read_from_config_and_the_newest_cache_dir() {
        let home = tempfile::tempdir().unwrap();
        let codex = home.path().join(".codex");
        assert_eq!(codex_at(&codex), None);
        write(
            &codex.join("config.toml"),
            "[plugins.\"other@x\"]\nenabled = true\n",
        );
        assert_eq!(codex_at(&codex), None);

        write(
            &codex.join("config.toml"),
            "model = \"m\"\n[plugins.\"ai-memory@ai-memory\"]\nenabled = true\n",
        );
        write(
            &codex.join("plugins/cache/ai-memory/ai-memory/3.0.0/.codex-plugin/plugin.json"),
            r#"{"name":"ai-memory","version":"3.0.0"}"#,
        );
        let plugin = codex_at(&codex).unwrap();
        assert_eq!(plugin.version.as_deref(), Some("3.0.0"));
        assert!(plugin.enabled);

        write(
            &codex.join("config.toml"),
            "[plugins.\"ai-memory@ai-memory\"]\nenabled = false\n",
        );
        assert!(!codex_at(&codex).unwrap().enabled);
    }

    #[test]
    fn version_skew_compares_with_this_binary() {
        let mut plugin = InstalledPlugin {
            harness: PluginHarness::ClaudeCode,
            version: Some(env!("CARGO_PKG_VERSION").to_owned()),
            enabled: true,
        };
        assert_eq!(plugin.version_skew(), None);
        plugin.version = Some("0.0.1".to_owned());
        assert_eq!(plugin.version_skew(), Some("0.0.1"));
        plugin.version = None;
        assert_eq!(plugin.version_skew(), None);
    }

    #[test]
    fn update_refreshes_the_marketplace_then_the_plugin() {
        let runner = RecordingRunner::new(None);
        let lines = update_claude_code(&runner);
        assert_eq!(
            *runner.calls.borrow(),
            vec![
                "claude plugin marketplace update ai-memory",
                "claude plugin update ai-memory@ai-memory"
            ]
        );
        assert!(lines.iter().all(|line| line.starts_with('✓')), "{lines:?}");

        let runner = RecordingRunner::new(Some(1));
        let lines = update_claude_code(&runner);
        assert_eq!(runner.calls.borrow().len(), 1, "stops after a failure");
        assert!(lines[0].contains("failed: boom"), "{lines:?}");
    }
}
