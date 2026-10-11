# Evaluation And Governance

## Detector and telemetry evaluation

- Do not copy universal thresholds across games or populations. Calibrate for
  the title, build, mode, rank, input method, platform, region, and telemetry
  pipeline where the detector will operate.
- Split evaluation data by player/session and, where appropriate, by time.
  Prevent the same player or near-duplicate session from leaking across train,
  calibration, and test sets.
- Include representative legitimate users, top-skill players, accessibility
  tools, unusual hardware, and controlled or independently adjudicated positive
  cases.
- Report prevalence and a confusion matrix with uncertainty: false-positive
  rate, false-negative rate, precision/positive predictive value, recall, and
  calibration. Use PR-oriented metrics for rare events.
- Evaluate the deployed decision volume, not only per-event error rates. A small
  per-test false-positive rate can still create many false alerts when applied
  repeatedly across large populations, time windows, features, or models.
  Report expected alert and review counts; control repeated-testing and
  false-discovery effects where applicable.
- A score in `[0, 1]` is not a probability or calibrated confidence unless this
  interpretation has been validated on held-out representative data.
- Derive minimum sample requirements empirically. Round numbers such as 40 or 50
  samples are not general stability guarantees.
- Model signal dependence. Taking the maximum score or counting several
  correlated signals does not guarantee corroboration or a lower joint
  false-positive rate.
- Revalidate after patches, balance changes, input changes, and population
  drift. Version thresholds, features, models, and schemas.
- Document label origin, adjudication criteria, reviewer disagreement, and
  uncertainty. Separate controlled positives from suspected cases; check
  training and evaluation data for contamination, duplication, and poisoning.

## Invariant checks

For timing, rollback or recording-dependent invariants, use
[time and replay evidence](../../game-server-security/references/time-ordering-and-replay.md).
For absent or delayed telemetry and decision recovery, use
[detector operations](../../anti-cheat/references/detector-operations.md).

Before treating an invariant violation as strong evidence:

1. Confirm the invariant is actually guaranteed for that state and build.
2. Confirm the observation came from an authoritative, correctly ordered source.
3. Exclude replication delay, rollback, retries, reconnects, transitions,
   administrator/test paths, legitimate teleports or grants, schema errors,
   stale baselines, and game bugs.
4. Distinguish a state-integrity violation from attribution of exploitation.

An invariant can justify containment or investigation sooner than a soft
behavioral anomaly, but attribution and punitive action still require evidence
appropriate to their impact.

## Data and decision governance

- Collect only telemetry needed for a declared detection purpose. Define field
  ownership, access controls, retention, deletion, and incident-response rules.
- Prefer pseudonymous identifiers in analysis data and keep re-identification
  material separately protected. Do not place secrets or unnecessary personal
  data in evidence logs.
- Protect evidence integrity with immutable references, hashes where useful,
  schema validation, ordering information, and an auditable access trail.
- Evaluate performance for relevant populations and legitimate edge cases,
  including accessibility tools and unusual hardware, without assuming that a
  population difference implies abuse.
- Keep detector output separate from enforcement policy. Record who or what made
  the final decision, preserve counterevidence, and make consequential outcomes
  reviewable and appealable.

## Quality gates

- **Scope:** versions, trust boundaries, and decision stakes are explicit.
- **Identity:** citation metadata and source identity were verified.
- **Support:** each material claim is supported by the cited content.
- **Alternatives:** plausible benign causes and contradictory evidence were
  considered.
- **Validity:** empirical claims include representative evaluation and suitable
  metrics.
- **Reproducibility:** inputs, configuration, and transformations are traceable.
- **Calibration:** conclusion wording matches evidence strength and scope.
- **Action:** response is proportional, reviewable, and preserves an appeal path
  for consequential enforcement.

If a gate fails, narrow the claim or return inconclusive. Never auto-fill a
missing source, fabricate a citation, or raise confidence to satisfy a template.

## What tests establish

- Unit and fixture tests establish implementation behavior.
- Calibration tests establish an operating threshold on a defined population.
- Held-out, temporal, and external tests assess generalization.
- Shadow/canary monitoring assesses production drift and operational impact.

A green suite built from hand-authored threshold-triggering fixtures does not
establish detector validity, low false-positive rates, or production readiness.
