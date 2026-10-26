<!--
Thanks for the PR. Checklist below helps us land it fast.
-->

## What this changes

<!-- One or two sentences. Link the issue if relevant. -->

Closes #

## Type

- [ ] Bug fix
- [ ] New MCP tool
- [ ] New skill (SKILL.md)
- [ ] New RE/debug backend
- [ ] Docs
- [ ] Build / CI / infra

## Checklist

- [ ] `npx tsc` passes with no errors.
- [ ] `npm test` passes.
- [ ] New file-reading code calls `requirePathAllowed(path)` from `src/fs-sandbox.ts`.
- [ ] Added a test (if touching `src/`) or a skill-link check doesn't flag broken `[[…]]` references.
- [ ] CHANGELOG.md updated (for user-visible changes).
- [ ] Followed the [Code of Conduct](CODE_OF_CONDUCT.md) and the Ethics section of README.

## Screenshots / terminal output

<!-- A paste of the tool output is often the fastest way to review. -->
