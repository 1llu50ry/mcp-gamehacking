# Contributing Guidelines

Thank you for your interest in contributing to the MCP Local Memory Service!

- **Project overview:** See the [README](README.md) for features and usage.
- **Setup & client integration:** See the [GitHub Wiki — Getting Started](https://github.com/vheins/local-memory-mcp/wiki/en/Getting-Started) (Gemini CLI, Claude Code, OpenCode, and more).
- **API & internals:** See the [GitHub Wiki — Tools Reference](https://github.com/vheins/local-memory-mcp/wiki/en/Tools-Reference) and [GitHub Wiki — MCP Concepts](https://github.com/vheins/local-memory-mcp/wiki/en/MCP-Concepts).

## Reporting Issues

If you find a bug or have a feature idea:

1. Check if a similar issue has already been reported on [GitHub Issues](https://github.com/vheins/local-memory-mcp/issues).
2. If not, create a new issue with the label `bug` or `enhancement`.
3. Include details about your OS, Node.js version, and steps to reproduce the bug.

## Code Contribution Workflow

1. Fork this repository.
2. Create a new branch (`feat/feature-name` or `fix/bug-description`).
3. Ensure your code follows the project's TypeScript standards.
4. **Mandatory:** Add tests for your change per the [Testing Standard](.agents/documents/testing.md) — server tests under `src/**/tests/`, dashboard UI tests in colocated `__tests__/`; new code ships its tests in the same commit.
5. Run tests: `npm run test`.
6. Submit a Pull Request (PR) to the `main` branch.

## Testing

The single authoritative testing standard is **[.agents/documents/testing.md](.agents/documents/testing.md)** — location policy, naming taxonomy, scope/layer rules, fixtures, and coverage requirements. Key points:

- **Location:** server/dashboard non-UI tests under `src/**/tests/`; dashboard UI tests in `__tests__/` colocated beside the component/lib.
- **Naming:** `*.test.ts` (unit) | `*.integration.test.ts` | `*.e2e.test.ts` | `*.perf.test.ts`. No snake_case names.
- **Coverage:** every change ships its tests in the same commit; targets configured per .agents/documents/testing.md §7.

Commands:

```bash
npm run test          # full suite
npm run test:watch    # watch mode
npm run test -- --coverage   # with V8 coverage report
npx vitest run src/mcp/tests/memory.write.test.ts   # scoped to one file
```

## Commit Conventions

This repository follows [Conventional Commits](https://www.conventionalcommits.org/) with a task-code footer for traceability:

- Format: `type(scope): description` — e.g. `feat(dashboard): add arena minimap`, `fix(deps): pin js-yaml (CVE)`.
- Reference the active MCP task in the commit body or subject as `[TASK-xxx]` — e.g. `feat(dashboard): [TASK-281] arena UI component tests`.
- Types: `feat` / `fix` (behavior), `docs` (documentation), `test` (tests), `refactor` (no behavior change), `chore` (maintenance).
- If the change fixes a GitHub issue, append `keyword #N` as the footer (e.g. `fix #1423`).

## Quality Standards (Strict Rules)

- **Local-First:** Do not add cloud dependencies or external APIs without deep discussion.
- **SQLite by default:** All data persistence uses SQLite by default (zero-config, local-first). Optional multi-DB adapters (PostgreSQL/MariaDB/MySQL) are permitted only as an explicit, opt-in capability — see ADR-009.
- **Strict Anti-Hallucination:** Do not lower the semantic search thresholds below the project's security standards.

## ⚠️ No Warranty & Liability

By contributing, you acknowledge that this project is provided **"AS IS"** without any warranty. You agree that the authors and maintainers are not liable for any damages arising from the use of this software.

## License

By contributing, you agree that your contributions will be licensed under the project's MIT License.
