-- Cross-project agent message inbox/queue (docs/agent-messaging.md).
--
-- A directed, claim-once mailbox between projects: an agent in one project
-- (the sender coordinate) drops a message addressed to another project (the
-- recipient coordinate); the next session working in the recipient project
-- pops it exactly once. This is the ONE place ai-memory deliberately crosses
-- the per-project isolation boundary (AGENTS.md invariant #4/#16), so the
-- crossing is explicit and bidirectionally scoped: a project can only ever
-- read mail addressed TO it (its inbox) or sent FROM it (its outbox). No
-- query joins across a third project.
--
-- State machine: 'pending' -> 'claimed' (popped exactly once, mirroring the
-- handoff 'open' -> 'accepted' compare-and-set) or 'pending' -> 'cancelled'
-- (the sender retracts before it is popped). A claimed/cancelled row stays for
-- audit rather than being deleted (supersession-not-destruction).
--
-- Access model: messages are addressed to a PROJECT, not an operator, so any
-- session in the recipient project may pop (the inbox is shared knowledge, like
-- pages; the pop is the claim-once baton). `from_owner_user`/`claimed_by_user`
-- are attribution/audit only and are NEVER a read filter.
--
-- Security: `body`/`subject` are secret-scrubbed and size-capped at the MCP
-- layer and re-bound here (the store is the last gate). A popped message is
-- untrusted cross-project input — the recipient fences it as data, never
-- instructions. `ON DELETE CASCADE` on both coordinate pairs means a purged
-- workspace/project takes its mail with it.

CREATE TABLE agent_messages (
    id                 BLOB PRIMARY KEY NOT NULL,
    from_workspace_id  BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    from_project_id    BLOB NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
    from_agent         TEXT NOT NULL,
    from_session_id    BLOB REFERENCES sessions(id) ON DELETE SET NULL,
    from_owner_user    TEXT,                                   -- attribution only, never a read filter
    to_workspace_id    BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    to_project_id      BLOB NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
    subject            TEXT,
    body               TEXT NOT NULL,
    state              TEXT NOT NULL DEFAULT 'pending'
                         CHECK (state IN ('pending','claimed','cancelled')),
    created_at         INTEGER NOT NULL,
    claimed_at         INTEGER,
    claimed_by_session BLOB REFERENCES sessions(id) ON DELETE SET NULL,
    claimed_by_agent   TEXT,
    claimed_by_user    TEXT,
    FOREIGN KEY (from_session_id)    REFERENCES sessions(id) ON DELETE SET NULL,
    FOREIGN KEY (claimed_by_session) REFERENCES sessions(id) ON DELETE SET NULL
);

-- Inbox read + pop-next: oldest pending addressed to a recipient project.
CREATE INDEX idx_agent_messages_inbox
    ON agent_messages(to_workspace_id, to_project_id, created_at)
    WHERE state = 'pending';

-- Outbox read + sender retract: pending mail a project has sent.
CREATE INDEX idx_agent_messages_outbox
    ON agent_messages(from_workspace_id, from_project_id, created_at)
    WHERE state = 'pending';
