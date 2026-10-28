//! Integration tests for ai-memory routing instructions.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use ai_memory_core::routing_skills::MANAGED_MARKER;
use ai_memory_core::{MARKER_END, MARKER_START};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_ai-memory")
}

fn run_ai_memory(project: &Path, home: &Path, args: &[&str]) -> Output {
    Command::new(bin())
        .args(args)
        .current_dir(project)
        .env("HOME", home)
        .env("USERPROFILE", home)
        .env("AI_MEMORY_DATA_DIR", home.join(".ai-memory-data"))
        .output()
        .unwrap()
}

fn assert_success(output: Output) -> String {
    assert!(
        output.status.success(),
        "command failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn assert_failure(output: Output) -> String {
    assert!(
        !output.status.success(),
        "command unexpectedly succeeded\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stderr).unwrap()
}

#[test]
fn skill_conflict_preflight_keeps_instruction_file_unchanged_until_force() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let target = project.path().join("CLAUDE.md");
    let original = b"# Project\n\nKeep this exact.\n".to_vec();
    fs::write(&target, &original).unwrap();

    let unmanaged = project
        .path()
        .join(".claude/skills/ai-memory-retrieval/SKILL.md");
    let unmanaged_content = b"---\nname: ai-memory-retrieval\n---\nuser skill\n".to_vec();
    fs::create_dir_all(unmanaged.parent().unwrap()).unwrap();
    fs::write(&unmanaged, &unmanaged_content).unwrap();

    let output = run_ai_memory(project.path(), home.path(), &["install-instructions"]);
    let stderr = assert_failure(output);
    assert!(stderr.contains("refusing to overwrite unmanaged skill"));
    assert_eq!(fs::read(&target).unwrap(), original);
    assert_eq!(fs::read(&unmanaged).unwrap(), unmanaged_content);
    assert!(
        !project
            .path()
            .join(".claude/skills/ai-memory-handoff/SKILL.md")
            .exists()
    );

    let output = run_ai_memory(
        project.path(),
        home.path(),
        &["install-instructions", "--skills-force"],
    );
    assert_success(output);

    let updated = fs::read_to_string(&target).unwrap();
    assert!(updated.contains(MARKER_START));
    assert!(updated.contains("# Project"));
    assert!(
        fs::read_to_string(&unmanaged)
            .unwrap()
            .contains(MANAGED_MARKER)
    );
    assert!(
        project
            .path()
            .join(".claude/skills/ai-memory-handoff/SKILL.md")
            .exists()
    );
}

#[test]
fn no_skills_writes_only_instruction_snippet() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();

    let output = run_ai_memory(
        project.path(),
        home.path(),
        &["install-instructions", "--no-skills"],
    );
    assert_success(output);

    let claude_md = fs::read_to_string(project.path().join("CLAUDE.md")).unwrap();
    assert!(claude_md.contains(MARKER_START));
    assert!(claude_md.contains("Use the installed ai-memory Agent Skills"));
    assert!(!project.path().join(".claude/skills").exists());
    assert!(!project.path().join(".agents/skills").exists());
}

#[test]
fn install_instructions_updates_only_markered_block_and_backs_up_original() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let target = project.path().join("CLAUDE.md");
    let original = format!(
        "# Project\n\nKeep this intro.\n\n{MARKER_START}\nold ai-memory block\n{MARKER_END}\n\nKeep this tail.\n"
    );
    fs::write(&target, &original).unwrap();

    let output = run_ai_memory(
        project.path(),
        home.path(),
        &["install-instructions", "--no-skills"],
    );
    assert_success(output);

    let updated = fs::read_to_string(&target).unwrap();
    assert!(updated.contains("Keep this intro."));
    assert!(updated.contains("Keep this tail."));
    assert!(updated.contains(MARKER_START));
    assert!(updated.contains("Use the installed ai-memory Agent Skills"));
    assert!(!updated.contains("old ai-memory block"));

    let backups: Vec<_> = fs::read_dir(project.path())
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("CLAUDE.md.bak-"))
        })
        .collect();
    assert_eq!(
        backups.len(),
        1,
        "install-instructions must back up updates"
    );
    assert_eq!(fs::read_to_string(&backups[0]).unwrap(), original);
}

