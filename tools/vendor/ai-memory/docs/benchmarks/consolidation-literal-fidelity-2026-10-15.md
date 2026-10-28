# Consolidation literal fidelity: verbatim residue

Date: 2026-10-15

Base commit: `862ed0a0ea1d001d97544a94eb40340fa7b7b87d` plus the uncommitted
`#1215` mechanism under test

Provider/model: Codex OAuth, `gpt-6-sol`, same on both sides

Runs: 3 per side

Generated seed: `1215`

Generated fixture sha256:
`f25fbc436edf70647ff54b910dfa5ab72259e1b45f1c072db63b9e23d01879d4`

The baseline used the default request. The candidate enabled only
`verbatim_residue`; system prompts and provider/model were identical. The
focused run used fixture 06 plus the generated long session because those are
the two cases named by the design's mechanism gate.

## Projection

| case | facts lost off | facts lost on | error-observation coverage off -> on | request bytes off -> on |
|---|---:|---:|---:|---:|
| pt-BR tail/error forms | 1/3 | 0/3 | 0.500 -> 1.000 | 16,728 -> 17,191 |
| generated-1215 | 8/15 | 3/15 | 0.333 -> 1.000 | 292,582 -> 291,483 |

The generated candidate is smaller because making room for the bounded
residue pruned one ordinary observation block (224 selected off, 223 on). The
three remaining projection misses are intentionally outside the default
classes: Portuguese-only natural language, a bare hostname, and a natural
language condition.

## Page fidelity

The aggregate `llm_loss` percentage is not comparable across the two sides:
the candidate denominator includes facts the baseline request never carried.
The predeclared gate therefore separates newly visible at-risk facts from
facts both requests already carried.

| case / measure | baseline mean (range) | residue mean (range) |
|---|---:|---:|
| pt-BR at-risk page recall (1 fact) | 0.000 (0.000-0.000) | 0.667 (0.000-1.000) |
| pt-BR kept-fact page recall (2 facts) | 0.333 (0.000-0.500) | 0.333 (0.000-0.500) |
| generated at-risk page recall (5 newly visible facts) | 0.000 (0.000-0.000) | 0.200 (0.200-0.200) |
| generated kept-fact page recall (7 facts) | 0.857 (0.857-0.857) | 0.857 (0.857-0.857) |
| pt-BR invented tokens | 1.33 (0-2) | 1.33 (0-2) |
| generated invented tokens | 1.67 (1-2) | 1.67 (1-2) |
| parse rate | 3/3 | 3/3 |

No run invented a wikilink. No forbidden string was reported. The
`file_error_line_share` noise gate was `0.000`, below its `0.20` ceiling.
The candidate recovered at-risk facts beyond the baseline's zero/noise floor,
kept-fact recall did not regress, and parse/invention rates remained equal, so
the mechanism passes the design's opt-in gate. These numbers do not justify
the separate conditional prompt-copy change; that requires the single-page
prompt experiment specified in the design.

Reproduction shape (credential arguments omitted):

```bash
cargo run -p ai-memory-eval -- ab \
  --fixtures <directory-containing-fixture-06> \
  --baseline-provider codex --baseline-model gpt-6-sol \
  --candidate-provider codex --candidate-model gpt-6-sol \
  --runs 3 --generated-seed 1215 --residue
```
