//! Oracle for the bounded session-observation load (equivalence tests).
//!
//! This file holds verbatim copies of the pre-change request builders,
//! `build_request_with_residue` and `build_batch_request_with_residue` as of
//! the pre-change commit, byte-identical apart from the renamed entry
//! points, so the equivalence tests in `tests/suite/bounded_session_load.rs`
//! can compare the old full-load path against the bounded-snapshot path on
//! the same data. The projection the builders call (`project_observations`
//! and its config) is the frozen base copy
//! (`crate::consolidator::frozen_projection_oracle`), not the live
//! `crate::projection`: the oracles must not share the rule under test,
//! which is what makes the equivalence tests independent. The other shared
//! helpers they call (`count_chars`, the render functions) are the current
//! ones: their behaviour is pinned by the consolidator unit tests.

use super::*;
use crate::consolidator::frozen_projection_oracle::{
    ObservationProjectionConfig, project_observations,
};

/// Old single-page request builder, copied verbatim (pre-change).
pub(crate) fn oracle_single_request(
    session_id: SessionId,
    observations: &[Observation],
    current_body: &str,
    instructions: Option<&str>,
    budgets: PromptBudgets,
    existing_titles: &[String],
    verbatim_residue: bool,
) -> ChatRequest {
    // Stable prefix first so prefix-caching providers can reuse it across
    // sessions of the same project: the project instructions lead, then the
    // per-page current body and titles, then the per-session id and the
    // observation dump at the end. Budget math is unchanged — only the
    // block order moved.
    let mut observations_header = String::new();
    observations_header.push_str("Session id: ");
    observations_header.push_str(&session_id.to_string());
    observations_header.push_str("\nObservations (in order):\n\n");

    let optional_budget = budgets.optional_context_budget::<ConsolidatedPage>(
        SYSTEM_PROMPT,
        count_chars(&observations_header),
    );
    let instructions_block =
        render_instructions_block(instructions, optional_budget.saturating_div(2));
    let current_body_budget = optional_budget.saturating_sub(count_chars(&instructions_block));
    let titles_block =
        render_title_uniqueness_section(existing_titles, current_body_budget.saturating_div(2));
    let current_body_budget = current_body_budget.saturating_sub(count_chars(&titles_block));
    let current_body_block = render_current_body_section(current_body, current_body_budget);

    let observation_chars = budgets.remaining_input_chars::<ConsolidatedPage>(
        SYSTEM_PROMPT,
        count_chars(&observations_header)
            .saturating_add(count_chars(&instructions_block))
            .saturating_add(count_chars(&current_body_block))
            .saturating_add(count_chars(&titles_block)),
    );
    let projected = project_observations(
        observations,
        &ObservationProjectionConfig::new(
            observation_chars,
            MAX_PROJECTED_OBSERVATIONS,
            MAX_PROJECTED_OBSERVATION_BODY_CHARS,
        )
        .with_context_label("single-page consolidation")
        .with_verbatim_residue(verbatim_residue),
    );
    let mut buf = String::new();
    buf.push_str(&instructions_block);
    buf.push_str(&current_body_block);
    buf.push_str(&titles_block);
    buf.push_str(&observations_header);
    buf.push_str(&projected.text);

    ChatRequest {
        system: Some(SYSTEM_PROMPT.into()),
        messages: vec![ChatMessage {
            role: Role::User,
            content: buf,
        }],
        max_tokens: budgets.max_output_tokens,
        temperature: Some(0.2),
    }
}