#[test]
fn print_shows_only_snippet_without_mutating() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();

    let output = run_ai_memory(
        project.path(),
        home.path(),
        &["install-instructions", "--print"],
    );
    let stdout = assert_success(output);

    assert!(stdout.contains("# Would write into:"));
    assert!(stdout.contains(MARKER_START));
    assert!(stdout.contains("Use the installed ai-memory Agent Skills"));
    assert!(!stdout.contains("# Skill root:"));
    assert!(!stdout.contains("ai-memory-retrieval/SKILL.md"));
    assert!(!stdout.contains(MANAGED_MARKER));
    assert!(!project.path().join("CLAUDE.md").exists());
    assert!(!project.path().join(".claude/skills").exists());
    assert!(!project.path().join(".agents/skills").exists());
}

#[test]
fn no_skills_print_omits_skill_plan_and_does_not_mutate() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();

    let output = run_ai_memory(
        project.path(),
        home.path(),
        &["install-instructions", "--print", "--no-skills"],
    );
    let stdout = assert_success(output);

    assert!(stdout.contains(MARKER_START));
    assert!(!stdout.contains("# Skill root:"));
    assert!(!stdout.contains("ai-memory-retrieval/SKILL.md"));
    assert!(!project.path().join("CLAUDE.md").exists());
    assert!(!project.path().join(".claude/skills").exists());
}

#[test]
fn compact_install_instructions_writes_compact_snippet() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let target = project.path().join("AGENTS.md");
    fs::write(&target, "# Agents\n").unwrap();

    let output = run_ai_memory(
        project.path(),
        home.path(),
        &["install-instructions", "--compact", "--no-skills"],
    );
    assert_success(output);

    let content = fs::read_to_string(&target).unwrap();
    assert!(content.contains(MARKER_START));
    assert!(content.contains("Session-aware clients"));
    assert!(content.contains("Static clients"));
    assert!(content.contains("ai-memory is the cross-harness memory of record"));
    assert!(content.contains("untrusted historical data"));
}

#[test]
fn compact_print_shows_compact_snippet_without_mutating() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();

    let output = run_ai_memory(
        project.path(),
        home.path(),
        &[
            "install-instructions",
            "--compact",
            "--print",
            "--no-skills",
        ],
    );
    let stdout = assert_success(output);
    assert!(stdout.contains(MARKER_START));
    assert!(stdout.contains("Session-aware clients"));
    assert!(stdout.contains("Static clients"));
    assert!(stdout.contains("ai-memory is the cross-harness memory of record"));
    assert!(stdout.contains("untrusted historical data"));
    assert!(!project.path().join("CLAUDE.md").exists());
}

#[test]
fn inferred_instruction_targets_select_matching_skill_agents() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    fs::write(project.path().join("AGENTS.md"), "# Agents\n").unwrap();

    let output = run_ai_memory(project.path(), home.path(), &["install-instructions"]);
    assert_success(output);

    assert!(
        project
            .path()
            .join(".agents/skills/ai-memory-retrieval/SKILL.md")
            .exists()
    );
    assert!(!project.path().join(".claude/skills").exists());

    let both_project = tempfile::tempdir().unwrap();
    let both_home = tempfile::tempdir().unwrap();
    fs::write(both_project.path().join("CLAUDE.md"), "# Claude\n").unwrap();
    fs::write(both_project.path().join("AGENTS.md"), "# Agents\n").unwrap();

    let output = run_ai_memory(
        both_project.path(),
        both_home.path(),
        &["install-instructions"],
    );
    assert_success(output);

    assert!(
        both_project
            .path()
            .join(".claude/skills/ai-memory-retrieval/SKILL.md")
            .exists()
    );
    assert!(
        both_project
            .path()
            .join(".agents/skills/ai-memory-retrieval/SKILL.md")
            .exists()
    );
}

