//! `serve --transport stdio` must stop when the operator interrupts it (#699),
//! and any stop of `serve` must leave the SQLite WAL checkpointed.

/// Startup, one interrupt and one shutdown: seconds, not milliseconds.
#[cfg(unix)]
mod slow {
    use std::io::{BufRead, BufReader};
    use std::process::{Child, Command, Stdio};
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant};

    const BIN: &str = env!("CARGO_BIN_EXE_ai-memory");
    /// Logged by `start_watcher` when `serve --no-watcher` is honoured.
    const WATCHER_DISABLED: &str = "watcher disabled by --no-watcher";
    /// Logged by `start_watcher` when it actually installs an FSEvents/inotify
    /// instance. Must not appear here: this test does not exercise watching.
    const WATCHER_STARTED: &str = "starting wiki watcher";

    fn wait_for_exit(child: &mut Child, budget: Duration) -> Option<std::process::ExitStatus> {
        let deadline = Instant::now() + budget;
        while Instant::now() < deadline {
            match child.try_wait().expect("try_wait") {
                Some(status) => return Some(status),
                None => thread::sleep(Duration::from_millis(100)),
            }
        }
        None
    }

    /// A stdio server must shut down when it is interrupted, even when the
    /// disposition it inherited would discard the signal.
    ///
    /// What this covers: that `serve` installs a signal handler instead of
    /// relying on the default disposition, that it does so *before* the MCP
    /// `initialize` handshake (a server started by hand has no client writing
    /// to stdin and never gets past `serve()`), and that observing the
    /// interrupt actually ends the process rather than parking on runtime
    /// shutdown behind the uncancellable blocking read of stdin.
    ///
    /// What it does not cover: the reported environment itself. #699 is the
    /// container entrypoint running this binary as PID 1, where the kernel
    /// drops a default-disposition signal sent to a namespace's init. A test
    /// cannot portably become PID 1, so the child inherits `SIG_IGN` for
    /// SIGINT instead — `trap "" INT` before `exec`, which survives the exec.
    /// The mechanism that swallows the signal differs; the property under test
    /// is the same one that fixes both, and reverting the fix fails this test.
    #[test]
    fn stdio_serve_exits_when_interrupted() {
        let data_dir = tempfile::TempDir::new().expect("tempdir");

        let mut child = Command::new("sh")
            .arg("-c")
            // Explicit transport: the default is stdio today, and a test that
            // rides that default would quietly start testing something else if
            // it ever changed. `--no-watcher`: this test does not watch the
            // wiki; concurrent serve children can exhaust the machine-global
            // FSEvents/inotify instance (#745).
            .arg(r#"trap "" INT; exec "$1" serve --transport stdio --no-watcher"#)
            .arg("sh")
            .arg(BIN)
            .env("AI_MEMORY_DATA_DIR", data_dir.path())
            // Hermetic, the way the other two server-spawning suites already
            // are: the 2.0 embedder default would start a background model
            // download on this server, and an ambient RUST_LOG below info
            // would delete the very line this test waits a minute for.
            .env("AI_MEMORY_EMBEDDING_PROVIDER", "none")
            .env("RUST_LOG", "info")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn serve");

        // Hold stdin open: closing it is the other way this server stops, and
        // it would hide whether the interrupt was observed at all.
        let _stdin = child.stdin.take().expect("stdin");

        let stderr = child.stderr.take().expect("stderr");
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let ready = line.contains("ready on stdio");
                let _ = tx.send(line);
                if ready {
                    break;
                }
            }
        });

        let deadline = Instant::now() + Duration::from_secs(60);
        let mut ready = false;
        let mut startup = String::new();
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(line) => {
                    startup.push_str(&line);
                    startup.push('\n');
                    if line.contains("ready on stdio") {
                        ready = true;
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        assert!(ready, "server never reported it was ready on stdio");
        // Ready is logged after the watcher decision, so this buffer
        // includes that decision. None of this test watches the wiki;
        // the watcher is a machine-global FSEvents/inotify instance
        // concurrent children can exhaust (#745).
        assert!(
            startup.contains(WATCHER_DISABLED),
            "spawned serve must log that the watcher was opted out.\nstderr:\n{startup}"
        );
        assert!(
            !startup.contains(WATCHER_STARTED),
            "spawned serve must not install a wiki watcher.\nstderr:\n{startup}"
        );

        let killed = Command::new("kill")
            .args(["-INT", &child.id().to_string()])
            .status()
            .expect("send SIGINT");
        assert!(killed.success(), "kill -INT failed");

        let status = wait_for_exit(&mut child, Duration::from_secs(20));
        let Some(status) = status else {
            let _ = child.kill();
            panic!("serve was still running 20s after SIGINT");
        };
        assert!(
            status.success(),
            "an operator-requested stop should exit 0, got {status:?}"
        );
    }
}

