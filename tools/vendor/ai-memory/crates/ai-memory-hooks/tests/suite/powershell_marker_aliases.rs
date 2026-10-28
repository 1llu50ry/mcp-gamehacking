#![cfg(windows)]

use std::path::{Path, PathBuf};
use std::process::Command;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("crate should live under crates/ai-memory-hooks")
        .to_path_buf()
}

#[test]
fn powershell_marker_aliases_are_bounded_and_forwarded_with_remote_identity() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("Repo");
    std::fs::create_dir_all(&repo).unwrap();
    assert!(
        Command::new("git")
            .args(["init", "-q"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success()
    );
    assert!(
        Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                "git@git.example.test:Acme/API.git"
            ])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success()
    );
    std::fs::write(
        repo.join(".ai-memory.toml"),
        "project = \"acme-api\"\naliases = [\" Former-Name \", \"legacy_name\", \"Former-Name\"]\n",
    )
    .unwrap();
    let nested = repo.join("nested");
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(
        nested.join(".ai-memory.toml"),
        "[capture]\nignore_paths = [\"secrets/**\"]\n",
    )
    .unwrap();
    let helper = repo_root()
        .join("hooks")
        .join("lib")
        .join("ai-memory-hook.ps1")
        .to_string_lossy()
        .replace('\'', "''");
    let cwd = nested.to_string_lossy().replace('\'', "''");
    let program =
        format!(". '{helper}'; [Console]::Out.Write((Get-AiMemoryMarkerQuery -Cwd '{cwd}'))");
    let output = Command::new(ai_memory_test_support::powershell_exe())
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &program,
        ])
        .env("HOME", temp.path())
        .env("USERPROFILE", temp.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let query = String::from_utf8(output.stdout).unwrap();
    assert!(
        query.contains("&project=acme-api&project_src=marker"),
        "{query}"
    );
    assert!(
        query.contains("&identity=git.example.test%2Facme%2Fapi&identity_src=git_remote"),
        "{query}"
    );
    assert!(
        query.contains("&aliases=%5B%22Former-Name%22%2C%22legacy_name%22%5D"),
        "{query}"
    );
}

fn powershell_route_query(home: &Path, cwd: &str) -> String {
    let helper = repo_root()
        .join("hooks/lib/ai-memory-hook.ps1")
        .to_string_lossy()
        .replace('\'', "''");
    let cwd = cwd.replace('\'', "''");
    let program =
        format!(". '{helper}'; [Console]::Out.Write((Get-AiMemoryMarkerQuery -Cwd '{cwd}'))");
    let output = Command::new(ai_memory_test_support::powershell_exe())
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &program,
        ])
        .env("HOME", home)
        .env("USERPROFILE", home)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