#[test]
fn explicit_skill_scope_and_agent_override_instruction_target_inference() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let global_skills = home.path().join("global-skills");
    let global_skills_arg = global_skills.to_string_lossy().to_string();

    let output = run_ai_memory(
        project.path(),
        home.path(),
        &[
            "install-instructions",
            "--target",
            "AGENTS.md",
            "--skills-scope",
            "global",
            "--skills-agent",
            "claude-code",
            "--skills-target-dir",
            &global_skills_arg,
        ],
    );
    assert_success(output);

    assert!(global_skills.join("ai-memory-retrieval/SKILL.md").exists());
    assert!(!home.path().join(".agents/skills").exists());
    assert!(!project.path().join(".claude/skills").exists());
    assert!(!project.path().join(".agents/skills").exists());
}

#[test]
fn explicit_skill_overrides_win_over_instruction_target_inference() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let custom_root = project.path().join("custom-skills");
    let unmanaged = custom_root.join("ai-memory-retrieval/SKILL.md");
    fs::create_dir_all(unmanaged.parent().unwrap()).unwrap();
    fs::write(
        &unmanaged,
        "---\nname: ai-memory-retrieval\n---\nuser skill\n",
    )
    .unwrap();

    let custom_root_arg = custom_root.to_str().unwrap();
    let output = run_ai_memory(
        project.path(),
        home.path(),
        &[
            "install-instructions",
            "--target",
            "AGENTS.md",
            "--skills-scope",
            "global",
            "--skills-agent",
            "both",
            "--skills-target-dir",
            custom_root_arg,
            "--skills-force",
        ],
    );
    assert_success(output);

    let overwritten = fs::read_to_string(&unmanaged).unwrap();
    assert!(overwritten.contains(MANAGED_MARKER));
    assert!(custom_root.join("ai-memory-handoff/SKILL.md").exists());
    assert!(!project.path().join(".agents/skills").exists());
    assert!(!project.path().join(".claude/skills").exists());
    assert!(!home.path().join(".agents/skills").exists());
    assert!(!home.path().join(".claude/skills").exists());
}

#[test]
fn legacy_long_marker_block_rerun_upgrades_in_place_to_slim_snippet() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let original = format!(
        "# Project\n\n{MARKER_START}\n## Long-term memory (ai-memory)\n\n### When to reach for each tool\n\n|User says / situation|Tool|\n|---|---|\n|search memory|`memory_query`|\n{MARKER_END}\n\nKeep me.\n"
    );
    fs::write(project.path().join("CLAUDE.md"), original).unwrap();

    let output = run_ai_memory(
        project.path(),
        home.path(),
        &["install-instructions", "--no-skills"],
    );
    assert_success(output);

    let updated = fs::read_to_string(project.path().join("CLAUDE.md")).unwrap();
    assert!(updated.contains("# Project"));
    assert!(updated.contains("Keep me."));
    assert!(updated.contains("Use the installed ai-memory Agent Skills"));
    assert!(!updated.contains("When to reach for each tool"));
    assert!(!updated.contains("|User says / situation|Tool|"));
    assert_eq!(
        updated.lines().filter(|line| *line == MARKER_START).count(),
        1
    );
    assert_eq!(
        updated.lines().filter(|line| *line == MARKER_END).count(),
        1
    );
}

#[test]
fn devin_install_instructions_targets_agents_md() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();

    // Create AGENTS.md first so it gets picked up instead of defaulting to CLAUDE.md
    fs::write(project.path().join("AGENTS.md"), "# Project\n").unwrap();

    let output = run_ai_memory(
        project.path(),
        home.path(),
        &[
            "install-instructions",
            "--skills-agent",
            "devin",
            "--no-skills",
        ],
    );
    assert_success(output);

    let agents_md = fs::read_to_string(project.path().join("AGENTS.md")).unwrap();
    assert!(agents_md.contains(MARKER_START));
    assert!(agents_md.contains("Use the installed ai-memory Agent Skills"));
    assert!(!project.path().join("CLAUDE.md").exists());
}