/// `serve` ends the process without joining the store writer, so the WAL a
/// server grew used to be left whole for the next start to replay (a 17.8 GB
/// one, 9 minutes). These tests go through the real shutdown path of the built
/// binary, not `Store::close`, and prove `close_store` ran: another SQLite
/// handle stays open for the whole run, so the automatic checkpoint-and-delete
/// SQLite does when the *last* connection closes cannot be what empties the
/// `-wal`; only the explicit `wal_checkpoint(TRUNCATE)` can.
mod slow_close {
    use std::io::{BufRead, BufReader, Write};
    use std::path::PathBuf;
    use std::process::{Child, ChildStdin, Command, Stdio};
    use std::sync::mpsc::{self, Receiver};
    use std::thread::{self, JoinHandle};
    use std::time::{Duration, Instant};

    const BIN: &str = env!("CARGO_BIN_EXE_ai-memory");
    const READY_TIMEOUT: Duration = Duration::from_secs(60);
    const EXIT_TIMEOUT: Duration = Duration::from_secs(30);
    const FRAME_TIMEOUT: Duration = Duration::from_secs(10);

    struct Served {
        child: Child,
        stdin: Option<ChildStdin>,
        frames: Option<Receiver<String>>,
        stderr: Option<JoinHandle<String>>,
        wal: PathBuf,
        /// The handle that must outlive the server: see the module docs.
        bystander: Option<rusqlite::Connection>,
        data_dir: tempfile::TempDir,
    }