#[test]
fn powershell_home_routes_match_drive_paths_and_forward_identity_aliases() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("Home");
    let repo = temp.path().join("Outside").join("Repo");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&repo).unwrap();
    assert!(
        Command::new("git")
            .args(["init", "-q"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success()
    );
    assert!(
        Command::new("git")
            .args(["remote", "add", "origin", "git@github.com:acme/api.git"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success()
    );
    std::fs::write(
        home.join(".ai-memory.toml"),
        format!(
            "[routes.path.\"{}\"]\nroute_workspace=\"path\"\nroute_project=\"wrong\"\n[routes.identity.\"github.com/acme/api\"]\nroute_workspace=\"oss\"\nroute_project=\"acme-api\"\nroute_identity_style=\"path\"\nroute_aliases=[\"main\"]\n",
            repo.to_string_lossy().replace('\\', "/")
        ),
    )
    .unwrap();
    let helper = repo_root()
        .join("hooks/lib/ai-memory-hook.ps1")
        .to_string_lossy()
        .replace('\'', "''");
    let cwd = repo.to_string_lossy().replace('\'', "''");
    let program =
        format!(". '{helper}'; [Console]::Out.Write((Get-AiMemoryMarkerQuery -Cwd '{cwd}'))");
    let output = Command::new(ai_memory_test_support::powershell_exe())
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &program,
        ])
        .env("HOME", &home)
        .env("USERPROFILE", &home)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let query = String::from_utf8(output.stdout).unwrap();
    assert!(
        query.contains("&workspace=oss&project=acme-api&project_src=marker"),
        "{query}"
    );
    assert!(
        query.contains(
            "&identity=github.com%2Facme%2Fapi&identity_src=git_remote&identity_style=path"
        ),
        "{query}"
    );
    assert!(query.contains("&aliases=%5B%22main%22%5D"), "{query}");
}

#[test]
fn powershell_home_routes_execute_shared_fixture() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../ai-memory-core/fixtures/home_route_cases.json"
    ))
    .unwrap();
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("Home");
    std::fs::create_dir_all(&home).unwrap();
    let helper = repo_root()
        .join("hooks/lib/ai-memory-hook.ps1")
        .to_string_lossy()
        .replace('\'', "''");
    for case in fixture["cases"].as_array().unwrap() {
        let text = match case["generate"].as_str() {
            Some("65_routes") => (0..65)
                .map(|index| format!("[routes.path.\"C:/route/{index}\"]\nroute_workspace=\"ws\"\nroute_project=\"p{index}\"\n"))
                .collect(),
            Some("selector_512") => format!(
                "[routes.path.\"/{}\"]\nroute_workspace=\"bounds\"\nroute_project=\"valid\"\n",
                "a".repeat(511)
            ),
            Some("selector_513") => format!(
                "[routes.path.\"/{}\"]\nroute_workspace=\"bounds\"\nroute_project=\"invalid\"\n",
                "a".repeat(512)
            ),
            Some("oversized_file") => format!("#{}\n", "x".repeat(65_536)),
            Some(other) => panic!("unknown fixture generator {other}"),
            None => case["toml"]
                .as_str()
                .unwrap()
                .replace("{{HOME}}", &home.to_string_lossy().replace('\\', "/"))
                .replace("{{LONG_513}}", &"a".repeat(513)),
        };
        let marker = home.join(".ai-memory.toml");
        std::fs::write(&marker, text).unwrap();
        let cwd = match case["cwd_generate"].as_str() {
            Some("selector_512_child") => format!("/{}/child", "a".repeat(511)),
            Some(other) => panic!("unknown cwd fixture generator {other}"),
            None => case["cwd"]
                .as_str()
                .unwrap()
                .replace("{{HOME}}", &home.to_string_lossy().replace('\\', "/")),
        }
        .replace('\'', "''");
        let identity = case["identity"].as_str().unwrap_or("").replace('\'', "''");
        let marker = marker.to_string_lossy().replace('\'', "''");
        let program = format!(
            ". '{helper}'; $r=Get-AiMemoryHomeRoute -File '{marker}' -Cwd '{cwd}' -Identity '{identity}'; if ($r -eq 'invalid') {{ [Console]::Out.Write('invalid') }} elseif ($null -eq $r) {{ [Console]::Out.Write('none') }} else {{ [Console]::Out.Write($r.Workspace+'/'+$r.Project) }}"
        );
        let output = Command::new(ai_memory_test_support::powershell_exe())
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &program,
            ])
            .env("HOME", &home)
            .env("USERPROFILE", &home)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let expected = match case["status"].as_str().unwrap() {
            "valid" => format!(
                "{}/{}",
                case["workspace"].as_str().unwrap(),
                case["project"].as_str().unwrap()
            ),
            status => status.to_owned(),
        };
        assert_eq!(
            String::from_utf8(output.stdout).unwrap(),
            expected,
            "{}",
            case["name"]
        );
    }
}

#[test]
fn powershell_non_git_path_route_omits_aliases() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("Home");
    let repo = home.join("src/api");
    std::fs::create_dir_all(&repo).unwrap();
    std::fs::write(
        home.join(".ai-memory.toml"),
        "[routes.path.\"~/src/api\"]\nroute_workspace=\"path\"\nroute_project=\"api\"\nroute_aliases=[\"old-api\"]\n",
    )
    .unwrap();
    let query = powershell_route_query(&home, &repo.to_string_lossy());
    assert!(query.contains("&workspace=path&project=api"), "{query}");
    assert!(!query.contains("aliases="), "{query}");
    assert!(!query.contains("identity_src="), "{query}");
}

#[test]
fn powershell_home_routes_match_drive_and_unc_without_identity() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("Home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join(".ai-memory.toml"),
        "[routes.path.\"C:/Work/API\"]\nroute_workspace=\"windows\"\nroute_project=\"drive\"\n[routes.path.\"//Server/Share/API\"]\nroute_workspace=\"windows\"\nroute_project=\"unc\"\n",
    )
    .unwrap();
    let drive = powershell_route_query(&home, r"c:\work\api\lib");
    assert!(
        drive.contains("&workspace=windows&project=drive"),
        "{drive}"
    );
    assert!(!drive.contains("identity_src="), "{drive}");
    let unc = powershell_route_query(&home, r"\\server\share\api\lib");
    assert!(unc.contains("&workspace=windows&project=unc"), "{unc}");
    assert!(!unc.contains("identity_src="), "{unc}");
}
