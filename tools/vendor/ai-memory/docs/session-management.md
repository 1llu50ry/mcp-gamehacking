# Self-service session management

Start the HTTP server with `--enable-session-management`
(`AI_MEMORY_ENABLE_SESSION_MANAGEMENT=true`). It is off by default and
requires `--transport http`. This enables `/management/v1/projects`,
`/management/v1/sessions`, `/management/v1/sessions/{id}/observations`, and
`/management/v1/sessions/{id}/purge` for existing human browser sessions.
Machine bearers and password-change-required sessions are refused; mutations
require the existing CSRF cookie/header pair.

Listings require explicit workspace/project scope and return `page_size`.
Users see their own and shared legacy sessions, but can delete only an exactly
owned session with current project write access. Admins may inspect and purge
any session. Ownership and grants are checked again in the writer transaction;
shared sessions and cross-project collateral require an Admin. Pages remain
shared within authorized projects; attribution never becomes a page read filter.

POST purge with `dry_run: true` to preview, or `confirm: true` to delete. A preview
has no disk, audit, or admission effects. Confirmed purges use the canonical wiki
mutation lock, admission webhooks, pre/post git checkpoints, and replay tombstones.
Maintained knowledge and later manual page versions survive. Database purges
cannot be rolled back after file cleanup fails: `files_failed` reports the
remaining paths, and recovery honors the tombstone. Git history, backups, and
native transcripts can retain earlier content.

Run `cargo t -p ai-memory-mcp -E 'test(/session_management/)'`,
`cargo t -p ai-memory-store -E 'test(/owned_session_purge/)'`, and
`cargo t -p ai-memory-wiki -E 'test(/owned_session_purge/)'` for the boundary tests.