    fn pump<R: std::io::Read + Send + 'static>(
        reader: R,
        tx: mpsc::Sender<String>,
    ) -> JoinHandle<String> {
        thread::spawn(move || {
            let mut all = String::new();
            for line in BufReader::new(reader).lines().map_while(Result::ok) {
                all.push_str(&line);
                all.push('\n');
                if tx.send(line).is_err() {
                    break;
                }
            }
            all
        })
    }

    impl Served {
        /// Start `serve`, wait for its ready line, and (stdio) finish the MCP
        /// handshake, so the server is in the state a real harness leaves it
        /// in. Then open the bystander handle.
        fn start(transport: &str, ready: &str) -> Self {
            let data_dir = tempfile::TempDir::new().expect("tempdir for serve");
            let mut cmd = Command::new(BIN);
            cmd.args(["serve", "--transport", transport]);
            if transport == "http" {
                cmd.args(["--bind", "127.0.0.1:0"]);
            }
            cmd.arg("--no-watcher")
                .arg("--data-dir")
                .arg(data_dir.path())
                .env("AI_MEMORY_DATA_DIR", data_dir.path())
                .env("AI_MEMORY_EMBEDDING_PROVIDER", "none")
                .env("RUST_LOG", "info")
                .stdin(Stdio::piped())
                .stdout(if transport == "stdio" {
                    Stdio::piped()
                } else {
                    Stdio::null()
                })
                .stderr(Stdio::piped());
            let mut child = cmd.spawn().expect("spawn ai-memory serve");
            let stdin = child.stdin.take();
            let (err_tx, err_rx) = mpsc::channel();
            let stderr = pump(child.stderr.take().expect("stderr piped"), err_tx);
            let frames = child.stdout.take().map(|stdout| {
                let (tx, rx) = mpsc::channel();
                drop(pump(stdout, tx));
                rx
            });
            let wal = data_dir.path().join("db").join("memory.sqlite-wal");
            let mut served = Self {
                child,
                stdin,
                frames,
                stderr: Some(stderr),
                wal,
                bystander: None,
                data_dir,
            };

            let deadline = Instant::now() + READY_TIMEOUT;
            loop {
                let left = deadline.saturating_duration_since(Instant::now());
                match err_rx.recv_timeout(left) {
                    Ok(line) if line.contains(ready) => break,
                    Ok(_) => {}
                    Err(_) => panic!(
                        "serve never logged {ready:?}.\nstderr:\n{}",
                        served.finish_stderr()
                    ),
                }
            }
            if transport == "stdio" {
                served.handshake();
            }
            let db = served.data_dir.path().join("db").join("memory.sqlite");
            let conn = rusqlite::Connection::open(db).expect("open the bystander handle");
            conn.query_row("SELECT count(*) FROM pages", [], |r| r.get::<_, i64>(0))
                .expect("read through the bystander handle");
            served.bystander = Some(conn);
            served
        }

        /// `initialize`, `initialized`, then a `ping` the running service
        /// answers: only then is the stdio arm past its pre-client select, in
        /// the branch where end of input and signals both end up.
        fn handshake(&mut self) {
            const INITIALIZE: &str = concat!(
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"#,
                r#""protocolVersion":"2025-11-25","capabilities":{},"#,
                r#""clientInfo":{"name":"serve-close-test","version":"0"}}}"#,
                "\n",
            );
            const PING: &str = concat!(
                r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
                "\n",
                r#"{"jsonrpc":"2.0","id":2,"method":"ping"}"#,
                "\n",
            );
            let stdin = self.stdin.as_mut().expect("stdin piped");
            stdin
                .write_all(INITIALIZE.as_bytes())
                .expect("write initialize");
            stdin.flush().expect("flush initialize");
            self.next_frame();
            let stdin = self.stdin.as_mut().expect("stdin piped");
            stdin.write_all(PING.as_bytes()).expect("write ping");
            stdin.flush().expect("flush ping");
            let pong = self.next_frame();
            assert!(
                pong.contains(r#""id":2"#) && pong.contains(r#""result""#),
                "the ping must be answered by the running service: {pong}"
            );
        }

        fn next_frame(&mut self) -> String {
            let frame = self
                .frames
                .as_ref()
                .expect("stdout piped")
                .recv_timeout(FRAME_TIMEOUT);
            match frame {
                Ok(frame) => frame,
                Err(_) => panic!("no frame on stdout.\nstderr:\n{}", self.finish_stderr()),
            }
        }

        fn wal_len(&self) -> u64 {
            std::fs::metadata(&self.wal).map_or(0, |m| m.len())
        }

        fn finish_stderr(&mut self) -> String {
            let _ = self.child.kill();
            let _ = self.child.wait();
            self.stdin.take();
            self.stderr
                .take()
                .map(|pump| pump.join().unwrap_or_default())
                .unwrap_or_default()
        }

        /// Wait for the child's exit, then assert the stop was clean and the
        /// WAL was truncated while the bystander handle was still open.
        fn assert_stopped_with_the_wal_checkpointed(&mut self) {
            let deadline = Instant::now() + EXIT_TIMEOUT;
            let status = loop {
                match self.child.try_wait().expect("try_wait") {
                    Some(status) => break status,
                    None if Instant::now() >= deadline => {
                        panic!(
                            "serve still running after the stop.\nstderr:\n{}",
                            self.finish_stderr()
                        )
                    }
                    None => thread::sleep(Duration::from_millis(25)),
                }
            };
            let stderr = self.finish_stderr();
            assert!(
                status.success(),
                "a stop is a clean exit, got {status:?}\nstderr:\n{stderr}"
            );
            assert!(
                self.bystander.is_some(),
                "the bystander handle must still be open"
            );
            assert_eq!(
                self.wal_len(),
                0,
                "serve exited without checkpointing the WAL.\nstderr:\n{stderr}"
            );
            assert!(
                !stderr.contains("did not close within"),
                "the close hit its deadline.\nstderr:\n{stderr}"
            );
        }
    }

    impl Drop for Served {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    /// The stdio arm, ended by end of input after a real handshake: the route
    /// that runs on every platform, including Windows, which has no SIGTERM.
    /// The close sits after the arm's signal and EOF branches alike, so this
    /// covers `serve.rs`'s stdio `close_store` call.
    #[test]
    fn stdio_serve_checkpoints_the_wal_when_its_input_ends() {
        let mut served = Served::start("stdio", "MCP server ready on stdio");
        assert!(
            served.wal_len() > 0,
            "fixture: a running server has a WAL to truncate"
        );

        // End of input is how a harness that exits stops its stdio server.
        served.stdin.take();

        served.assert_stopped_with_the_wal_checkpointed();
    }

    /// The HTTP arm, ended by the signal `docker stop` and `systemctl stop`
    /// send. Unix only, like every signal test in this suite; it covers
    /// `serve.rs`'s HTTP `close_store` call, which no stdio route reaches.
    #[cfg(unix)]
    #[test]
    fn http_serve_checkpoints_the_wal_on_sigterm() {
        let mut served = Served::start("http", "MCP HTTP server ready");
        assert!(
            served.wal_len() > 0,
            "fixture: a running server has a WAL to truncate"
        );

        let killed = Command::new("kill")
            .args(["-TERM", &served.child.id().to_string()])
            .status()
            .expect("send SIGTERM");
        assert!(killed.success(), "kill -TERM failed");

        served.assert_stopped_with_the_wal_checkpointed();
    }
}
