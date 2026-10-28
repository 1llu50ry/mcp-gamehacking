//! Windows PowerShell regression test for the server-profile guard (#992).
//!
//! The script hooks cannot route a `server` profile, so
//! `Test-AiMemoryServerRouted` must make them emit nothing for a routed
//! repository instead of delivering it to the install default. This runs the
//! real function against a fixture tree and checks it mirrors the native
//! walk: routing is inherited down the tree, any value shape counts and a
//! BOM cannot hide the key, look-alike keys do not count, the walk stops at
//! `$HOME` but continues past a checkout root outside it, and no argument
//! means the current directory.

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

fn write(path: &Path, bytes: &[u8]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

/// Each case sets `$env:HOME` (the walk boundary) and asks whether `cwd` is
/// routed; the script prints one `T`/`F` per case in order.
const PROGRAM: &str = r#". '__HELPER__'; $Error.Clear()
$r = $env:AI_MEMORY_TEST_ROOT
$h = Join-Path $r 'home'
$h2 = Join-Path $r 'home2'
function Case([string]$hm, [string]$cwd) {
    $env:HOME = $hm; $env:USERPROFILE = $hm
    if (Test-AiMemoryServerRouted -Cwd $cwd) { 'T' } else { 'F' }
}
$out = @(
    (Case $h (Join-Path $h 'routed')),
    (Case $h (Join-Path $h 'routed\sub')),
    (Case $h (Join-Path $h 'bom')),
    (Case $h (Join-Path $h 'plain')),
    (Case $h (Join-Path $h 'lookalike')),
    (Case $h (Join-Path $h 'nothing')),
    (Case (Join-Path $h2 'inner') (Join-Path $h2 'inner\repo')),
    (Case $h2 (Join-Path $h2 'inner\repo')),
    (Case $h (Join-Path $r 'org\repo')),
    (Case $h (Join-Path $r 'outside\repo'))
)
$env:HOME = $h; $env:USERPROFILE = $h
Set-Location (Join-Path $h 'routed')
$out += $(if (Test-AiMemoryServerRouted) { 'T' } else { 'F' })
if ($Error.Count -ne 0) { [Console]::Error.Write(($Error | Out-String)); exit 17 }
[Console]::Out.Write(($out -join ''))
"#;

#[test]
fn server_routed_guard_mirrors_the_native_walk() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    // Inside home: inherited down the tree, any value shape, BOM-proof.
    write(
        &root.join("home/routed/.ai-memory.toml"),
        b"workspace = \"b\"\nserver = \"team-b\"\n",
    );
    write(
        &root.join("home/routed/sub/.ai-memory.toml"),
        b"workspace = \"sub\"\n",
    );
    write(
        &root.join("home/bom/.ai-memory.toml"),
        b"\xEF\xBB\xBFserver = team-b\n",
    );
    write(
        &root.join("home/plain/.ai-memory.toml"),
        b"workspace = \"a\"\n",
    );
    write(
        &root.join("home/lookalike/.ai-memory.toml"),
        b"# server = \"x\"\nservers = \"x\"\nmy_server = \"x\"\n",
    );
    std::fs::create_dir_all(root.join("home/nothing")).unwrap();
    // A marker above $HOME is out of reach; the same cwd with a wider home
    // sees it, so the boundary and not the fixture is what hides it.
    write(
        &root.join("home2/.ai-memory.toml"),
        b"server = \"team-b\"\n",
    );
    std::fs::create_dir_all(root.join("home2/inner/repo")).unwrap();
    // Outside home: the walk continues past a checkout root to an
    // organisation-level marker, and finds nothing when there is none.
    write(&root.join("org/.ai-memory.toml"), b"server = \"team-b\"\n");
    std::fs::create_dir_all(root.join("org/repo/.git")).unwrap();
    write(
        &root.join("org/repo/.ai-memory.toml"),
        b"workspace = \"api\"\n",
    );
    std::fs::create_dir_all(root.join("outside/repo/.git")).unwrap();
    write(
        &root.join("outside/repo/.ai-memory.toml"),
        b"workspace = \"api\"\n",
    );

    let helper = repo_root()
        .join("hooks")
        .join("lib")
        .join("ai-memory-hook.ps1");
    let helper = helper.to_string_lossy().replace('\'', "''");
    let program = PROGRAM.replace("__HELPER__", &helper);
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
        .env("AI_MEMORY_TEST_ROOT", root)
        .output()
        .expect("run PowerShell server-routed guard");
    assert!(
        output.status.success(),
        "PowerShell guard failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "PowerShell guard polluted stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "TTTFFFFTTFT",
        "routed, inherited, bom, plain, lookalike, none, above-home, \
         above-home-control, org-outside-home, outside-none, current-dir"
    );
}
