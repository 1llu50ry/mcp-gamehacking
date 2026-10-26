# Security Policy

## Supported Versions

We actively maintain and provide security updates for the latest code on the `main` branch of the `mcp-gamehacking` repository. If you are running an outdated version, please update before reporting a vulnerability.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| < 1.0   | :x:                |

---

## Disclaimer & Ethical Use

**mcp-gamehacking** is a tool designed exclusively for security research, reverse engineering education, software analysis, and the development of defensive mechanisms (anti-cheat systems).

* **Legal Use:** Reverse engineering tools and process memory management should only be used against software you own or applications where you have **explicit written permission** to conduct security testing (e.g., authorized penetration testing or bug bounty programs).
* **Liability:** The maintainers assume no liability and are not responsible for any misuse, account bans, terms of service breaches, or legal consequences resulting from unauthorized use of this software.

---

## Reporting a Vulnerability

We take the security of the `mcp-gamehacking` project seriously — including the MCP server codebase, system tools, and knowledge base assets processed by AI agents.

### What to Report:
* Vulnerabilities within the MCP server implementation (e.g., arbitrary code execution, path traversal when reading knowledge bases, insecure IPC/RPC calls, or prompt/tool injection risks).
* Unintentional leaks of sensitive credentials, tokens, or private data within the repository.

### How to Report:
Please **do not open public GitHub Issues** to report security vulnerabilities.

Instead, submit your report confidentially via:
* **GitHub Private Vulnerability Reporting:** Go to the repository's *Security* tab -> *Advisories* -> *Report a vulnerability*.
* Alternatively, reach out directly to the maintainers listed on the repository profile.

### Resolution Process:
1. **Acknowledgment:** We will acknowledge receipt of your vulnerability report within **48 hours**.
2. **Investigation:** We will evaluate the report, verify the issue, and determine its impact.
3. **Remediation:** A patch will be created and released promptly. Responsible disclosure credits will be attributed in the Release Notes if desired.

---

## Security Best Practices for Users

Because this project interfaces with system processes, debuggers, and AI agents through the Model Context Protocol (MCP), please observe the following security precautions:

1. **Environment Isolation:** Run the MCP server and target executables inside isolated environments (such as dedicated virtual machines or sandboxed containers) to prevent unintended side effects on your host system.
2. **Principle of Least Privilege:** Avoid running the MCP server with elevated privileges (`Administrator` / `root`) unless explicitly required by the debugging context.
3. **Audit Third-Party Prompts & Skills:** Inspect custom agent prompts, skill definitions, and external knowledge bases for dangerous system commands (`exec`, file overwrites) before integrating them into your agent workflow.
4. **Path Sandbox (v4.5+):** When exposing the server over HTTP, set `MCP_FS_ALLOW=/path/a,/path/b` to restrict file-reading tools (`pe_parse`, `elf_parse`, `aob_scan`, `zip_parse`, `analyze_binary`, …) to the directories you intend. Set `MCP_FS_DENY=...` to blacklist specific subtrees. Verify current config with the `fs_sandbox_status` tool.
5. **Rate Limiter (v4.6+, opt-in):** `MCP_RATE_LIMIT=1` enables token-bucket limiting per `(tool, agent)`. Tune per-tool with `MCP_RATE_LIMIT_<TOOL>=<perSec>`.
6. **Audit Log (v4.6+):** The server appends every `audit_log` call (and `rate_limit_check`) to `.audit/audit.jsonl`. Rotate the directory per deploy.
