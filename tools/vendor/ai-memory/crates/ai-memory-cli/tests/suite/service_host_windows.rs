//! `ai-memory service-host` on Windows, through the shipped binary: the
//! launcher returns at once, the detached supervisor starts the server and
//! records both pids, a killed server is started again, and a stop request
//! ends both. Everything lives in a temp data dir on a free port; the
//! registry is never touched (that is
//! `setup`'s step, covered with a recording runner in the unit tests).

#![cfg(windows)]

use std::io::{Read as _, Write as _};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use crate::e2e_support::{free_port, hermetic};

const BIN: &str = env!("CARGO_BIN_EXE_ai-memory");

#[derive(serde::Deserialize)]
struct HostState {
    supervisor_pid: u32,
    server_pid: Option<u32>,
}

fn read_state(path: &Path) -> Option<HostState> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// Kill whatever the host recorded when the test ends, pass or fail.
struct HostGuard(PathBuf);
impl Drop for HostGuard {
    fn drop(&mut self) {
        if let Some(state) = read_state(&self.0) {
            for pid in std::iter::once(state.supervisor_pid).chain(state.server_pid) {
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
        }
    }
}

fn healthz(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok();
    if stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut answer = String::new();
    stream.read_to_string(&mut answer).ok();
    answer.starts_with("HTTP/1.1 200")
}

fn wait_for(what: &str, timeout: Duration, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + timeout;
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// The restart waits out the host's delay: the slow tier.
mod slow {
    use super::*;

    #[test]
    fn service_host_runs_the_server_and_restarts_it_after_it_is_killed() {
        let tmp = tempfile::tempdir().unwrap();
        let data_dir = tmp.path().join("data");
        let config = data_dir.join("config.toml");
        let port = free_port();
        let command = |args: &[&str]| {
            let mut cmd = hermetic(BIN);
            cmd.arg("--data-dir")
                .arg(&data_dir)
                .arg("--config")
                .arg(&config)
                .args(args)
                .env("AI_MEMORY_BIND", format!("127.0.0.1:{port}"))
                .env("AI_MEMORY_SERVER_URL", format!("http://127.0.0.1:{port}"))
                .env("AI_MEMORY_EMBEDDING_PROVIDER", "none")
                .env("AI_MEMORY_BACKFILL_ON_START", "false")
                .env("AI_MEMORY_AUTO_IMPROVE__SCHEDULER__ENABLED", "false")
                .env("RUST_LOG", "off")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            cmd
        };
        assert!(command(&["init"]).status().unwrap().success());

        let state_file = data_dir.join("service-host.json");
        let _guard = HostGuard(state_file.clone());
        let started = Instant::now();
        assert!(command(&["service-host"]).status().unwrap().success());
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "the launcher must return without waiting for the server"
        );

        wait_for("the server to answer", Duration::from_secs(60), || {
            healthz(port)
        });
        let first = read_state(&state_file).expect("the host records its state");
        let first_server = first.server_pid.expect("the host records the server pid");
        assert_ne!(first.supervisor_pid, first_server);

        // A second launch while the host runs starts no second supervisor.
        assert!(command(&["service-host"]).status().unwrap().success());
        std::thread::sleep(Duration::from_secs(2));
        assert_eq!(
            read_state(&state_file).map(|state| state.supervisor_pid),
            Some(first.supervisor_pid)
        );

        assert!(
            std::process::Command::new("taskkill")
                .args(["/PID", &first_server.to_string(), "/F"])
                .status()
                .unwrap()
                .success()
        );
        wait_for("a restarted server", Duration::from_secs(60), || {
            read_state(&state_file)
                .and_then(|state| state.server_pid)
                .is_some_and(|pid| pid != first_server)
                && healthz(port)
        });

        // The stop request `uninstall` and `setup` write: the supervisor kills
        // its server through the handle it owns and exits, with no taskkill.
        let host = read_state(&state_file).expect("the restarted host's state");
        let server = host.server_pid.expect("the restarted server's pid");
        std::fs::write(data_dir.join("service-host.stop"), b"").unwrap();
        wait_for("the host to stop", Duration::from_secs(20), || {
            !alive(host.supervisor_pid) && !alive(server)
        });
        assert!(!healthz(port));
        assert!(
            !state_file.exists(),
            "the supervisor removes its state on the way out"
        );
    }
}

fn alive(pid: u32) -> bool {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
    let pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::new(),
    );
    system.process(pid).is_some()
}