/// Old batch request builder, copied verbatim (pre-change).
pub(crate) fn oracle_batch_request(
    session_id: SessionId,
    observations: &[Observation],
    slots: &[SlotSnapshot],
    instructions: Option<&str>,
    budgets: PromptBudgets,
    existing_titles: &[String],
    verbatim_residue: bool,
) -> ChatRequest {
    // Stable prefix first so prefix-caching providers can reuse it across
    // sessions of the same project: the fixed batch scaffolding (header +
    // field schema) and the project instructions lead the message, then the
    // per-project slot/title state, then the per-session id and the
    // observation dump at the end. Budget math is unchanged — only the
    // block order moved.
    let mut fixed_header = String::new();
    fixed_header.push_str(
        "You are compiling a Karpathy-style multi-page wiki update. Given the \
         session's observation log, produce a ConsolidatedBatch:\n\n",
    );

    let mut observations_header = String::new();
    observations_header.push_str("Session id: ");
    observations_header.push_str(&session_id.to_string());
    observations_header.push_str("\n\nObservations:\n");

    let mut mandatory_suffix = String::new();
    mandatory_suffix.push_str(
        "\nProduce up to 5 page updates. Use these path conventions:\n\
         - sessions/<session_id>.md  (episodic, this run's narrative)\n\
         - concepts/<slug>.md         (semantic, evergreen concept pages)\n\
         - decisions/<short>.md       (semantic, ADR-style records)\n\
         - gotchas/<slug>.md          (semantic, failure modes / surprises)\n\
         - _slots/<name>.md           (pinned memory slot; use sparingly)\n\
         \n## `tier` field — EXACTLY ONE of these four strings on every update\n\
         Never an integer, never a synonym, never one of the `slot_kind` values below.\n\
         - \"working\"      (the live in-progress slice of the session — rarely used here)\n\
         - \"episodic\"     (per-session narrative; the sessions/<id>.md page)\n\
         - \"semantic\"     (durable knowledge: concepts/, decisions/, gotchas/, rules)\n\
         - \"procedural\"   (repeated patterns extracted from many episodic pages)\n\
         \n## `kind` field — EXACTLY ONE of these four strings on every update\n\
         Never an integer, never \"session\" / \"concept\" / \"note\".\n\
         - \"decision\" (the project chose X over Y)\n\
         - \"gotcha\"   (a failure mode or surprise worth remembering)\n\
         - \"rule\"     (durable project convention: \"always X\", \"never Y\")\n\
         - \"fact\"     (everything else; the default — use this for session narratives and plain concept notes)\n\
         \nWhen you mark an update as `rule`, write the body as a clear \
         standalone instruction the agent could follow on every relevant \
         action. The path you suggest for a rule will be overridden — the \
         system routes rules to `_rules/<slug>.md` automatically and the \
         lint pass surfaces a hint to copy it into the project's CLAUDE.md.\
         \n## `slot_kind` field — OPTIONAL, ONLY for `_slots/*` paths\n\
         **Completely unrelated to `tier`.** A separate flag that controls the\n\
         write regime for pinned memory slots. Do NOT put these values in `tier`.\n\
         - \"state\"      (default; mutable current focus, pending items, working context)\n\
         - \"invariant\"  (high-resistance project rules, identity, or user preferences)\n\
         Do not emit an update for an existing invariant slot unless the observations directly contradict specific existing content. State slots may be refreshed normally.\n\
         \n## Required JSON keys on every update (use these EXACT names)\n\
         - \"path\"            (string)  required — the wiki path\n\
         - \"title\"           (string)  required — the page title\n\
         - \"body_markdown\"   (string)  required — the page body in Markdown; NOTE the underscore + the suffix `_markdown`, NOT just `body`\n\
         - \"tier\"            (string)  required — one of: working | episodic | semantic | procedural\n\
         - \"kind\"            (string)  required — one of: decision | gotcha | rule | fact\n\
         - \"tags\"            (array of string)  required — may be empty `[]`, but the key must be present\n\
         - \"entities\"        (array of string)  required — may be empty `[]`, but the key must be present; see below\n\
         - \"relations\"       (object) optional — keys: \"causes\", \"fixes\", \"contradicts\"; each contains an array of existing wiki paths. Declare only evidence-backed edges; empty arrays are normal.\n\
         - \"slot_kind\"       (string) optional — ONLY for `_slots/*`; one of \"state\" or \"invariant\"; this is the SLOT WRITE REGIME, NOT a tier value\n\
         - \"summary\"         (string) optional — ONE line of plain prose describing the page, shown beside its title. Headings, `- **key:** value` bullets, list items, and repeated titles are discarded. Omit rather than guess.\n\
         Use only the keys listed above. No `body`, no `content`. Field names \
         are case-sensitive and the `_markdown` suffix matters.\n\
         \n## `entities` field — the specific nouns the page is about\n\
         Up to 10 short names (max 64 chars each), lowercase, taken from \
         what the page actually names: technologies (`sqlite`, `tokio`), \
         components (`writer actor`, `hook router`), services, crates, \
         file or module names, and product/domain nouns. They power a \
         retrieval stream, so a later query naming one of them finds this \
         page even when the wording differs.\n\
         Do NOT include: generic words (`code`, `bug`, `change`, \
         `refactor`), the tier or kind values, whole sentences, or \
         restatements of the title. Prefer fewer, more specific entries \
         over padding the list. `[]` is correct for a page with no \
         specific nouns.\n\
         \n## Output format (read this carefully)\n\
         Reply with ONE JSON object matching the ConsolidatedBatch schema, \
         and nothing else. NO prose preamble, NO trailing commentary, NO \
         markdown headers wrapping the JSON, NO ``` code fences. The very \
         first character of your reply must be `{` and the very last `}`. \
         Strings must be JSON strings (with double quotes), not numbers \
         and not bare identifiers.\n\
         \n## Top-level shape\n\
         {\n\
         \x20\x20\"updates\": [ /* 1-5 update objects with the keys above */ ],\n\
         \x20\x20\"rationale\": \"<one short sentence about why this batch>\"\n\
         }\n",
    );
    let optional_budget = budgets.optional_context_budget::<ConsolidatedBatch>(
        BATCH_SYSTEM_PROMPT,
        count_chars(&fixed_header)
            .saturating_add(count_chars(&mandatory_suffix))
            .saturating_add(count_chars(&observations_header)),
    );
    let titles_block =
        render_title_uniqueness_section(existing_titles, optional_budget.saturating_div(2));
    let optional_budget = optional_budget.saturating_sub(count_chars(&titles_block));
    let instructions_block =
        render_instructions_block(instructions, optional_budget.saturating_div(2));
    let slots_budget = optional_budget.saturating_sub(count_chars(&instructions_block));
    let slots_block = render_slot_snapshots(slots, slots_budget);

    let observation_chars = budgets.remaining_input_chars::<ConsolidatedBatch>(
        BATCH_SYSTEM_PROMPT,
        count_chars(&fixed_header)
            .saturating_add(count_chars(&mandatory_suffix))
            .saturating_add(count_chars(&observations_header))
            .saturating_add(count_chars(&titles_block))
            .saturating_add(count_chars(&instructions_block))
            .saturating_add(count_chars(&slots_block)),
    );
    let projected = project_observations(
        observations,
        &ObservationProjectionConfig::new(
            observation_chars,
            MAX_PROJECTED_OBSERVATIONS,
            MAX_PROJECTED_OBSERVATION_BODY_CHARS,
        )
        .with_context_label("batch consolidation")
        .with_verbatim_residue(verbatim_residue),
    );
    let mut buf = String::new();
    buf.push_str(&fixed_header);
    buf.push_str(&mandatory_suffix);
    buf.push_str(&instructions_block);
    buf.push_str(&slots_block);
    buf.push_str(&titles_block);
    buf.push_str(&observations_header);
    buf.push_str(&projected.text);

    ChatRequest {
        system: Some(BATCH_SYSTEM_PROMPT.into()),
        messages: vec![ChatMessage {
            role: Role::User,
            content: buf,
        }],
        max_tokens: budgets.max_output_tokens,
        temperature: Some(0.2),
    }
}