#[test]
fn kimi_code_install_instructions_targets_agents_md() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();

    // Kimi Code's canonical instruction file is AGENTS.md; create it
    // first so it gets picked up instead of defaulting to CLAUDE.md.
    fs::write(project.path().join("AGENTS.md"), "# Project\n").unwrap();

    let output = run_ai_memory(
        project.path(),
        home.path(),
        &["install-instructions", "--no-skills"],
    );
    assert_success(output);

    let agents_md = fs::read_to_string(project.path().join("AGENTS.md")).unwrap();
    assert!(agents_md.contains(MARKER_START));
    assert!(agents_md.contains("Use the installed ai-memory Agent Skills"));
    assert!(!project.path().join("CLAUDE.md").exists());

    // With neither file present, the fallback hint must point Kimi Code
    // users at `--target AGENTS.md`.
    let empty = tempfile::tempdir().unwrap();
    let output = run_ai_memory(
        empty.path(),
        home.path(),
        &["install-instructions", "--no-skills"],
    );
    assert!(output.status.success());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(
        stderr.contains("Kimi Code"),
        "fallback hint must mention Kimi Code; got:\n{stderr}"
    );
}

#[test]
fn devin_install_instructions_writes_project_devin_skills() {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();

    fs::write(project.path().join("AGENTS.md"), "# Project\n").unwrap();

    let output = run_ai_memory(
        project.path(),
        home.path(),
        &["install-instructions", "--skills-agent", "devin"],
    );
    assert_success(output);

    let agents_md = fs::read_to_string(project.path().join("AGENTS.md")).unwrap();
    assert!(agents_md.contains(MARKER_START));
    assert!(agents_md.contains("Use the installed ai-memory Agent Skills"));

    let devin_skill = project
        .path()
        .join(".devin/skills/ai-memory-handoff/SKILL.md");
    let skill_content = fs::read_to_string(&devin_skill)
        .unwrap_or_else(|err| panic!("expected Devin skill {}: {err}", devin_skill.display()));
    assert!(skill_content.contains(MANAGED_MARKER));
    assert!(!project.path().join(".claude/skills").exists());
    assert!(!project.path().join(".agents/skills").exists());
}

/// The first Claude Code instruction file above where `tempfile` puts a
/// project. Probing a real temp dir follows `TMPDIR` the way the tests do.
fn claude_file_above_temp_dir() -> Option<PathBuf> {
    let probe = tempfile::tempdir().ok()?;
    let probe = fs::canonicalize(probe.path()).ok()?;
    probe.parent()?.ancestors().find_map(|dir| {
        ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"]
            .iter()
            .map(|name| dir.join(name))
            .find(|path| path.is_file())
    })
}

/// The file named by the skip note (`note: <path> exists, so Claude Code ...`).
fn noted_file(stderr: &str) -> Option<PathBuf> {
    stderr.lines().find_map(|line| {
        let (path, _) = line
            .strip_prefix("note: ")?
            .split_once(" exists, so Claude Code reads it")?;
        Some(PathBuf::from(path))
    })
}

