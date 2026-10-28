//! The per-user service `ai-memory setup` installs: a systemd `--user` unit on
//! Linux, a launchd LaunchAgent on macOS, and on Windows an `ai-memory` value
//! under the per-user `Run` key that starts [`super::service_host`] at logon.
//!
//! Both are rendered from the packaged templates
//! (`packaging/systemd/ai-memory-user.service` and
//! `packaging/launchd/com.github.akitaonrails.ai-memory.plist`), with the
//! running binary, the data dir and the config file `setup` used substituted
//! in. Spelling the data dir and config out matters: a server started against
//! another config would not require the token `init` recorded there, while the
//! hooks and MCP entries `setup` writes would present it.
//!
//! The service manager is driven through [`CommandRunner`], so tests render
//! into a temp dir and record the `systemctl` / `launchctl` / `reg` calls
//! instead of touching a real user session.

use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result, bail};

/// The systemd user unit template the AUR and RPM packages ship.
const SYSTEMD_USER_TEMPLATE: &str =
    include_str!("../../../../packaging/systemd/ai-memory-user.service");
/// The macOS LaunchAgent template `docs/macos.md` and the menu bar app use.
const LAUNCHD_TEMPLATE: &str =
    include_str!("../../../../packaging/launchd/com.github.akitaonrails.ai-memory.plist");

/// The unit name, the same one the packages install, so a user unit written
/// here takes precedence over a packaged `/usr/lib/systemd/user` copy instead
/// of starting a second server on the same port.
pub(crate) const SYSTEMD_UNIT_NAME: &str = "ai-memory.service";
/// The LaunchAgent label, shared with the macOS menu bar app.
pub(crate) const LAUNCHD_LABEL: &str = "com.github.akitaonrails.ai-memory";

/// Template text each renderer replaces; a template edited so one of them no
/// longer matches fails the render rather than shipping a unit that silently
/// keeps the packaged defaults.
const SYSTEMD_BIN: &str = "/usr/bin/ai-memory";
const SYSTEMD_DATA_DIR: &str = "%h/.local/share/ai-memory";
const SYSTEMD_CONFIG: &str = "%h/.config/ai-memory/config.toml";
const LAUNCHD_BIN: &str = "<string>__AI_MEMORY_BIN__</string>";
const LAUNCHD_HOME: &str = "<string>__HOME__/";

/// The per-user key whose values Windows runs at logon, and the value name.
/// No elevation is needed to write it, unlike a Windows service.
pub(crate) const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
pub(crate) const RUN_VALUE: &str = "ai-memory";
/// The subcommand the logon entry runs.
const SERVICE_HOST: &str = "service-host";

/// Start of the identity line `setup` writes into every unit it renders. The
/// rest of the line is the SHA-256 of the file without that line, so
/// `uninstall` can tell a unit `setup` wrote, and nobody edited since, from a
/// hand-written or hand-edited one, which it leaves alone.
const IDENTITY_PREFIX: &str = "ai-memory-setup-unit sha256:";

/// Which service manager this platform uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ServiceManager {
    SystemdUser,
    Launchd,
    WindowsRun,
}

impl ServiceManager {
    /// The manager for the platform this binary was built for; `None` on
    /// anything without a supported per-user manager.
    pub(crate) const fn current() -> Option<Self> {
        if cfg!(target_os = "linux") {
            Some(Self::SystemdUser)
        } else if cfg!(target_os = "macos") {
            Some(Self::Launchd)
        } else if cfg!(windows) {
            Some(Self::WindowsRun)
        } else {
            None
        }
    }

    pub(crate) const fn describe(self) -> &'static str {
        match self {
            Self::SystemdUser => "systemd user unit",
            Self::Launchd => "launchd LaunchAgent",
            Self::WindowsRun => "Windows logon entry",
        }
    }
}

/// What the rendered service runs.
#[derive(Debug, Clone)]
pub(crate) struct ServiceSpec {
    /// Absolute path of the `ai-memory` binary to run.
    pub(crate) exe: PathBuf,
    pub(crate) data_dir: PathBuf,
    pub(crate) config_path: PathBuf,
    /// The operator's home, where the unit or LaunchAgent is installed.
    pub(crate) home: PathBuf,
    /// `$XDG_CONFIG_HOME`, when set (systemd only).
    pub(crate) xdg_config_home: Option<PathBuf>,
}

/// A rendered service file and where it goes. For [`ServiceManager::WindowsRun`]
/// `path` names the registry value (`HKCU\...\Run\ai-memory`) and `contents`
/// is its data, the command line Windows runs at logon.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ServiceUnit {
    pub(crate) manager: ServiceManager,
    pub(crate) path: PathBuf,
    pub(crate) contents: String,
    /// How to start the Windows host now, without waiting for a logon.
    pub(crate) host: Option<HostLaunch>,
}

/// The command that starts the Windows background host, and the state file
/// it keeps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HostLaunch {
    pub(crate) exe: PathBuf,
    pub(crate) args: Vec<String>,
    pub(crate) state_file: PathBuf,
}

impl ServiceUnit {
    /// Whether the file on disk already holds exactly this unit.
    pub(crate) fn is_current(&self) -> bool {
        std::fs::read_to_string(&self.path).is_ok_and(|text| text == self.contents)
    }

    /// Whether a unit of ours is in place: the file, or on Windows the
    /// registry value.
    pub(crate) fn exists(&self, runner: &dyn CommandRunner) -> bool {
        match self.manager {
            ServiceManager::WindowsRun => run_value(runner).is_some(),
            _ => self.path.exists(),
        }
    }
}

/// Render the unit for `manager`.
///
/// # Errors
/// A path that is relative or holds a control character (which no unit
/// syntax can carry safely), or a template that no longer has the text the
/// renderer replaces.
pub(crate) fn render(manager: ServiceManager, spec: &ServiceSpec) -> Result<ServiceUnit> {
    for (what, path) in [
        ("binary", &spec.exe),
        ("data dir", &spec.data_dir),
        ("config file", &spec.config_path),
        ("home", &spec.home),
    ] {
        checked_path(what, path)?;
    }
    match manager {
        ServiceManager::SystemdUser => render_systemd(spec),
        ServiceManager::Launchd => render_launchd(spec),
        ServiceManager::WindowsRun => render_windows(spec),
    }
}

fn checked_path<'a>(what: &str, path: &'a Path) -> Result<&'a str> {
    let text = path
        .to_str()
        .with_context(|| format!("the {what} path {} is not UTF-8", path.display()))?;
    if !path.is_absolute() {
        bail!("the {what} path {text} is not absolute");
    }
    if text.chars().any(char::is_control) {
        bail!("the {what} path {text:?} contains a control character");
    }
    Ok(text)
}

