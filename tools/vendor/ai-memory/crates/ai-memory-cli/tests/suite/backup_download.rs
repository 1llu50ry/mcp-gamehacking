//! Exercise archive download failures through the shipped CLI and a real HTTP connection.

use std::io::{Read as _, Write as _};
use std::net::{Shutdown, TcpListener};
use std::path::Path;
use std::process::Output;
use std::time::{Duration, Instant};

use super::e2e_support::hermetic;

const BIN: &str = env!("CARGO_BIN_EXE_ai-memory");
const BODY: &[u8] = b"complete archive bytes";

fn download(home: &Path, dest: &Path, export: bool, complete: bool) -> Output {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let server = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut socket = loop {
            match listener.accept() {
                Ok((socket, _)) => break socket,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "CLI never requested its archive");
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("accepting archive request: {error}"),
            }
        };
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            socket.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        let request = String::from_utf8(request).unwrap();
        assert!(
            request.starts_with(if export {
                "POST /admin/export-okf?"
            } else {
                "POST /admin/backup "
            }),
            "{request}"
        );
        let length = if complete {
            BODY.len()
        } else {
            BODY.len() + 100
        };
        let mut response =
            format!("HTTP/1.1 200 OK\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n")
                .into_bytes();
        response.extend_from_slice(BODY);
        socket.write_all(&response).unwrap();
        socket.shutdown(Shutdown::Write).unwrap();
    });
    let mut command = hermetic(BIN);
    command
        .current_dir(home)
        .env("HOME", home)
        .env("USERPROFILE", home)
        .env("AI_MEMORY_SERVER_URL", format!("http://{address}"))
        .arg("--data-dir")
        .arg(home.join("data"));
    if export {
        command.args(["export-okf", "--project", "archive-fixture"]);
    } else {
        command.arg("backup");
    }
    let output = command.arg("--to").arg(dest).output().unwrap();
    server.join().unwrap();
    output
}

#[test]
fn interrupted_archive_download_preserves_previous_output() {
    assert_interrupted_download(true);
}

#[test]
fn interrupted_archive_download_leaves_no_partial_output() {
    assert_interrupted_download(false);
}

fn assert_interrupted_download(existing: bool) {
    for export in [false, true] {
        let home = tempfile::tempdir().unwrap();
        let archives = home.path().join("archives");
        std::fs::create_dir(&archives).unwrap();
        let dest = archives.join("backup.tar.gz");
        if existing {
            std::fs::write(&dest, b"previous usable archive").unwrap();
        }
        let output = download(home.path(), &dest, export, false);
        assert!(!output.status.success(), "truncated HTTP body must fail");
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("reading response chunk"),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        if existing {
            assert_eq!(std::fs::read(&dest).unwrap(), b"previous usable archive");
        } else {
            assert!(
                !dest.exists(),
                "failed download must not publish a partial archive"
            );
        }
        let names: Vec<_> = std::fs::read_dir(&archives)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(
            names.len(),
            usize::from(existing),
            "temporary archive leaked: {names:?}"
        );
    }
}

#[test]
fn successful_archive_download_replaces_output_and_preserves_permissions() {
    for export in [false, true] {
        for existing in [false, true] {
            let home = tempfile::tempdir().unwrap();
            let dest = home.path().join("backup.tar.gz");
            if existing {
                std::fs::write(&dest, b"previous usable archive").unwrap();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt as _;
                    std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o640))
                        .unwrap();
                }
            }
            let output = download(home.path(), &dest, export, true);
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert_eq!(std::fs::read(&dest).unwrap(), BODY);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt as _;
                assert_eq!(
                    std::fs::metadata(&dest).unwrap().permissions().mode() & 0o777,
                    if existing { 0o640 } else { 0o600 }
                );
            }
        }
    }
}

#[cfg(unix)]
#[test]
fn successful_archive_download_replaces_a_symlink_privately_without_altering_its_target() {
    use std::os::unix::fs::{PermissionsExt as _, symlink};
    for export in [false, true] {
        for directory_target in [false, true] {
            let home = tempfile::tempdir().unwrap();
            let target = home.path().join("previous");
            let dest = home.path().join("backup.tar.gz");
            if directory_target {
                std::fs::create_dir(&target).unwrap();
                std::fs::write(target.join("keep"), b"untouched directory").unwrap();
            } else {
                std::fs::write(&target, b"previous usable archive").unwrap();
            }
            let mode = if directory_target { 0o755 } else { 0o644 };
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(mode)).unwrap();
            symlink(&target, &dest).unwrap();
            let output = download(home.path(), &dest, export, true);
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(
                !std::fs::symlink_metadata(&dest)
                    .unwrap()
                    .file_type()
                    .is_symlink()
            );
            assert_eq!(std::fs::read(&dest).unwrap(), BODY);
            assert_eq!(
                std::fs::metadata(&dest).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
                mode
            );
            if directory_target {
                assert_eq!(
                    std::fs::read(target.join("keep")).unwrap(),
                    b"untouched directory"
                );
            } else {
                assert_eq!(std::fs::read(&target).unwrap(), b"previous usable archive");
            }
        }
    }
}

#[test]
fn archive_download_refuses_a_directory_without_creating_a_temporary_output() {
    for export in [false, true] {
        let home = tempfile::tempdir().unwrap();
        let archives = home.path().join("archives");
        std::fs::create_dir(&archives).unwrap();
        let dest = archives.join("backup.tar.gz");
        std::fs::create_dir(&dest).unwrap();
        std::fs::write(dest.join("keep"), b"untouched directory").unwrap();
        let output = download(home.path(), &dest, export, true);
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("output path is a directory"));
        assert_eq!(
            std::fs::read(dest.join("keep")).unwrap(),
            b"untouched directory"
        );
        assert_eq!(std::fs::read_dir(&archives).unwrap().count(), 1);
    }
}

#[cfg(unix)]
#[test]
fn archive_download_refuses_a_read_only_regular_file_without_touching_it() {
    use std::os::unix::fs::PermissionsExt as _;
    for export in [false, true] {
        let home = tempfile::tempdir().unwrap();
        let archives = home.path().join("archives");
        std::fs::create_dir(&archives).unwrap();
        let dest = archives.join("backup.tar.gz");
        std::fs::write(&dest, b"previous usable archive").unwrap();
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o400)).unwrap();
        let output = download(home.path(), &dest, export, true);
        assert!(!output.status.success());
        assert!(
            String::from_utf8_lossy(&output.stderr)
                .contains("checking output file write permission")
        );
        assert_eq!(std::fs::read(&dest).unwrap(), b"previous usable archive");
        assert_eq!(
            std::fs::metadata(&dest).unwrap().permissions().mode() & 0o777,
            0o400
        );
        assert_eq!(std::fs::read_dir(&archives).unwrap().count(), 1);
    }
}

#[cfg(unix)]
#[test]
fn interrupted_archive_download_preserves_the_destination_symlink_and_target() {
    use std::os::unix::fs::symlink;
    for export in [false, true] {
        let home = tempfile::tempdir().unwrap();
        let archives = home.path().join("archives");
        std::fs::create_dir(&archives).unwrap();
        let target = home.path().join("previous.tar.gz");
        let dest = archives.join("backup.tar.gz");
        std::fs::write(&target, b"previous usable archive").unwrap();
        symlink(&target, &dest).unwrap();
        let output = download(home.path(), &dest, export, false);
        assert!(!output.status.success());
        assert!(
            std::fs::symlink_metadata(&dest)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"previous usable archive");
        assert_eq!(std::fs::read_dir(&archives).unwrap().count(), 1);
    }
}
