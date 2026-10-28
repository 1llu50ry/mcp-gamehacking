//! Which tokio runtime flavor a command needs.
//!
//! A hook event is a one-shot call that usually finishes in a few
//! milliseconds, and the agent bundles spawn it once per event: a
//! `PreToolUse` on every tool call, a prompt-submit on every prompt. Building
//! the binary's default multi-thread runtime starts one worker thread per
//! CPU before the command does any work, so on a 32-core machine every hook
//! call pays to spawn and join 32 threads to run one HTTP request. A
//! single-threaded runtime runs the same future with no worker pool at all.
//!
//! Everything else keeps the multi-threaded runtime: `serve` accepts
//! connections, `run` supervises a child process and its hooks, and the MCP
//! stdio bridge reads stdin on one task while it answers on another.

/// The runtime a subcommand should run on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeFlavor {
    /// One thread, no worker pool. For the hook path.
    CurrentThread,
    /// The default pool, one worker per CPU.
    MultiThread,
}

/// Global options that take a value and may precede the subcommand.
const VALUE_GLOBAL_FLAGS: [&str; 2] = ["--data-dir", "--config"];

impl RuntimeFlavor {
    /// The flavor for `command`, the subcommand name as clap spells it.
    ///
    /// Only `hook` and `hook-drain` are single-threaded. Both are spawned on
    /// an agent's hot path and answer one request, or drain one spool, before
    /// exiting.
    #[must_use]
    pub fn for_command(command: Option<&str>) -> Self {
        match command {
            Some("hook") | Some("hook-drain") => Self::CurrentThread,
            _ => Self::MultiThread,
        }
    }

    /// The flavor for a full `argv`, including `argv[0]`.
    ///
    /// The subcommand is the first argument that is not a global option or a
    /// global option's value, which is all this needs to know before clap has
    /// parsed anything. Anything unrecognized keeps the default: a wrong guess
    /// toward [`Self::MultiThread`] costs threads, a wrong guess toward
    /// [`Self::CurrentThread`] could starve a long-running command, so the
    /// bias is deliberate.
    #[must_use]
    pub fn for_argv(argv: &[String]) -> Self {
        let mut skip_value = false;
        for arg in argv.iter().skip(1) {
            if skip_value {
                skip_value = false;
                continue;
            }
            if let Some((flag, _)) = arg.split_once('=')
                && VALUE_GLOBAL_FLAGS.contains(&flag)
            {
                continue;
            }
            if VALUE_GLOBAL_FLAGS.contains(&arg.as_str()) {
                skip_value = true;
                continue;
            }
            if arg.starts_with('-') {
                continue;
            }
            return Self::for_command(Some(arg));
        }
        Self::MultiThread
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(args: &[&str]) -> Vec<String> {
        std::iter::once("ai-memory")
            .chain(args.iter().copied())
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn hook_commands_run_on_one_thread() {
        assert_eq!(
            RuntimeFlavor::for_command(Some("hook")),
            RuntimeFlavor::CurrentThread
        );
        assert_eq!(
            RuntimeFlavor::for_command(Some("hook-drain")),
            RuntimeFlavor::CurrentThread
        );
    }

    /// The controls: a command that owns a listener, a child process, or a
    /// stdin reader keeps the pool, as does a bare `ai-memory`.
    #[test]
    fn everything_else_keeps_the_pool() {
        for command in [
            None,
            Some("serve"),
            Some("run"),
            Some("mcp-bridge"),
            Some("status"),
            Some("hook-spool"),
        ] {
            assert_eq!(
                RuntimeFlavor::for_command(command),
                RuntimeFlavor::MultiThread,
                "{command:?}"
            );
        }
    }

    #[test]
    fn argv_finds_the_subcommand_after_the_global_options() {
        assert_eq!(
            RuntimeFlavor::for_argv(&argv(&["hook", "claude-code", "pre-tool-use"])),
            RuntimeFlavor::CurrentThread
        );
        assert_eq!(
            RuntimeFlavor::for_argv(&argv(&["--data-dir", "hook", "hook", "claude-code"])),
            RuntimeFlavor::CurrentThread,
            "a data dir named like the subcommand is a value, not the command"
        );
        assert_eq!(
            RuntimeFlavor::for_argv(&argv(&[
                "--data-dir=/tmp/x",
                "--config",
                "/tmp/config.toml",
                "hook-drain"
            ])),
            RuntimeFlavor::CurrentThread
        );
        assert_eq!(
            RuntimeFlavor::for_argv(&argv(&["--config", "/tmp/c.toml", "serve"])),
            RuntimeFlavor::MultiThread
        );
        assert_eq!(
            RuntimeFlavor::for_argv(&argv(&[])),
            RuntimeFlavor::MultiThread,
            "no subcommand (help, version) keeps the default"
        );
        assert_eq!(
            RuntimeFlavor::for_argv(&argv(&["--version"])),
            RuntimeFlavor::MultiThread
        );
    }
}