/// One `ExecStart=` word: double-quoted, with `\` and `"` escaped for the
/// unit parser, `%` doubled so it is no specifier, and `$` doubled so it is
/// no variable expansion.
fn systemd_word(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for ch in text.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '%' => out.push_str("%%"),
            '$' => out.push_str("$$"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

fn render_systemd(spec: &ServiceSpec) -> Result<ServiceUnit> {
    let exec = SYSTEMD_USER_TEMPLATE
        .lines()
        .find(|line| line.starts_with("ExecStart="))
        .context("the packaged systemd user unit has no ExecStart line")?;
    for needle in [SYSTEMD_BIN, SYSTEMD_DATA_DIR, SYSTEMD_CONFIG] {
        if !exec.contains(needle) {
            bail!("the packaged systemd user unit's ExecStart no longer contains {needle}");
        }
    }
    let rendered_exec = exec
        .replacen(
            SYSTEMD_BIN,
            &systemd_word(checked_path("binary", &spec.exe)?),
            1,
        )
        .replacen(
            SYSTEMD_DATA_DIR,
            &systemd_word(checked_path("data dir", &spec.data_dir)?),
            1,
        )
        .replacen(
            SYSTEMD_CONFIG,
            &systemd_word(checked_path("config file", &spec.config_path)?),
            1,
        );
    let body = SYSTEMD_USER_TEMPLATE.replacen(exec, &rendered_exec, 1);
    let unstamped = format!(
        "# Written by `ai-memory setup` from packaging/systemd/ai-memory-user.service.\n\
         # Re-run `ai-memory setup` instead of editing; `ai-memory uninstall` removes it.\n{body}"
    );
    Ok(ServiceUnit {
        manager: ServiceManager::SystemdUser,
        path: unit_path(
            ServiceManager::SystemdUser,
            &spec.home,
            spec.xdg_config_home.as_deref(),
        ),
        contents: stamp(ServiceManager::SystemdUser, &unstamped),
        host: None,
    })
}

/// Where `manager`'s unit for ai-memory lives: under `$XDG_CONFIG_HOME` (when
/// absolute) or `~/.config` for systemd, `~/Library/LaunchAgents` for launchd.
pub(crate) fn unit_path(
    manager: ServiceManager,
    home: &Path,
    xdg_config_home: Option<&Path>,
) -> PathBuf {
    match manager {
        ServiceManager::SystemdUser => xdg_config_home
            .filter(|dir| dir.is_absolute())
            .map_or_else(|| home.join(".config"), Path::to_path_buf)
            .join("systemd")
            .join("user")
            .join(SYSTEMD_UNIT_NAME),
        ServiceManager::Launchd => home
            .join("Library")
            .join("LaunchAgents")
            .join(format!("{LAUNCHD_LABEL}.plist")),
        ServiceManager::WindowsRun => PathBuf::from(format!("{RUN_KEY}\\{RUN_VALUE}")),
    }
}

fn identity_line(manager: ServiceManager, digest: &str) -> String {
    match manager {
        ServiceManager::SystemdUser => format!("# {IDENTITY_PREFIX}{digest}"),
        ServiceManager::Launchd | ServiceManager::WindowsRun => {
            format!("<!-- {IDENTITY_PREFIX}{digest} -->")
        }
    }
}

fn sha256_hex(text: &str) -> String {
    use sha2::{Digest as _, Sha256};
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

/// Insert the identity line: first in a systemd unit, right after the XML
/// declaration in a plist (which must stay first).
fn stamp(manager: ServiceManager, unstamped: &str) -> String {
    let line = identity_line(manager, &sha256_hex(unstamped));
    match manager {
        ServiceManager::SystemdUser | ServiceManager::WindowsRun => format!("{line}\n{unstamped}"),
        ServiceManager::Launchd => match unstamped.split_once('\n') {
            Some((declaration, rest)) => format!("{declaration}\n{line}\n{rest}"),
            None => format!("{line}\n{unstamped}"),
        },
    }
}

/// Whether `text` is a unit `setup` rendered and nobody changed since: exactly
/// one identity line, whose digest matches the rest of the file.
pub(crate) fn is_rendered_by_setup(text: &str) -> bool {
    let mut identities = text
        .split_inclusive('\n')
        .enumerate()
        .filter(|(_, line)| line.contains(IDENTITY_PREFIX));
    let (Some((index, line)), None) = (identities.next(), identities.next()) else {
        return false;
    };
    let Some(digest) = line
        .split_once(IDENTITY_PREFIX)
        .map(|(_, rest)| rest.trim_end_matches(['\n', '\r', ' ', '>', '-']))
    else {
        return false;
    };
    let rest: String = text
        .split_inclusive('\n')
        .enumerate()
        .filter(|(i, _)| *i != index)
        .map(|(_, line)| line)
        .collect();
    digest.len() == 64 && sha256_hex(&rest) == digest
}

fn xml_text(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn render_launchd(spec: &ServiceSpec) -> Result<ServiceUnit> {
    if !LAUNCHD_TEMPLATE.contains(LAUNCHD_BIN) || !LAUNCHD_TEMPLATE.contains(LAUNCHD_HOME) {
        bail!("the packaged LaunchAgent no longer has the placeholders `setup` fills in");
    }
    let string = |text: &str| format!("<string>{}</string>", xml_text(text));
    // The template leaves the data dir and config to the macOS defaults; pass
    // them so the agent serves the install `setup` initialised, whatever
    // `--data-dir` / `AI_MEMORY_DATA_DIR` / `--config` chose.
    let program = [
        string(checked_path("binary", &spec.exe)?),
        string("--data-dir"),
        string(checked_path("data dir", &spec.data_dir)?),
        string("--config"),
        string(checked_path("config file", &spec.config_path)?),
    ]
    .join("\n    ");
    let home = format!("<string>{}/", xml_text(checked_path("home", &spec.home)?));
    let contents = LAUNCHD_TEMPLATE
        .replacen(LAUNCHD_BIN, &program, 1)
        .replace(LAUNCHD_HOME, &home);
    if contents.contains("<string>__") {
        bail!("the packaged LaunchAgent has a placeholder `setup` does not fill in");
    }
    Ok(ServiceUnit {
        manager: ServiceManager::Launchd,
        path: unit_path(ServiceManager::Launchd, &spec.home, None),
        contents: stamp(ServiceManager::Launchd, &contents),
        host: None,
    })
}

/// One argument of a Windows command line, quoted the way
/// `CommandLineToArgvW` (and Rust's own argument parser) reads it back: in
/// double quotes, with the backslashes before the closing quote doubled. A
/// Windows path cannot hold `"`, so one that does is refused.
fn windows_arg(what: &str, text: &str) -> Result<String> {
    if text.contains('"') {
        bail!("the {what} path {text} contains a double quote");
    }
    let trailing = text.len() - text.trim_end_matches('\\').len();
    Ok(format!("\"{text}{}\"", "\\".repeat(trailing)))
}

/// The logon entry: the binary `setup` ran from, the data dir and config it
/// used, and `service-host`, as one command line.
fn render_windows(spec: &ServiceSpec) -> Result<ServiceUnit> {
    // Write plain paths: the canonical form of an install path carries a
    // `\\?\` verbatim prefix, which is unusual in a Run value and one of the
    // signals behaviour-based antivirus weighs (#1280). Uninstall compares
    // both forms as equal, so an entry written by an older build still
    // matches.
    use super::path_util::strip_windows_verbatim_prefix as plain;
    let exe = plain(checked_path("binary", &spec.exe)?);
    let data_dir = plain(checked_path("data dir", &spec.data_dir)?);
    let config = plain(checked_path("config file", &spec.config_path)?);
    let (exe, data_dir, config) = (exe.as_ref(), data_dir.as_ref(), config.as_ref());
    let contents = format!(
        "{} --data-dir {} --config {} {SERVICE_HOST}",
        windows_arg("binary", exe)?,
        windows_arg("data dir", data_dir)?,
        windows_arg("config file", config)?,
    );
    Ok(ServiceUnit {
        manager: ServiceManager::WindowsRun,
        path: unit_path(ServiceManager::WindowsRun, &spec.home, None),
        contents,
        host: Some(HostLaunch {
            exe: PathBuf::from(exe),
            args: ["--data-dir", data_dir, "--config", config, SERVICE_HOST]
                .map(str::to_owned)
                .to_vec(),
            state_file: super::service_host::state_file(&spec.data_dir),
        }),
    })
}

/// Whether a `Run` value is a logon entry `setup` wrote: a quoted
/// `ai-memory.exe` followed by arguments that end in `service-host`. Anything
/// else under the name was written by someone else and is left alone.
pub(crate) fn is_setup_run_entry(data: &str) -> bool {
    let Some((program, args)) = split_run_entry(data) else {
        return false;
    };
    let file = program.rsplit(['\\', '/']).next().unwrap_or(program);
    file.eq_ignore_ascii_case("ai-memory.exe")
        && args.trim_end().ends_with(&format!(" {SERVICE_HOST}"))
        && !args.contains('&')
        && !args.contains('|')
}

/// A `Run` value split into the executable inside its leading quotes and the
/// arguments after them; `None` when the value does not start with a quoted
/// program. The executable needs no unescaping: `is_setup_run_entry` only
/// accepts one ending in `ai-memory.exe`, so no backslash precedes its quote.
fn split_run_entry(data: &str) -> Option<(&str, &str)> {
    data.strip_prefix('"')?.split_once('"')
}

/// The `--data-dir` a `setup` logon entry names, unquoted the way
/// [`windows_arg`] quoted it; `None` when the entry names none. Only the
/// first argument after the quoted executable is read, as `render_windows`
/// writes it, so a `--data-dir` inside the executable's own path never
/// counts.
fn run_entry_data_dir(data: &str) -> Option<String> {
    let (_program, args) = split_run_entry(data)?;
    let quoted = args
        .trim_start()
        .strip_prefix("--data-dir")?
        .trim_start()
        .strip_prefix('"')?;
    let (dir, after) = quoted.split_once('"')?;
    // The quote must end the whole argument, as `windows_arg` writes it:
    // Windows reads `"C:\d"\other` as one argument, `C:\d\other`.
    if !(after.is_empty() || after.starts_with(' ')) {
        return None;
    }
    // `windows_arg` doubles the backslashes that end the path, so their count
    // is even; an odd count means the quote was escaped and the argument goes
    // on past it.
    let trailing = dir.len() - dir.trim_end_matches('\\').len();
    if trailing % 2 != 0 {
        return None;
    }
    Some(dir[..dir.len() - trailing / 2].to_owned())
}

/// Whether two absolute Windows paths name the same directory: the verbatim
/// prefix (`\\?\C:\…`, `\\?\UNC\server\share\…`), trailing separators and
/// letter case do not count. A path that is not absolute matches nothing:
/// `C:` is the current directory on drive C, not its root `C:\`, and would
/// otherwise compare equal once trailing separators are gone.
fn same_windows_dir(left: &str, right: &str) -> bool {
    let plain = |path: &str| {
        let path = path.replace('/', "\\");
        let path = super::path_util::strip_windows_verbatim_prefix(&path).into_owned();
        let bytes = path.as_bytes();
        let drive_absolute = bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && bytes[2] == b'\\';
        let unc = path.starts_with(r"\\") && !path.starts_with(r"\\?\");
        // `\\?\Volume{GUID}\…` names a volume by its GUID; it keeps the
        // verbatim prefix and is as absolute as a drive path.
        const VOLUME: &str = r"\\?\Volume{";
        let volume = path
            .get(..VOLUME.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(VOLUME))
            && path[VOLUME.len()..]
                .split_once('}')
                .is_some_and(|(guid, rest)| {
                    !guid.is_empty() && (rest.is_empty() || rest.starts_with('\\'))
                });
        (drive_absolute || unc || volume).then(|| path.trim_end_matches('\\').to_owned())
    };
    match (plain(left), plain(right)) {
        (Some(left), Some(right)) => left.eq_ignore_ascii_case(&right),
        _ => false,
    }
}

/// Whether the logon entry `data` is the one `setup` wrote for `data_dir`.
/// Another install's entry (a second data dir, a test's temporary one) has
/// the same shape and the same value name, and is not this uninstall's to
/// remove.
fn is_setup_run_entry_for(data: &str, data_dir: &Path) -> bool {
    is_setup_run_entry(data)
        && run_entry_data_dir(data)
            .is_some_and(|dir| same_windows_dir(&dir, &data_dir.to_string_lossy()))
}

/// The data of the `ai-memory` value under the `Run` key; `None` when it is
/// absent or cannot be read.
pub(crate) fn run_value(runner: &dyn CommandRunner) -> Option<String> {
    runner.run_key_value()
}

/// `doctor`'s and `status`' token for [`MissingLogonBinary`], so a script can
/// match one string.
pub(crate) const LOGON_BINARY_MISSING: &str = "logon_binary_missing";

/// The logon entry `setup` wrote for this data dir names an `ai-memory.exe`
/// that is no longer on disk. Antivirus that quarantines the binary leaves the
/// `Run` value behind (#1280): the server then never starts at logon and every
/// hook calls a path that is gone, with nothing else saying why.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub(crate) struct MissingLogonBinary {
    /// Always [`LOGON_BINARY_MISSING`].
    pub(crate) classification: &'static str,
    /// The executable the logon entry names, as written in the value.
    pub(crate) executable: String,
    /// What happened, in one sentence.
    pub(crate) detail: String,
    /// What to do about it.
    pub(crate) fix: &'static str,
}

const MISSING_LOGON_BINARY_FIX: &str = "restore ai-memory.exe (or allow it in your antivirus) \
     and re-run `ai-memory setup`; or remove the logon entry with `ai-memory uninstall --apply` \
     (which removes all of ai-memory's wiring) or `Remove-ItemProperty -Path \
     HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run -Name ai-memory`";

impl MissingLogonBinary {
    /// The warning `doctor` and `status` print.
    pub(crate) fn render_human(&self) -> String {
        format!(
            "⚠ {}: {}\n  Fix: {}. See docs/windows.md (Antivirus / EDR).\n",
            self.classification, self.detail, self.fix
        )
    }
}

/// The logon entry `setup` wrote for `data_dir`, when the `ai-memory.exe` it
/// names is not a file. An entry of another shape, or another data dir's, is
/// not this install's and says nothing.
pub(crate) fn missing_logon_binary(
    runner: &dyn CommandRunner,
    data_dir: &Path,
    is_file: &dyn Fn(&Path) -> bool,
) -> Option<MissingLogonBinary> {
    let data = run_value(runner)?;
    if !is_setup_run_entry_for(&data, data_dir) {
        return None;
    }
    let (executable, _args) = split_run_entry(&data)?;
    if is_file(Path::new(executable)) {
        return None;
    }
    Some(MissingLogonBinary {
        classification: LOGON_BINARY_MISSING,
        executable: executable.to_owned(),
        detail: format!(
            "the Windows logon entry for this data dir runs {executable}, which no longer \
             exists (likely quarantined by antivirus), so the server does not start at logon"
        ),
        fix: MISSING_LOGON_BINARY_FIX,
    })
}

/// [`missing_logon_binary`] against the signed-in user's registry, on
/// Windows only: elsewhere there is no `Run` key, and asking would spawn a
/// `reg` that does not exist.
pub(crate) fn check_logon_binary(data_dir: &Path) -> Option<MissingLogonBinary> {
    if ServiceManager::current() != Some(ServiceManager::WindowsRun) {
        return None;
    }
    missing_logon_binary(&SystemRunner, data_dir, &Path::is_file)
}

/// Pick the data out of `reg query <key> /v <name>`, which prints the key,
/// then `    <name>    REG_SZ    <data>`.
fn parse_reg_query(stdout: &str, name: &str) -> Option<String> {
    stdout.lines().find_map(|line| {
        let rest = line.trim_start().strip_prefix(name)?;
        let rest = rest.trim_start().strip_prefix("REG_SZ")?;
        Some(rest.trim_start().trim_end_matches('\r').to_owned())
    })
}

/// The directory launchd writes the agent's logs to; launchd creates the
/// files but not the directory.
pub(crate) fn launchd_log_dir(home: &Path) -> PathBuf {
    home.join("Library").join("Logs").join("ai-memory")
}

/// The result of one service-manager command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandOutcome {
    pub(crate) success: bool,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

/// Runs `systemctl` / `launchctl` / `id`. Injectable so tests never reach a
/// real service manager.
pub(crate) trait CommandRunner {
    /// Run `program` with `args`; an `Err` means it could not be started.
    fn run(&self, program: &str, args: &[&str]) -> Result<CommandOutcome>;

    /// Run a launcher that leaves a background process behind, with no
    /// captured output. A pipe [`Self::run`] reads would be inherited by that
    /// process and held open, so reading it to the end would never return.
    fn run_launcher(&self, program: &str, args: &[&str]) -> Result<CommandOutcome> {
        self.run(program, args)
    }

    /// The `ai-memory` value under the `Run` key. The default asks
    /// `reg query`, which test doubles script; [`SystemRunner`] reads the
    /// registry directly on Windows.
    fn run_key_value(&self) -> Option<String> {
        let outcome = self
            .run("reg", &["query", RUN_KEY, "/v", RUN_VALUE])
            .ok()
            .filter(|outcome| outcome.success)?;
        parse_reg_query(&outcome.stdout, RUN_VALUE)
    }

    /// Write `data` as the `ai-memory` value under the `Run` key.
    fn set_run_key_value(&self, data: &str) -> Result<()> {
        require(
            self,
            "reg",
            &[
                "add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", data, "/f",
            ],
        )
        .map(drop)
    }

    /// Delete the `ai-memory` value under the `Run` key.
    fn delete_run_key_value(&self) -> Result<()> {
        require(self, "reg", &["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]).map(drop)
    }
}

/// Runs commands for real, resolved through `PATH`.
pub(crate) struct SystemRunner;

/// The `Run` key below `HKEY_CURRENT_USER`, as the registry API names it.
#[cfg(windows)]
const RUN_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// String values under `HKEY_CURRENT_USER`, through the registry API.
#[cfg(windows)]
mod user_registry {
    use anyhow::{Context as _, Result};

    /// A `REG_SZ` value. `get_string` also reads `REG_EXPAND_SZ`, which
    /// `setup` never writes: such a value under the same name is someone
    /// else's, as it was when `reg query` output was parsed for `REG_SZ`.
    pub(super) fn get(subkey: &str, name: &str) -> Option<String> {
        let key = windows_registry::CURRENT_USER.open(subkey).ok()?;
        match key.get_type(name).ok()? {
            windows_registry::Type::String => key.get_string(name).ok(),
            _ => None,
        }
    }

    pub(super) fn set(subkey: &str, name: &str, data: &str) -> Result<()> {
        windows_registry::CURRENT_USER
            .create(subkey)
            .and_then(|key| key.set_string(name, data))
            .with_context(|| format!(r"writing HKCU\{subkey}\{name}"))
    }

    pub(super) fn delete(subkey: &str, name: &str) -> Result<()> {
        windows_registry::CURRENT_USER
            .create(subkey)
            .and_then(|key| key.remove_value(name))
            .with_context(|| format!(r"deleting HKCU\{subkey}\{name}"))
    }
}

impl CommandRunner for SystemRunner {
    // Through the registry API, not `reg.exe`: an unsigned binary spawning
    // `reg.exe add …\CurrentVersion\Run` is a textbook persistence signal,
    // and Bitdefender's behavioral engine quarantined `ai-memory.exe` for it
    // (#1280).
    #[cfg(windows)]
    fn run_key_value(&self) -> Option<String> {
        user_registry::get(RUN_SUBKEY, RUN_VALUE)
    }

    #[cfg(windows)]
    fn set_run_key_value(&self, data: &str) -> Result<()> {
        user_registry::set(RUN_SUBKEY, RUN_VALUE, data)
    }

    #[cfg(windows)]
    fn delete_run_key_value(&self) -> Result<()> {
        user_registry::delete(RUN_SUBKEY, RUN_VALUE)
    }

    fn run(&self, program: &str, args: &[&str]) -> Result<CommandOutcome> {
        let output = std::process::Command::new(program)
            .args(args)
            .stdin(std::process::Stdio::null())
            .output()
            .with_context(|| format!("running {program}"))?;
        Ok(CommandOutcome {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }

    fn run_launcher(&self, program: &str, args: &[&str]) -> Result<CommandOutcome> {
        let status = std::process::Command::new(program)
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .with_context(|| format!("running {program}"))?;
        Ok(CommandOutcome {
            success: status.success(),
            stdout: String::new(),
            stderr: format!("exited with {status}"),
        })
    }
}

/// What installing the service did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ServiceChange {
    /// The unit was written for the first time and the service started.
    Installed,
    /// The unit changed and the service was restarted on it.
    Updated,
    /// The unit was current but the service was not running; it was started.
    Started,
    /// The unit was current and the service already running: nothing done.
    Unchanged,
}

/// Write `unit` when it differs from the file on disk, then make sure the
/// service is enabled and running on it. A current unit whose service already
/// runs is left alone, so a second `setup` changes nothing.
///
/// # Errors
/// A failed write, or a service-manager command that could not be run or
/// failed; the error carries its output.
pub(crate) fn install(unit: &ServiceUnit, runner: &dyn CommandRunner) -> Result<ServiceChange> {
    if unit.manager == ServiceManager::WindowsRun {
        return install_windows(unit, runner);
    }
    let existed = unit.path.exists();
    let current = unit.is_current();
    let running = match unit.manager {
        ServiceManager::SystemdUser => systemd_running(runner),
        ServiceManager::Launchd => launchd_loaded(runner, &launchd_domain(runner)?),
        ServiceManager::WindowsRun => false,
    };
    if current && running {
        return Ok(ServiceChange::Unchanged);
    }
    if !current {
        write_unit(unit)?;
    }
    match unit.manager {
        ServiceManager::SystemdUser => start_systemd(runner)?,
        ServiceManager::Launchd => start_launchd(unit, runner, running)?,
        ServiceManager::WindowsRun => {}
    }
    Ok(match (existed, current) {
        (false, _) => ServiceChange::Installed,
        (true, false) => ServiceChange::Updated,
        (true, true) => ServiceChange::Started,
    })
}

/// Write the logon entry when it differs, then (re)start the host now so the
/// server answers before the next logon. A current entry whose host runs is
/// left alone.
fn install_windows(unit: &ServiceUnit, runner: &dyn CommandRunner) -> Result<ServiceChange> {
    let host = unit
        .host
        .as_ref()
        .context("the Windows logon entry has no host command")?;
    let existing = run_value(runner);
    let current = existing.as_deref() == Some(unit.contents.as_str());
    if current && super::service_host::running(&host.state_file).is_some() {
        return Ok(ServiceChange::Unchanged);
    }
    if !current {
        runner.set_run_key_value(&unit.contents)?;
    }
    super::service_host::stop(&host.state_file, runner)?;
    let exe = host.exe.to_string_lossy();
    let args: Vec<&str> = host.args.iter().map(String::as_str).collect();
    let started = runner.run_launcher(&exe, &args)?;
    if !started.success {
        bail!(
            "`{exe} {}` failed: {}",
            args.join(" "),
            started.stderr.trim()
        );
    }
    Ok(match (existing.is_some(), current) {
        (false, _) => ServiceChange::Installed,
        (true, false) => ServiceChange::Updated,
        (true, true) => ServiceChange::Started,
    })
}

fn write_unit(unit: &ServiceUnit) -> Result<()> {
    if let Some(parent) = unit.path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    ai_memory_wiki::write_atomic(&unit.path, unit.contents.as_bytes())
        .with_context(|| format!("writing {}", unit.path.display()))?;
    // No secret lives in a unit; keep the conventional mode, since launchd
    // refuses a LaunchAgent other users can write and systemd only reads it.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&unit.path, std::fs::Permissions::from_mode(0o644))
            .with_context(|| format!("setting the mode of {}", unit.path.display()))?;
    }
    Ok(())
}

fn require<R: CommandRunner + ?Sized>(
    runner: &R,
    program: &str,
    args: &[&str],
) -> Result<CommandOutcome> {
    let outcome = runner.run(program, args)?;
    if !outcome.success {
        bail!(
            "`{program} {}` failed: {}",
            args.join(" "),
            outcome.stderr.trim()
        );
    }
    Ok(outcome)
}

fn succeeds(runner: &dyn CommandRunner, program: &str, args: &[&str]) -> bool {
    runner
        .run(program, args)
        .is_ok_and(|outcome| outcome.success)
}

fn systemd_running(runner: &dyn CommandRunner) -> bool {
    succeeds(
        runner,
        "systemctl",
        &["--user", "is-active", "--quiet", SYSTEMD_UNIT_NAME],
    ) && succeeds(
        runner,
        "systemctl",
        &["--user", "is-enabled", "--quiet", SYSTEMD_UNIT_NAME],
    )
}

fn start_systemd(runner: &dyn CommandRunner) -> Result<()> {
    require(runner, "systemctl", &["--user", "daemon-reload"])?;
    require(
        runner,
        "systemctl",
        &["--user", "enable", SYSTEMD_UNIT_NAME],
    )?;
    require(
        runner,
        "systemctl",
        &["--user", "restart", SYSTEMD_UNIT_NAME],
    )?;
    Ok(())
}

fn launchd_domain(runner: &dyn CommandRunner) -> Result<String> {
    let uid = require(runner, "id", &["-u"])?.stdout.trim().to_owned();
    if uid.is_empty() || !uid.chars().all(|c| c.is_ascii_digit()) {
        bail!("`id -u` printed {uid:?}, not a user id");
    }
    Ok(format!("gui/{uid}"))
}

fn launchd_loaded(runner: &dyn CommandRunner, domain: &str) -> bool {
    succeeds(
        runner,
        "launchctl",
        &["print", &format!("{domain}/{LAUNCHD_LABEL}")],
    )
}

fn start_launchd(unit: &ServiceUnit, runner: &dyn CommandRunner, loaded: bool) -> Result<()> {
    let domain = launchd_domain(runner)?;
    if let Some(home) = unit
        .path
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
    {
        let logs = launchd_log_dir(home);
        std::fs::create_dir_all(&logs).with_context(|| format!("creating {}", logs.display()))?;
    }
    if loaded {
        require(
            runner,
            "launchctl",
            &["bootout", &format!("{domain}/{LAUNCHD_LABEL}")],
        )?;
    }
    let plist = unit.path.to_string_lossy();
    require(runner, "launchctl", &["bootstrap", &domain, &plist])?;
    Ok(())
}

/// What `uninstall` did about the user service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Removal {
    /// There is no unit at the path `setup` writes.
    Absent,
    /// `setup`'s unit was stopped, disabled and deleted.
    Removed(PathBuf),
    /// A unit is there but `setup` did not write it, or it was edited since;
    /// it was left alone.
    NotOurs(PathBuf),
}

/// Whether `manager`'s unit at `path` is one `uninstall` would remove; reads
/// only (on Windows, through `reg query`).
pub(crate) fn planned_removal_for(
    manager: ServiceManager,
    path: &Path,
    data_dir: &Path,
    runner: &dyn CommandRunner,
) -> Removal {
    if manager != ServiceManager::WindowsRun {
        return planned_removal(path);
    }
    match run_value(runner) {
        None => Removal::Absent,
        Some(data) if is_setup_run_entry_for(&data, data_dir) => {
            Removal::Removed(path.to_path_buf())
        }
        Some(_) => Removal::NotOurs(path.to_path_buf()),
    }
}

/// Whether the unit at `path` is one `uninstall` would remove; reads only.
pub(crate) fn planned_removal(path: &Path) -> Removal {
    match std::fs::read_to_string(path) {
        Err(_) if !path.exists() => Removal::Absent,
        Ok(text) if is_rendered_by_setup(&text) => Removal::Removed(path.to_path_buf()),
        _ => Removal::NotOurs(path.to_path_buf()),
    }
}

/// Stop, disable and delete the unit at `path` when `setup` wrote it and it
/// is unedited; leave anything else alone. A second call finds nothing.
///
/// # Errors
/// A service-manager command that fails (the file is then kept, so a still
/// running service never loses its unit) or a failed delete.
pub(crate) fn remove(
    manager: ServiceManager,
    path: &Path,
    data_dir: &Path,
    runner: &dyn CommandRunner,
) -> Result<Removal> {
    let planned = planned_removal_for(manager, path, data_dir, runner);
    if !matches!(planned, Removal::Removed(_)) {
        return Ok(planned);
    }
    match manager {
        ServiceManager::SystemdUser => {
            require(
                runner,
                "systemctl",
                &["--user", "disable", "--now", SYSTEMD_UNIT_NAME],
            )?;
            delete_unit(path)?;
            require(runner, "systemctl", &["--user", "daemon-reload"])?;
        }
        ServiceManager::Launchd => {
            let domain = launchd_domain(runner)?;
            if launchd_loaded(runner, &domain) {
                require(
                    runner,
                    "launchctl",
                    &["bootout", &format!("{domain}/{LAUNCHD_LABEL}")],
                )?;
            }
            delete_unit(path)?;
        }
        ServiceManager::WindowsRun => {
            super::service_host::stop(&super::service_host::state_file(data_dir), runner)?;
            runner.delete_run_key_value()?;
        }
    }
    Ok(planned)
}

fn delete_unit(path: &Path) -> Result<()> {
    std::fs::remove_file(path).with_context(|| format!("removing {}", path.display()))
}

// The service step is Unix-only (systemd user units, launchd), and these
// tests render and drive it with Unix paths.
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// Records every call and answers from a script: the first matching
    /// `(program, first args)` prefix wins, anything else succeeds.
    #[derive(Default)]
    struct FakeRunner {
        calls: RefCell<Vec<String>>,
        failing: Vec<&'static str>,
        stdout: Vec<(&'static str, &'static str)>,
    }

    impl CommandRunner for FakeRunner {
        fn run(&self, program: &str, args: &[&str]) -> Result<CommandOutcome> {
            let line = format!("{program} {}", args.join(" "));
            self.calls.borrow_mut().push(line.clone());
            let success = !self.failing.iter().any(|prefix| line.starts_with(prefix));
            let stdout = self
                .stdout
                .iter()
                .find(|(prefix, _)| line.starts_with(prefix))
                .map_or_else(String::new, |(_, out)| (*out).to_owned());
            Ok(CommandOutcome {
                success,
                stdout,
                stderr: if success {
                    String::new()
                } else {
                    "boom".into()
                },
            })
        }
    }

    fn spec(root: &Path) -> ServiceSpec {
        ServiceSpec {
            exe: root.join("bin").join("ai-memory"),
            data_dir: root.join("data"),
            config_path: root.join("data").join("config.toml"),
            home: root.join("home"),
            xdg_config_home: None,
        }
    }

    fn exec_line(unit: &ServiceUnit) -> String {
        unit.contents
            .lines()
            .find(|line| line.starts_with("ExecStart="))
            .unwrap()
            .to_owned()
    }

    #[test]
    fn the_systemd_unit_runs_this_binary_on_this_install() {
        let root = Path::new("/srv/u");
        let unit = render(ServiceManager::SystemdUser, &spec(root)).unwrap();
        assert_eq!(
            unit.path,
            Path::new("/srv/u/home/.config/systemd/user/ai-memory.service")
        );
        assert_eq!(
            exec_line(&unit),
            "ExecStart=\"/srv/u/bin/ai-memory\" --data-dir \"/srv/u/data\" --config \
             \"/srv/u/data/config.toml\" serve --transport http --enable-web"
        );
        // Everything else is the packaged unit, untouched.
        for line in SYSTEMD_USER_TEMPLATE
            .lines()
            .filter(|line| !line.starts_with("ExecStart="))
        {
            assert!(unit.contents.contains(line), "lost template line {line}");
        }
    }

    #[test]
    fn the_systemd_unit_honours_an_absolute_xdg_config_home_only() {
        let mut spec = spec(Path::new("/srv/u"));
        spec.xdg_config_home = Some(PathBuf::from("/srv/xdg"));
        let unit = render(ServiceManager::SystemdUser, &spec).unwrap();
        assert_eq!(
            unit.path,
            Path::new("/srv/xdg/systemd/user/ai-memory.service")
        );
        spec.xdg_config_home = Some(PathBuf::from("relative/xdg"));
        let unit = render(ServiceManager::SystemdUser, &spec).unwrap();
        assert!(unit.path.starts_with("/srv/u/home/.config"));
    }

    /// A path with a space, a quote, a specifier and a variable must reach the
    /// server as one literal argument, never as a split word, a `%h`
    /// expansion or an environment lookup.
    #[test]
    fn hostile_paths_are_quoted_as_single_literal_words() {
        let mut spec = spec(Path::new("/srv/u"));
        spec.data_dir = PathBuf::from("/srv/my data/%h/$HOME/\"q\"/back\\slash");
        let unit = render(ServiceManager::SystemdUser, &spec).unwrap();
        assert!(
            exec_line(&unit).contains(
                "--data-dir \"/srv/my data/%%h/$$HOME/\\\"q\\\"/back\\\\slash\" --config"
            ),
            "{}",
            exec_line(&unit)
        );
    }

    #[test]
    fn control_characters_and_relative_paths_are_refused() {
        let mut bad = spec(Path::new("/srv/u"));
        bad.data_dir = PathBuf::from("/srv/u/data\nExecStartPre=/bin/sh -c evil");
        for manager in [ServiceManager::SystemdUser, ServiceManager::Launchd] {
            let err = render(manager, &bad).unwrap_err();
            assert!(format!("{err:#}").contains("control character"), "{err:#}");
        }
        let mut relative = spec(Path::new("/srv/u"));
        relative.exe = PathBuf::from("bin/ai-memory");
        assert!(render(ServiceManager::SystemdUser, &relative).is_err());
    }

    #[test]
    fn the_launch_agent_fills_every_placeholder_and_escapes_xml() {
        let mut spec = spec(Path::new("/Users/a"));
        spec.data_dir = PathBuf::from("/Users/a/<x>&y");
        let unit = render(ServiceManager::Launchd, &spec).unwrap();
        assert_eq!(
            unit.path,
            Path::new("/Users/a/home/Library/LaunchAgents/com.github.akitaonrails.ai-memory.plist")
        );
        assert!(
            unit.contents
                .contains("<string>/Users/a/bin/ai-memory</string>")
        );
        assert!(unit.contents.contains(
            "<string>--data-dir</string>\n    <string>/Users/a/&lt;x&gt;&amp;y</string>"
        ));
        assert!(
            unit.contents
                .contains("<string>/Users/a/home/Library/Logs/ai-memory/stdout.log</string>")
        );
        assert!(!unit.contents.contains("<string>__"));
        assert!(unit.contents.contains("<string>serve</string>"));
    }

    #[test]
    fn a_first_systemd_install_writes_the_unit_and_starts_it() {
        let tmp = tempfile::tempdir().unwrap();
        let unit = render(ServiceManager::SystemdUser, &spec(tmp.path())).unwrap();
        let runner = FakeRunner {
            failing: vec!["systemctl --user is-active"],
            ..FakeRunner::default()
        };
        assert_eq!(install(&unit, &runner).unwrap(), ServiceChange::Installed);
        assert!(unit.is_current());
        assert_eq!(
            runner.calls.borrow().clone(),
            vec![
                "systemctl --user is-active --quiet ai-memory.service",
                "systemctl --user daemon-reload",
                "systemctl --user enable ai-memory.service",
                "systemctl --user restart ai-memory.service",
            ]
        );
    }

    /// The idempotence contract: a current unit with a running service makes
    /// no write and no state-changing call.
    #[test]
    fn a_current_running_systemd_unit_is_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let unit = render(ServiceManager::SystemdUser, &spec(tmp.path())).unwrap();
        write_unit(&unit).unwrap();
        let before = std::fs::metadata(&unit.path).unwrap().modified().unwrap();
        let runner = FakeRunner::default();
        assert_eq!(install(&unit, &runner).unwrap(), ServiceChange::Unchanged);
        assert_eq!(
            std::fs::metadata(&unit.path).unwrap().modified().unwrap(),
            before
        );
        assert!(
            runner
                .calls
                .borrow()
                .iter()
                .all(|call| call.contains("is-active") || call.contains("is-enabled")),
            "{:?}",
            runner.calls.borrow()
        );
    }

    #[test]
    fn a_changed_unit_is_rewritten_and_restarted() {
        let tmp = tempfile::tempdir().unwrap();
        let unit = render(ServiceManager::SystemdUser, &spec(tmp.path())).unwrap();
        std::fs::create_dir_all(unit.path.parent().unwrap()).unwrap();
        std::fs::write(&unit.path, "stale").unwrap();
        let runner = FakeRunner::default();
        assert_eq!(install(&unit, &runner).unwrap(), ServiceChange::Updated);
        assert!(unit.is_current());
        assert!(
            runner
                .calls
                .borrow()
                .contains(&"systemctl --user restart ai-memory.service".to_owned())
        );
    }

    #[test]
    fn a_failing_service_manager_is_an_error_with_its_output() {
        let tmp = tempfile::tempdir().unwrap();
        let unit = render(ServiceManager::SystemdUser, &spec(tmp.path())).unwrap();
        let runner = FakeRunner {
            failing: vec!["systemctl"],
            ..FakeRunner::default()
        };
        let err = install(&unit, &runner).unwrap_err();
        assert!(
            format!("{err:#}").contains("daemon-reload` failed: boom"),
            "{err:#}"
        );
    }

    #[test]
    fn a_launch_agent_is_bootstrapped_into_the_gui_domain() {
        let tmp = tempfile::tempdir().unwrap();
        let unit = render(ServiceManager::Launchd, &spec(tmp.path())).unwrap();
        let runner = FakeRunner {
            failing: vec!["launchctl print"],
            stdout: vec![("id -u", "501\n")],
            ..FakeRunner::default()
        };
        assert_eq!(install(&unit, &runner).unwrap(), ServiceChange::Installed);
        let plist = unit.path.to_string_lossy().into_owned();
        assert_eq!(
            runner.calls.borrow().clone(),
            vec![
                "id -u".to_owned(),
                "launchctl print gui/501/com.github.akitaonrails.ai-memory".to_owned(),
                "id -u".to_owned(),
                format!("launchctl bootstrap gui/501 {plist}"),
            ]
        );
        assert!(launchd_log_dir(&tmp.path().join("home")).is_dir());

        // Changed while loaded: booted out first, then bootstrapped again.
        std::fs::write(&unit.path, "stale").unwrap();
        let runner = FakeRunner {
            stdout: vec![("id -u", "501\n")],
            ..FakeRunner::default()
        };
        assert_eq!(install(&unit, &runner).unwrap(), ServiceChange::Updated);
        assert!(
            runner.calls.borrow().contains(
                &"launchctl bootout gui/501/com.github.akitaonrails.ai-memory".to_owned()
            )
        );
    }

    #[test]
    fn a_non_numeric_uid_is_refused() {
        let runner = FakeRunner {
            stdout: vec![("id -u", "501; rm -rf ~\n")],
            ..FakeRunner::default()
        };
        assert!(launchd_domain(&runner).is_err());
    }

    #[test]
    fn rendered_units_carry_an_identity_that_survives_only_unedited() {
        for manager in [ServiceManager::SystemdUser, ServiceManager::Launchd] {
            let unit = render(manager, &spec(Path::new("/srv/u"))).unwrap();
            assert!(is_rendered_by_setup(&unit.contents), "{manager:?}");
            // Hand-edited: any byte changed outside the identity line.
            let edited = unit.contents.replacen("serve", "serve --verbose", 1);
            assert!(!is_rendered_by_setup(&edited), "{manager:?} edited");
            // A copied identity line on a different body, or two of them.
            let line = unit
                .contents
                .lines()
                .find(|l| l.contains(IDENTITY_PREFIX))
                .unwrap();
            assert!(!is_rendered_by_setup(&format!(
                "{line}\n[Service]\nExecStart=/bin/evil\n"
            )));
            assert!(!is_rendered_by_setup(&format!("{line}\n{}", unit.contents)));
        }
        // The packaged template itself (what a package or a person installs)
        // is not ours.
        assert!(!is_rendered_by_setup(SYSTEMD_USER_TEMPLATE));
        assert!(!is_rendered_by_setup(LAUNCHD_TEMPLATE));
    }

    #[test]
    fn removing_our_systemd_unit_stops_disables_deletes_and_reloads_once() {
        let tmp = tempfile::tempdir().unwrap();
        let unit = render(ServiceManager::SystemdUser, &spec(tmp.path())).unwrap();
        write_unit(&unit).unwrap();
        let runner = FakeRunner::default();
        assert_eq!(
            remove(
                ServiceManager::SystemdUser,
                &unit.path,
                Path::new("/unused"),
                &runner
            )
            .unwrap(),
            Removal::Removed(unit.path.clone())
        );
        assert!(!unit.path.exists());
        assert_eq!(
            runner.calls.borrow().clone(),
            vec![
                "systemctl --user disable --now ai-memory.service",
                "systemctl --user daemon-reload",
            ]
        );

        // A second removal finds nothing and calls nothing.
        let again = FakeRunner::default();
        assert_eq!(
            remove(
                ServiceManager::SystemdUser,
                &unit.path,
                Path::new("/unused"),
                &again
            )
            .unwrap(),
            Removal::Absent
        );
        assert!(again.calls.borrow().is_empty());
    }

    /// Adversarial control: a unit `setup` did not write, or one edited after
    /// it did, is neither stopped nor deleted.
    #[test]
    fn a_foreign_or_edited_unit_is_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let unit = render(ServiceManager::SystemdUser, &spec(tmp.path())).unwrap();
        std::fs::create_dir_all(unit.path.parent().unwrap()).unwrap();
        for text in [
            SYSTEMD_USER_TEMPLATE.to_owned(),
            unit.contents
                .replacen("Restart=on-failure", "Restart=always", 1),
        ] {
            std::fs::write(&unit.path, &text).unwrap();
            let runner = FakeRunner::default();
            assert_eq!(
                remove(
                    ServiceManager::SystemdUser,
                    &unit.path,
                    Path::new("/unused"),
                    &runner
                )
                .unwrap(),
                Removal::NotOurs(unit.path.clone())
            );
            assert_eq!(std::fs::read_to_string(&unit.path).unwrap(), text);
            assert!(runner.calls.borrow().is_empty());
        }
    }

    #[test]
    fn a_failed_disable_keeps_the_unit() {
        let tmp = tempfile::tempdir().unwrap();
        let unit = render(ServiceManager::SystemdUser, &spec(tmp.path())).unwrap();
        write_unit(&unit).unwrap();
        let runner = FakeRunner {
            failing: vec!["systemctl --user disable"],
            ..FakeRunner::default()
        };
        assert!(
            remove(
                ServiceManager::SystemdUser,
                &unit.path,
                Path::new("/unused"),
                &runner
            )
            .is_err()
        );
        assert!(unit.is_current());
    }

    #[test]
    fn removing_our_launch_agent_boots_it_out_then_deletes_it() {
        let tmp = tempfile::tempdir().unwrap();
        let unit = render(ServiceManager::Launchd, &spec(tmp.path())).unwrap();
        write_unit(&unit).unwrap();
        let runner = FakeRunner {
            stdout: vec![("id -u", "501\n")],
            ..FakeRunner::default()
        };
        assert_eq!(
            remove(
                ServiceManager::Launchd,
                &unit.path,
                Path::new("/unused"),
                &runner
            )
            .unwrap(),
            Removal::Removed(unit.path.clone())
        );
        assert!(!unit.path.exists());
        assert_eq!(
            runner.calls.borrow().clone(),
            vec![
                "id -u",
                "launchctl print gui/501/com.github.akitaonrails.ai-memory",
                "launchctl bootout gui/501/com.github.akitaonrails.ai-memory",
            ]
        );
    }

    /// The logon entry: an unchanged entry whose host runs is left alone; a
    /// missing one is written with `reg add` and the host started now; a
    /// current one whose host died is only restarted.
    #[test]
    fn the_windows_logon_entry_is_written_once_and_the_host_started() {
        let root = tempfile::tempdir().unwrap();
        let unit = render(ServiceManager::WindowsRun, &spec(root.path())).unwrap();
        let host = unit.host.clone().unwrap();
        let exe = host.exe.display().to_string();

        let fresh = FakeRunner {
            failing: vec!["reg query"],
            ..FakeRunner::default()
        };
        assert_eq!(install(&unit, &fresh).unwrap(), ServiceChange::Installed);
        let calls = fresh.calls.borrow();
        assert_eq!(calls.len(), 3, "{calls:?}");
        assert!(calls[0].starts_with("reg query"));
        assert!(
            calls[1].starts_with(&format!("reg add {RUN_KEY} /v ai-memory /t REG_SZ /d ")),
            "{calls:?}"
        );
        assert!(calls[1].ends_with(" service-host /f"), "{calls:?}");
        assert!(
            calls[2].starts_with(&exe) && calls[2].ends_with(" service-host"),
            "{calls:?}"
        );
        drop(calls);

        let reg_output: &'static str = Box::leak(
            format!(
                "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n    \
                 ai-memory    REG_SZ    {}\r\n\r\n",
                unit.contents
            )
            .into_boxed_str(),
        );
        let current = FakeRunner {
            stdout: vec![("reg query", reg_output)],
            ..FakeRunner::default()
        };
        assert_eq!(install(&unit, &current).unwrap(), ServiceChange::Started);
        assert!(
            !current
                .calls
                .borrow()
                .iter()
                .any(|c| c.starts_with("reg add")),
            "a current entry is not rewritten: {:?}",
            current.calls.borrow()
        );
        assert!(unit.exists(&current));
        assert!(!unit.exists(&fresh));
    }

    /// `reg add` failing stops the install before the host is started.
    #[test]
    fn a_refused_registry_write_starts_no_host() {
        let root = tempfile::tempdir().unwrap();
        let unit = render(ServiceManager::WindowsRun, &spec(root.path())).unwrap();
        let runner = FakeRunner {
            failing: vec!["reg query", "reg add"],
            ..FakeRunner::default()
        };
        let error = install(&unit, &runner).unwrap_err().to_string();
        assert!(error.contains("reg add"), "{error}");
        assert_eq!(runner.calls.borrow().len(), 2);
    }

    /// Uninstall removes only the entry `setup` wrote for this data dir;
    /// another install's entry, someone else's value under the same name, and
    /// an absent one are all left alone.
    #[test]
    fn uninstall_removes_only_setups_logon_entry() {
        let root = tempfile::tempdir().unwrap();
        let path = unit_path(ServiceManager::WindowsRun, root.path(), None);
        let data_dir = Path::new(r"C:\d");
        let entry = "    ai-memory    REG_SZ    \"C:\\x\\ai-memory.exe\" --data-dir \"C:\\d\" \
                     --config \"C:\\d\\config.toml\" service-host\r\n";
        let ours = FakeRunner {
            stdout: vec![("reg query", entry)],
            ..FakeRunner::default()
        };
        assert_eq!(
            remove(ServiceManager::WindowsRun, &path, data_dir, &ours).unwrap(),
            Removal::Removed(path.clone())
        );

        let other_install = FakeRunner {
            stdout: vec![("reg query", entry)],
            ..FakeRunner::default()
        };
        assert_eq!(
            remove(
                ServiceManager::WindowsRun,
                &path,
                root.path(),
                &other_install
            )
            .unwrap(),
            Removal::NotOurs(path.clone())
        );
        assert_eq!(
            other_install.calls.borrow().len(),
            1,
            "only the query ran: {:?}",
            other_install.calls.borrow()
        );

        // Windows reads this data dir as `C:\d\other`: another install's.
        let past_the_quote = FakeRunner {
            stdout: vec![(
                "reg query",
                "    ai-memory    REG_SZ    \"C:\\x\\ai-memory.exe\" --data-dir \"C:\\d\"\\other \
                 --config \"C:\\d\\config.toml\" service-host\r\n",
            )],
            ..FakeRunner::default()
        };
        assert_eq!(
            remove(ServiceManager::WindowsRun, &path, data_dir, &past_the_quote).unwrap(),
            Removal::NotOurs(path.clone())
        );
        assert_eq!(past_the_quote.calls.borrow().len(), 1, "only the query ran");

        // `C:` is the current directory on drive C, not the root being
        // uninstalled: nothing is stopped or deleted.
        let drive_relative = FakeRunner {
            stdout: vec![(
                "reg query",
                "    ai-memory    REG_SZ    \"C:\\x\\ai-memory.exe\" --data-dir \"C:\" \
                 --config \"C:\\other\\config.toml\" service-host\r\n",
            )],
            ..FakeRunner::default()
        };
        assert_eq!(
            remove(
                ServiceManager::WindowsRun,
                &path,
                Path::new(r"C:\"),
                &drive_relative
            )
            .unwrap(),
            Removal::NotOurs(path.clone())
        );
        assert_eq!(drive_relative.calls.borrow().len(), 1, "only the query ran");

        // A volume GUID data dir removes its own entry and leaves another
        // volume's alone.
        let volume_entry = "    ai-memory    REG_SZ    \"C:\\x\\ai-memory.exe\" --data-dir \
             \"\\\\?\\Volume{01234567-89ab-cdef-0123-456789abcdef}\\ai-memory\" \
             --config \"C:\\c.toml\" service-host\r\n";
        let other_volume = FakeRunner {
            stdout: vec![("reg query", volume_entry)],
            ..FakeRunner::default()
        };
        assert_eq!(
            remove(
                ServiceManager::WindowsRun,
                &path,
                Path::new(r"\\?\Volume{fedcba98-7654-3210-fedc-ba9876543210}\ai-memory"),
                &other_volume
            )
            .unwrap(),
            Removal::NotOurs(path.clone())
        );
        assert_eq!(other_volume.calls.borrow().len(), 1, "only the query ran");
        let own_volume = FakeRunner {
            stdout: vec![("reg query", volume_entry)],
            ..FakeRunner::default()
        };
        assert_eq!(
            remove(
                ServiceManager::WindowsRun,
                &path,
                Path::new(r"\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}\ai-memory"),
                &own_volume
            )
            .unwrap(),
            Removal::Removed(path.clone())
        );
        assert!(
            ours.calls
                .borrow()
                .iter()
                .any(|c| c == &format!("reg delete {RUN_KEY} /v ai-memory /f")),
            "{:?}",
            ours.calls.borrow()
        );

        let theirs = FakeRunner {
            stdout: vec![(
                "reg query",
                "    ai-memory    REG_SZ    \"C:\\tools\\other.exe\" --start\r\n",
            )],
            ..FakeRunner::default()
        };
        assert_eq!(
            remove(ServiceManager::WindowsRun, &path, root.path(), &theirs).unwrap(),
            Removal::NotOurs(path.clone())
        );
        assert_eq!(theirs.calls.borrow().len(), 1, "only the query ran");

        let absent = FakeRunner {
            failing: vec!["reg query"],
            ..FakeRunner::default()
        };
        assert_eq!(
            remove(ServiceManager::WindowsRun, &path, root.path(), &absent).unwrap(),
            Removal::Absent
        );
    }
}

/// The Windows command-line pieces are plain text handling; they run on every
/// platform.
#[cfg(test)]
mod windows_entry_tests {
    use super::*;

    #[test]
    fn windows_args_are_quoted_so_argv_parsing_reads_them_back() {
        assert_eq!(
            windows_arg("data dir", r"C:\Users\me\AppData\Local\ai-memory").unwrap(),
            r#""C:\Users\me\AppData\Local\ai-memory""#
        );
        // A trailing backslash would otherwise escape the closing quote.
        assert_eq!(windows_arg("data dir", r"D:\").unwrap(), r#""D:\\""#);
        assert_eq!(
            windows_arg("data dir", r"C:\with space\dir").unwrap(),
            r#""C:\with space\dir""#
        );
        assert!(windows_arg("data dir", r#"C:\a"b"#).is_err());
    }

    /// The data dir comes back out of an entry exactly as `windows_arg` put
    /// it in, trailing backslashes included.
    #[test]
    fn the_entry_names_its_data_dir() {
        for dir in [
            r"C:\Users\me\AppData\Local\ai-memory",
            r"D:\",
            r"C:\with space\d",
        ] {
            let entry = format!(
                "{} --data-dir {} --config {} {SERVICE_HOST}",
                windows_arg("binary", r"C:\bin\ai-memory.exe").unwrap(),
                windows_arg("data dir", dir).unwrap(),
                windows_arg("config", r"C:\c.toml").unwrap(),
            );
            assert_eq!(run_entry_data_dir(&entry).as_deref(), Some(dir), "{entry}");
        }
        assert_eq!(
            run_entry_data_dir(r#""C:\bin\ai-memory.exe" service-host"#),
            None
        );
    }

    #[test]
    fn data_dirs_compare_without_prefix_case_or_trailing_separator() {
        assert!(same_windows_dir(
            r"\\?\C:\Users\Me\AppData\Local\ai-memory",
            r"c:\users\me\appdata\local\ai-memory\"
        ));
        assert!(!same_windows_dir(r"C:\a\ai-memory", r"C:\b\ai-memory"));
        assert!(!same_windows_dir(r"C:\ai-memory", r"C:\ai-memory-test"));
        // A verbatim UNC path names the same share as its plain spelling.
        assert!(same_windows_dir(
            r"\\?\UNC\server\share\ai-memory",
            r"\\server\share\ai-memory\"
        ));
        assert!(!same_windows_dir(
            r"\\?\UNC\server\share\ai-memory",
            r"\\server\other\ai-memory"
        ));
        // `C:` is the current directory on drive C, not its root.
        assert!(!same_windows_dir("C:", r"\\?\C:\"));
        assert!(!same_windows_dir("C:", "C:"));
        assert!(!same_windows_dir(r"ai-memory", r"ai-memory"));
        assert!(same_windows_dir(r"C:\", r"\\?\C:\"));
        // A volume GUID path is absolute and matches itself, not another
        // volume; a malformed one matches nothing.
        let volume = r"\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}\ai-memory";
        assert!(same_windows_dir(
            volume,
            &format!(r"{}\", volume.to_uppercase())
        ));
        assert!(!same_windows_dir(
            volume,
            r"\\?\Volume{fedcba98-7654-3210-fedc-ba9876543210}\ai-memory"
        ));
        assert!(!same_windows_dir(
            r"\\?\Volume{}\ai-memory",
            r"\\?\Volume{}\ai-memory"
        ));
        assert!(!same_windows_dir(r"\\?\Volume{x", r"\\?\Volume{x"));
    }

    /// The entry `setup` renders for a volume GUID data dir is that
    /// install's, and not another volume's.
    #[test]
    fn a_volume_guid_data_dir_owns_its_entry() {
        let dir = r"\\?\Volume{01234567-89ab-cdef-0123-456789abcdef}\ai-memory";
        let entry = format!(
            "{} --data-dir {} --config {} {SERVICE_HOST}",
            windows_arg("binary", r"C:\bin\ai-memory.exe").unwrap(),
            windows_arg("data dir", dir).unwrap(),
            windows_arg("config", r"C:\c.toml").unwrap(),
        );
        assert!(is_setup_run_entry_for(&entry, Path::new(dir)), "{entry}");
        assert!(!is_setup_run_entry_for(
            &entry,
            Path::new(r"\\?\Volume{fedcba98-7654-3210-fedc-ba9876543210}\ai-memory")
        ));
    }

    /// A drive-relative `--data-dir "C:"` names the current directory on C,
    /// so uninstalling the drive root must not claim it.
    #[test]
    fn a_drive_relative_data_dir_is_not_the_drive_root() {
        let root = Path::new(r"C:\");
        let foreign = r#""C:\bin\ai-memory.exe" --data-dir "C:" --config "C:\other\config.toml" service-host"#;
        assert!(!is_setup_run_entry_for(foreign, root));
        assert!(!is_setup_run_entry_for(foreign, Path::new(r"\\?\C:\")));
        // Control: the entry `setup` renders for the drive root is ours.
        let ours = format!(
            "{} --data-dir {} --config {} {SERVICE_HOST}",
            windows_arg("binary", r"C:\bin\ai-memory.exe").unwrap(),
            windows_arg("data dir", r"C:\").unwrap(),
            windows_arg("config", r"C:\config.toml").unwrap(),
        );
        assert!(is_setup_run_entry_for(&ours, root), "{ours}");
    }

    /// A `--data-dir` inside the executable's path is not the option.
    #[test]
    fn the_data_dir_is_read_after_the_executable() {
        let entry = format!(
            "{} --data-dir {} --config {} {SERVICE_HOST}",
            windows_arg("binary", r"C:\tools --data-dir bin\ai-memory.exe").unwrap(),
            windows_arg("data dir", r"C:\Users\me\AppData\Local\ai-memory").unwrap(),
            windows_arg("config", r"C:\c.toml").unwrap(),
        );
        assert_eq!(
            run_entry_data_dir(&entry).as_deref(),
            Some(r"C:\Users\me\AppData\Local\ai-memory")
        );
        assert!(is_setup_run_entry_for(
            &entry,
            Path::new(r"C:\Users\me\AppData\Local\ai-memory")
        ));
    }

    /// A data dir argument that does not end at its closing quote names a
    /// different directory to Windows: `"C:\d"\other` is `C:\d\other`, and
    /// `"C:\d\" …"` escapes the quote. Neither may claim `C:\d`'s entry.
    #[test]
    fn a_data_dir_that_runs_past_its_quote_is_not_ours() {
        let data_dir = Path::new(r"C:\d");
        for entry in [
            r#""C:\bin\ai-memory.exe" --data-dir "C:\d"\other --config "C:\c.toml" service-host"#,
            r#""C:\bin\ai-memory.exe" --data-dir "C:\d"x --config "C:\c.toml" service-host"#,
            r#""C:\bin\ai-memory.exe" --data-dir "C:\d\" --config "C:\c.toml" service-host"#,
        ] {
            assert!(!is_setup_run_entry_for(entry, data_dir), "{entry}");
        }
        // Control: the entry `setup` renders for `C:\d` is ours.
        let ours = format!(
            "{} --data-dir {} --config {} {SERVICE_HOST}",
            windows_arg("binary", r"C:\bin\ai-memory.exe").unwrap(),
            windows_arg("data dir", r"C:\d").unwrap(),
            windows_arg("config", r"C:\c.toml").unwrap(),
        );
        assert!(is_setup_run_entry_for(&ours, data_dir), "{ours}");
    }

    /// The test that found this: an `uninstall` run against a temporary data
    /// dir removed the developer's own logon entry, because every entry with
    /// `setup`'s shape counted as ours.
    #[test]
    fn only_the_entry_for_this_data_dir_is_ours() {
        let entry = r#""C:\bin\ai-memory.exe" --data-dir "\\?\C:\Users\me\AppData\Local\ai-memory" --config "C:\c.toml" service-host"#;
        assert!(is_setup_run_entry_for(
            entry,
            Path::new(r"C:\Users\me\AppData\Local\ai-memory")
        ));
        assert!(!is_setup_run_entry_for(
            entry,
            Path::new(r"C:\Users\me\AppData\Local\Temp\.tmpAbC123\data")
        ));
        assert!(!is_setup_run_entry_for(
            r#""C:\bin\ai-memory.exe" service-host"#,
            Path::new(r"C:\Users\me\AppData\Local\ai-memory")
        ));
    }

    #[test]
    fn reg_query_output_yields_the_value_data() {
        let out = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n    \
                   ai-memory    REG_SZ    \"C:\\a b\\ai-memory.exe\" --data-dir \"C:\\d\" service-host\r\n\r\n";
        assert_eq!(
            parse_reg_query(out, "ai-memory").as_deref(),
            Some("\"C:\\a b\\ai-memory.exe\" --data-dir \"C:\\d\" service-host")
        );
        assert_eq!(
            parse_reg_query("    other    REG_SZ    x\r\n", "ai-memory"),
            None
        );
        assert_eq!(
            parse_reg_query("    ai-memory    REG_EXPAND_SZ    x\r\n", "ai-memory"),
            None
        );
    }

    /// Only a quoted `ai-memory.exe` ending in `service-host` is ours; a
    /// value pointing elsewhere, an unquoted one, or one chaining another
    /// command is not, and uninstall leaves it.
    #[test]
    fn only_setups_entry_shape_counts_as_ours() {
        assert!(is_setup_run_entry(
            r#""C:\x\ai-memory.exe" --data-dir "C:\d" --config "C:\d\c.toml" service-host"#
        ));
        assert!(is_setup_run_entry(r#""C:\X\AI-MEMORY.EXE" service-host"#));
        for theirs in [
            r#""C:\x\other.exe" service-host"#,
            r#"C:\x\ai-memory.exe service-host"#,
            r#""C:\x\ai-memory.exe" serve"#,
            r#""C:\x\ai-memory.exe" service-host & calc"#,
            r#""C:\x\ai-memory.exe" x | y service-host"#,
            "",
        ] {
            assert!(!is_setup_run_entry(theirs), "{theirs}");
        }
    }

    /// A canonical `\\?\` install path is written as a plain path (#1280).
    #[test]
    fn the_rendered_entry_writes_plain_paths() {
        if !cfg!(windows) {
            return;
        }
        let spec = ServiceSpec {
            exe: PathBuf::from(r"\\?\C:\Users\me\ai\ai-memory.exe"),
            data_dir: PathBuf::from(r"\\?\C:\Users\me\AppData\Local\ai-memory"),
            config_path: PathBuf::from(r"\\?\C:\Users\me\AppData\Local\ai-memory\config.toml"),
            home: PathBuf::from(r"C:\Users\me"),
            xdg_config_home: None,
        };
        let unit = render(ServiceManager::WindowsRun, &spec).unwrap();
        assert!(!unit.contents.contains(r"\\?\"), "{}", unit.contents);
        assert!(
            unit.contents.starts_with(
                r#""C:\Users\me\ai\ai-memory.exe" --data-dir "C:\Users\me\AppData\Local\ai-memory""#
            ),
            "{}",
            unit.contents
        );
        // `setup` starts the host with this command line too, and the
        // verbatim program path showed up in an EDR's process tree there.
        let host = unit.host.unwrap();
        assert_eq!(host.exe, PathBuf::from(r"C:\Users\me\ai\ai-memory.exe"));
        assert!(
            host.args.iter().all(|arg| !arg.contains(r"\\?\")),
            "{:?}",
            host.args
        );
    }

    /// The rendered entry is one setup recognises as its own, names the
    /// install's data dir and config, and its host command matches it.
    #[test]
    fn the_rendered_entry_is_recognised_as_setups() {
        let root = std::env::temp_dir().join("ai-memory-entry-test");
        let spec = ServiceSpec {
            exe: root.join("ai-memory.exe"),
            data_dir: root.join("data"),
            config_path: root.join("data").join("config.toml"),
            home: root.clone(),
            xdg_config_home: None,
        };
        let unit = render(ServiceManager::WindowsRun, &spec).unwrap();
        assert!(is_setup_run_entry(&unit.contents), "{}", unit.contents);
        assert!(
            unit.contents
                .contains(&format!("--data-dir \"{}\"", spec.data_dir.display()))
        );
        let host = unit.host.unwrap();
        assert_eq!(host.args.last().map(String::as_str), Some("service-host"));
        assert_eq!(
            host.state_file,
            super::super::service_host::state_file(&spec.data_dir)
        );
    }
}

/// The registry calls the logon entry goes through, against a throwaway key:
/// the real `Run` key is never touched.
#[cfg(all(test, windows))]
mod user_registry_tests {
    use super::user_registry;

    #[test]
    fn a_value_round_trips_and_deleting_it_leaves_nothing() {
        let subkey = format!(r"Software\ai-memory-tests\{}", uuid::Uuid::new_v4());
        let data = r#""C:\Program Files\ai memory\ai-memory.exe" --data-dir "C:\d\\" service-host"#;
        assert_eq!(user_registry::get(&subkey, "ai-memory"), None);

        user_registry::set(&subkey, "ai-memory", data).unwrap();
        assert_eq!(
            user_registry::get(&subkey, "ai-memory").as_deref(),
            Some(data)
        );

        user_registry::delete(&subkey, "ai-memory").unwrap();
        assert_eq!(user_registry::get(&subkey, "ai-memory"), None);
        windows_registry::CURRENT_USER.remove_tree(&subkey).unwrap();
    }

    /// `setup` writes `REG_SZ`; an expandable string under the same name was
    /// put there by someone else and must not read as `setup`'s entry, or
    /// `uninstall` would delete it.
    #[test]
    fn only_a_plain_string_value_is_read() {
        let subkey = format!(r"Software\ai-memory-tests\{}", uuid::Uuid::new_v4());
        let data =
            r#""C:\bin\ai-memory.exe" --data-dir "C:\d" --config "C:\d\config.toml" service-host"#;
        let key = windows_registry::CURRENT_USER.create(&subkey).unwrap();

        key.set_expand_string("ai-memory", data).unwrap();
        assert_eq!(user_registry::get(&subkey, "ai-memory"), None);

        // Control: the same data as REG_SZ is read.
        key.set_string("ai-memory", data).unwrap();
        assert_eq!(
            user_registry::get(&subkey, "ai-memory").as_deref(),
            Some(data)
        );
        windows_registry::CURRENT_USER.remove_tree(&subkey).unwrap();
    }

    /// The entry `render` writes for an install is recognised as that
    /// install's, even when the executable's own path holds ` --data-dir `.
    #[test]
    fn a_rendered_entry_belongs_to_its_own_data_dir() {
        let data_dir = std::path::PathBuf::from(r"C:\Users\me\AppData\Local\ai-memory");
        let spec = super::ServiceSpec {
            exe: r"C:\tools --data-dir bin\ai-memory.exe".into(),
            data_dir: data_dir.clone(),
            config_path: data_dir.join("config.toml"),
            home: r"C:\Users\me".into(),
            xdg_config_home: None,
        };
        let unit = super::render(super::ServiceManager::WindowsRun, &spec).unwrap();
        assert!(super::is_setup_run_entry_for(&unit.contents, &data_dir));
        assert!(!super::is_setup_run_entry_for(
            &unit.contents,
            std::path::Path::new(r"C:\tools")
        ));
    }
}

// Pure string and injected-runner checks, so they run on every platform.
#[cfg(test)]
mod logon_binary_tests {
    use super::*;

    /// A runner whose `Run` value is fixed and which never runs anything.
    struct FixedRunValue(Option<String>);

    impl CommandRunner for FixedRunValue {
        fn run(&self, program: &str, _args: &[&str]) -> Result<CommandOutcome> {
            bail!("{program} must not run in this test")
        }

        fn run_key_value(&self) -> Option<String> {
            self.0.clone()
        }
    }

    const DATA_DIR: &str = r"C:\Users\me\AppData\Local\ai-memory";
    const EXE: &str = r"C:\Users\me\AppData\Local\Programs\ai-memory\ai-memory.exe";

    fn entry(exe: &str, data_dir: &str) -> String {
        format!(r#""{exe}" --data-dir "{data_dir}" --config "{data_dir}\config.toml" service-host"#)
    }

    fn check(value: Option<String>, present: bool) -> Option<MissingLogonBinary> {
        missing_logon_binary(&FixedRunValue(value), Path::new(DATA_DIR), &|_| present)
    }

    #[test]
    fn a_quarantined_binary_in_this_data_dirs_entry_is_reported() {
        let problem = check(Some(entry(EXE, DATA_DIR)), false).expect("binary is gone");
        assert_eq!(problem.classification, LOGON_BINARY_MISSING);
        assert_eq!(problem.executable, EXE);
        assert!(problem.detail.contains(EXE), "{}", problem.detail);
        assert!(problem.detail.contains("quarantined"), "{}", problem.detail);

        let json = serde_json::to_value(&problem).unwrap();
        assert_eq!(json["classification"], LOGON_BINARY_MISSING);
        assert_eq!(json["executable"], EXE);
        assert_eq!(json["fix"], problem.fix);
    }

    #[test]
    fn the_executable_is_the_one_the_is_file_check_sees() {
        let seen = std::cell::RefCell::new(Vec::new());
        let value = entry(r"\\?\C:\Program Files\ai memory\ai-memory.exe", DATA_DIR);
        let problem =
            missing_logon_binary(&FixedRunValue(Some(value)), Path::new(DATA_DIR), &|path| {
                seen.borrow_mut().push(path.to_path_buf());
                false
            })
            .expect("binary is gone");
        assert_eq!(
            seen.into_inner(),
            vec![PathBuf::from(
                r"\\?\C:\Program Files\ai memory\ai-memory.exe"
            )]
        );
        assert_eq!(
            problem.executable,
            r"\\?\C:\Program Files\ai memory\ai-memory.exe"
        );
    }

    #[test]
    fn a_present_binary_or_no_entry_says_nothing() {
        assert_eq!(check(Some(entry(EXE, DATA_DIR)), true), None);
        assert_eq!(check(None, false), None);
    }

    #[test]
    fn only_setups_entry_for_this_data_dir_counts() {
        let cases = [
            entry(EXE, r"D:\another\data-dir"),
            format!(r#""C:\x\other.exe" --data-dir "{DATA_DIR}" service-host"#),
            format!(r#""{EXE}" --data-dir "{DATA_DIR}" serve"#),
            format!(r#""{EXE}" --data-dir "{DATA_DIR}" x & calc service-host"#),
            format!(r#"{EXE} --data-dir "{DATA_DIR}" service-host"#),
        ];
        for value in cases {
            assert_eq!(check(Some(value.clone()), false), None, "{value}");
        }
    }

    /// The hint must point at commands that remove or repair the entry;
    /// `setup --no-service` leaves an existing entry in place.
    #[test]
    fn the_fix_names_commands_that_act_on_the_entry() {
        let human = check(Some(entry(EXE, DATA_DIR)), false)
            .unwrap()
            .render_human();
        for needle in [
            LOGON_BINARY_MISSING,
            "re-run `ai-memory setup`",
            "`ai-memory uninstall --apply`",
            r"Remove-ItemProperty -Path HKCU:\Software\Microsoft\Windows\CurrentVersion\Run -Name ai-memory",
            "Antivirus / EDR",
        ] {
            assert!(human.contains(needle), "missing {needle:?} in {human}");
        }
        assert!(!human.contains("--no-service"), "{human}");
    }

    #[cfg(not(windows))]
    #[test]
    fn the_live_check_is_quiet_off_windows() {
        assert_eq!(check_logon_binary(Path::new(DATA_DIR)), None);
    }
}
