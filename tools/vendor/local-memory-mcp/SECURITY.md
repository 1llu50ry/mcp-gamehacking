# Security Policy

Thank you for helping keep `@vheins/local-memory-mcp` and its users safe. This
document describes which versions receive security updates and how to report a
vulnerability.

## Supported Versions

Only the **latest release** of `@vheins/local-memory-mcp` is actively supported
with security updates. Please always upgrade to the most recent version — check
the [npm releases](https://www.npmjs.com/package/@vheins/local-memory-mcp) or
the [`CHANGELOG.md`](CHANGELOG.md) for the current version.

| Version  | Supported        |
| :------- | :--------------- |
| Latest   | ✅ Supported     |
| < Latest | ❌ Not supported |

## Reporting a Vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.
Instead, report them privately using one of the following channels:

- **GitHub Private Vulnerability Reporting:**
  [github.com/vheins/local-memory-mcp/security/advisories](https://github.com/vheins/local-memory-mcp/security/advisories)
  (preferred — enables coordinated fixes and disclosure).
- **Maintainer contact:** `NAME@example.com` — **placeholder: replace with the
  maintainer's contact email before publishing this file.**

When reporting, please include as much of the following as possible:

- The **package version** affected (check `package-lock.json` or
  `node_modules/@vheins/local-memory-mcp/package.json`).
- A **description** of the vulnerability and its type (e.g. injection, RCE,
  path traversal, denial of service).
- **Steps to reproduce** (a minimal code snippet or configuration).
- The **impact** of the vulnerability (what an attacker could do, affected
  features such as SQLite storage, the dashboard API, or the `codebase-index`
  parsers).
- Any **suggested fix** or mitigation, if you have one.

### Disclosure Process

We practice **coordinated disclosure**:

1. You report privately (as above).
2. We acknowledge your report and investigate, keeping you informed of progress.
3. We prepare and release a fix, then disclose the vulnerability publicly after
   the fix is available.

Please **do not publicly disclose any details** of the vulnerability (including
in issues, pull requests, or social media) **before the fix is released** and we
have coordinated with you. This protects all users of the package.

We aim to acknowledge vulnerability reports within **5 business days** of receipt.

## Scope

This policy covers the `@vheins/local-memory-mcp` codebase hosted at
[github.com/vheins/local-memory-mcp](https://github.com/vheins/local-memory-mcp),
including the MCP server (`src/mcp/`), the dashboard (`src/dashboard/`), and
their shipped build artifacts. Third-party dependencies should be reported
through their respective projects; if a vulnerability in a dependency affects
this package, we will address it via dependency updates and overrides.
