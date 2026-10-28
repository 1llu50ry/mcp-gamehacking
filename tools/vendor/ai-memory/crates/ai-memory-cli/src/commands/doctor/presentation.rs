//! Human report formatting; collection and diagnostic verdicts stay in the command.

use super::*;

pub(super) fn render(report: &DoctorReport, terminal: &crate::terminal::Terminal) {
    terminal.header("DOCTOR / capture coverage");
    terminal.section("Connection");
    terminal.line(format_args!(
        "Capture coverage for {}/{} (server {})",
        report.workspace, report.project, report.server
    ));
    if let Some(identity) = &report.identity {
        terminal.line(format_args!(
            "  identity: {} ({}, server {})",
            identity.operator.as_deref().unwrap_or("anonymous"),
            identity.level,
            identity.version
        ));
    } else {
        terminal.line(format_args!("  identity: unavailable"));
    }
    if let Some(posture) = report.auth_posture {
        terminal.line(format_args!("  auth: {}", posture.line()));
    }
    if report.capture_owner_active {
        terminal.line(format_args!(
            "  AI_MEMORY_CAPTURE_OWNER is active: native capture is suppressed in this process.\n  \
             Confirm the external producer is delivering events."
        ));
    }
    if let Some(coordinate) = &report.project_coordinate {
        terminal.text(&render_project_coordinate(coordinate));
    }
    if let Some(problem) = &report.capture_coverage_problem {
        terminal.line(format_args!(
            "  capture coverage: unavailable ({})",
            problem.reason
        ));
    }
    terminal.section("Capture health");
    terminal.text(&render_capture_health(report));
    terminal.text(&render_plugins(&report.plugins));
    terminal.text(&render_muse(report.muse.as_ref()));
    terminal.text(&super::super::agentmemory_residue::render(
        &report.agentmemory_residue,
    ));
    if report.since_days == 0 {
        terminal.line(format_args!("  recent window: all on-disk sessions\n"));
    } else {
        terminal.line(format_args!(
            "  recent window: last {} days\n",
            report.since_days
        ));
    }

    if let Some(problem) = &report.windows_logon {
        terminal.line(format_args!("{}", problem.render_human()));
    }

    if let Some(problem) = &report.marker_capture_problem {
        terminal.line(format_args!(
            "⚠ {}: the settings marker has an invalid `[capture]` section.\n  \
             It fails closed — file and shell tool content is reduced to metadata there, \
             nothing leaks — but its `ignore_paths` exclusions are NOT applying while it stays \
             invalid. Fix the TOML and re-run `ai-memory doctor` to confirm.\n",
            problem.classification
        ));
    }

    if !report.native_memory.is_empty() {
        terminal.line(format_args!(
            "Note: a shell/PowerShell hook install does not \
             enforce capture-policy v1 — \"excluded\" below only holds on a native hook \
             install or a generated integration. Check the configured hook command; a dry-run \
             `ai-memory install-hooks` reports the selected install path, not the active one.\n"
        ));
    }

    if report.rows.is_empty() {
        if report.capture_coverage_problem.is_some() {
            terminal.line(format_args!(
                "  No local harness sessions found for this project; server capture counts are unavailable."
            ));
        } else {
            terminal.line(format_args!(
                "  No local harness sessions found for this project and nothing captured yet."
            ));
        }
        return;
    }

    terminal.section("Agent coverage");
    for row in &report.rows {
        let mark = match row.uncaptured {
            Some(true) => "⚠",
            Some(false) => "✓",
            None => "?",
        };
        let captured = row
            .captured
            .map_or_else(|| "unavailable".to_owned(), |count| count.to_string());
        terminal.line(format_args!(
            "  {mark} {:<14} {:>4} local ({} recent) → {:>11} captured",
            row.agent, row.local_total, row.local_recent, captured
        ));
        if row.uncaptured == Some(true) {
            if report.capture_owner_active {
                terminal.line(format_args!(
                    "      No captured session: check the external producer and repository policy."
                ));
            } else {
                terminal.line(format_args!(
                    "      └ ran here but nothing was captured — install its hook:\n        \
                     ai-memory install-hooks --agent {} --apply",
                    row.agent
                ));
            }
        }
        if let Some(count) = row.mixed_capture_sessions.filter(|count| *count > 0) {
            terminal.line(format_args!(
                "      {count} session(s) contain events from multiple capture sources.\n      \
                 Backfill can also mix source metadata; this does not prove duplicate capture."
            ));
        }
        if let Some(memory) = report.native_memory.iter().find(|m| m.agent == row.agent) {
            terminal.line(format_args!(
                "      native memory: {} ({} file{})",
                memory.path,
                memory.file_count,
                if memory.file_count == 1 { "" } else { "s" }
            ));
            terminal.line(format_args!("      capture: {}", memory.status));
        }
    }

    if report.capture_coverage_problem.is_some() {
        terminal.line(format_args!(
            "\nCapture verdict unavailable: server capture counts could not be resolved."
        ));
    } else if report.uncaptured.is_empty() {
        terminal.line(format_args!(
            "\n✓ Every harness that ran in this project recently is captured on the server."
        ));
    } else {
        let remedy = if report.capture_owner_active {
            "Check the external producer and repository policy, then re-run `ai-memory doctor`."
        } else {
            "Install the hook(s) above, then re-run `ai-memory doctor` to confirm."
        };
        terminal.line(format_args!(
            "\n⚠ {} harness(es) ran here recently with no captured sessions: {}.\n  {remedy}",
            report.uncaptured.len(),
            report.uncaptured.join(", ")
        ));
    }
}
