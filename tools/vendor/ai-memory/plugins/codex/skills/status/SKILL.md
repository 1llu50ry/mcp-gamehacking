---
name: status
description: Check whether ai-memory is capturing this session and its memory tools can reach the server. Run it when memory looks missing or after installing or upgrading ai-memory.
disable-model-invocation: true
---

# ai-memory status

Report on the ai-memory install this session uses. Only report: do not
change any file, setting or hook, and do not run any command other than the
two below.

1. Run `ai-memory --version`. If the command is not found, say that the
   ai-memory binary is not installed (or not on `PATH`), that this session is
   therefore not captured while the memory tools may still answer from an
   ai-memory server, and point to
   <https://github.com/akitaonrails/ai-memory#install>. Stop there.
2. Run `ai-memory doctor` in the current project directory.

Summarize the doctor output in a few short lines:

- whether the server answered, and which server URL it used;
- the workspace and project this directory maps to;
- capture coverage for this agent, and any agent it flags as uncaptured;
- the hook spool backlog, if any events are waiting;
- duplicate wiring: the ai-memory plugin and settings-file hooks (or
  installed skills) both active, and which one doctor suggests keeping;
- for Codex, any ai-memory hook Codex skips as `untrusted` or `modified`
  (the user trusts them in `/hooks`);
- the ai-memory plugin version against the binary version, when they differ.

Quote problems as doctor states them, and leave every fix to the user.
