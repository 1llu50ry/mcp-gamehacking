//! `projection` — the zero-LLM half of the fidelity scoring (#1215).
//!
//! Builds the batch consolidation request for every fixture, plus the
//! seeded long session on request, and reports which `must_mention` facts
//! and keep-tokens the observation projection let into the prompt. No
//! provider, no network: a fact this reports lost never reached any model.

use std::path::PathBuf;

use ai_memory_consolidate::build_batch_request;
use ai_memory_core::SessionId;
use anyhow::{Context, Result};

use crate::ab::{describe_projection, load_fixtures, synthesise_observations};
use crate::fidelity::{Scorer, request_text};
use crate::generate;

#[derive(clap::Args, Debug)]
pub struct ProjectionArgs {
    /// Fixture directory (each `*.json` is one synthetic session log).
    #[arg(long, default_value = "evals/fixtures")]
    fixtures: PathBuf,

    /// Also project the seeded long session; the published runs use 1215.
    #[arg(long)]
    generated_seed: Option<u64>,

    /// Write each request (system prompt + user message) and the generated
    /// session into this directory.
    #[arg(long)]
    dump: Option<PathBuf>,

    /// Also render and score the opt-in verbatim-residue request beside the
    /// byte-compatible default request.
    #[arg(long)]
    residue: bool,
}

pub fn run(args: ProjectionArgs) -> Result<()> {
    let mut fixtures = load_fixtures(&args.fixtures)
        .with_context(|| format!("loading fixtures from {}", args.fixtures.display()))?;
    if let Some(dir) = &args.dump {
        std::fs::create_dir_all(dir)?;
    }
    if let Some(seed) = args.generated_seed {
        let fx = generate::session(seed);
        let (json, sha) = generate::dump(&fx)?;
        println!("generated session: seed {seed}, sha256 {sha}");
        if let Some(dir) = &args.dump {
            std::fs::write(dir.join(format!("{}.json", fx.name)), json)?;
        }
        fixtures.push((PathBuf::from(format!("{}.json", fx.name)), fx));
    }
    for (path, fx) in &fixtures {
        let observations = synthesise_observations(fx);
        let session_id = SessionId::new();
        let request = build_batch_request(session_id, &observations, false);
        let scorer = Scorer::new(
            session_id,
            &observations,
            &request,
            &fx.must_mention,
            &fx.must_not_mention,
        );
        let projection = scorer.prompt(observations.len());
        println!("{:<28} {}", fx.name, describe_projection(&projection));
        if let Some(dir) = &args.dump {
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(&fx.name);
            std::fs::write(
                dir.join(format!("{stem}.request.txt")),
                request_text(&request),
            )?;
        }
        if args.residue {
            let request = build_batch_request(session_id, &observations, true);
            let scorer = Scorer::new(
                session_id,
                &observations,
                &request,
                &fx.must_mention,
                &fx.must_not_mention,
            );
            let projection = scorer.prompt(observations.len());
            println!(
                "{:<28} {}",
                format!("{} + residue", fx.name),
                describe_projection(&projection)
            );
            if let Some(dir) = &args.dump {
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&fx.name);
                std::fs::write(
                    dir.join(format!("{stem}.residue.request.txt")),
                    request_text(&request),
                )?;
            }
        }
    }
    Ok(())
}