/// #1297: with only `AGENTS.md` written, a `CLAUDE.local.md` or
/// `.claude/CLAUDE.md` makes Claude Code read that instead, so the install
/// says so. Controls: `AGENTS.md` alone, a `CLAUDE.md` target alongside, and a
/// shadowing file that already imports `@AGENTS.md` print no note.
#[test]
fn install_instructions_warns_when_claude_code_will_skip_agents_md() {
    let note = "so Claude Code reads it instead of AGENTS.md";
    let run_in = |files: &[(&str, &str)]| {
        let project = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        fs::write(project.path().join("AGENTS.md"), "# Project\n").unwrap();
        for (name, text) in files {
            let path = project.path().join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        let output = run_ai_memory(
            project.path(),
            home.path(),
            &["install-instructions", "--no-skills"],
        );
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        assert_success(output);
        let agents = fs::read_to_string(project.path().join("AGENTS.md")).unwrap();
        assert!(agents.contains(MARKER_START), "AGENTS.md gets the block");
        (stderr, project)
    };
    let run = |files: &[(&str, &str)]| run_in(files).0;
    for shadow in ["CLAUDE.local.md", ".claude/CLAUDE.md"] {
        let (stderr, project) = run_in(&[(shadow, "# mine\n")]);
        // A Claude file above the temp dir also ends in `shadow`, so compare
        // the file the note names, not a substring (#1346).
        let named = noted_file(&stderr).and_then(|path| fs::canonicalize(path).ok());
        let expected = fs::canonicalize(project.path().join(shadow)).unwrap();
        assert_eq!(named, Some(expected), "{shadow}: {stderr}");
    }
    // #1346: the binary checks every ancestor of the cwd, so a Claude file
    // above the OS temp dir prints the note for any temp project. On Windows
    // %TEMP% sits inside the real home, next to a user's ~/.claude/CLAUDE.md.
    if let Some(path) = claude_file_above_temp_dir() {
        eprintln!(
            "skipping no-note controls: {} sits above the temp dir",
            path.display()
        );
        return;
    }
    assert!(!run(&[]).contains(note));
    assert!(!run(&[("CLAUDE.local.md", "@AGENTS.md\n")]).contains(note));
    // A CLAUDE.md alongside becomes a target too, so Claude Code sees the block.
    assert!(!run(&[("CLAUDE.md", "# claude\n")]).contains(note));
}

const MEMORY_FILES: [&str; 3] = ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"];

/// Whether any ancestor strictly above `dir` holds one of the memory files the
/// binary scans for. A temp-dir `home` on a developer box usually sits under a
/// real user profile that may itself carry `CLAUDE.md` / `.claude/CLAUDE.md`,
/// which would pollute the "no note" controls (see #1346). When that is the
/// case, skip the negative assertion instead of failing spuriously.
fn ancestor_above_has_memory_file(dir: &Path) -> bool {
    dir.parent()
        .into_iter()
        .flat_map(Path::ancestors)
        .any(|ancestor| {
            MEMORY_FILES
                .iter()
                .any(|name| ancestor.join(name).is_file())
        })
}

/// #1345: with the project under `$HOME` and `$HOME/.claude/CLAUDE.md` present,
/// the file is the user's own memory, not a project blocker, so no note should
/// be printed. This also guards the `HOME` wiring: passing `None` would make the
/// ancestor walk treat the home `.claude/CLAUDE.md` as a blocker and print the
/// note.
#[test]
fn install_instructions_no_note_when_project_under_home() {
    let note = "so Claude Code reads it instead of AGENTS.md";
    let home = tempfile::tempdir().unwrap();
    let project = home.path().join("proj");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("AGENTS.md"), "# Project\n").unwrap();
    fs::create_dir_all(home.path().join(".claude")).unwrap();
    fs::write(home.path().join(".claude/CLAUDE.md"), "# user memory\n").unwrap();

    let output = run_ai_memory(
        &project,
        home.path(),
        &["install-instructions", "--no-skills"],
    );
    assert_success(output.clone());
    if ancestor_above_has_memory_file(home.path()) {
        eprintln!("skipping no-note control: an ancestor of the temp home holds a memory file");
        return;
    }
    assert!(
        !String::from_utf8_lossy(&output.stderr).contains(note),
        "home .claude/CLAUDE.md must not trigger the note:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// #1345: with `$HOME` given through a symlink, the ancestor walk resolves the
/// physical home path while `HOME` is the symlink, so a plain `==` comparison
/// misfires. The note must stay suppressed in that case too.
#[cfg(unix)]
#[test]
fn install_instructions_no_note_when_home_is_symlink() {
    use std::os::unix::fs::symlink;

    let note = "so Claude Code reads it instead of AGENTS.md";
    let real_home = tempfile::tempdir().unwrap();
    let project = real_home.path().join("proj");
    fs::create_dir_all(&project).unwrap();
    fs::write(project.join("AGENTS.md"), "# Project\n").unwrap();
    fs::create_dir_all(real_home.path().join(".claude")).unwrap();
    fs::write(
        real_home.path().join(".claude/CLAUDE.md"),
        "# user memory\n",
    )
    .unwrap();

    let link_parent = tempfile::tempdir().unwrap();
    let home_link = link_parent.path().join("homelink");
    symlink(real_home.path(), &home_link).unwrap();

    let output = run_ai_memory(
        &project,
        &home_link,
        &["install-instructions", "--no-skills"],
    );
    assert_success(output.clone());
    if ancestor_above_has_memory_file(real_home.path()) {
        eprintln!("skipping no-note control: an ancestor of the temp home holds a memory file");
        return;
    }
    assert!(
        !String::from_utf8_lossy(&output.stderr).contains(note),
        "symlinked HOME must not trigger the note:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
