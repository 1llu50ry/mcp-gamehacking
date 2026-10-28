-- Per-client MCP tool-call counters, bucketed by UTC day.
--
-- Hook-driven agents surface in `sessions.agent_kind` (and the
-- `/admin/sessions/by-agent` aggregate), but MCP-only clients — VS Code
-- Copilot, Claude Desktop, ad-hoc scripts — never fire a lifecycle hook,
-- so they were invisible to "where is this server's memory traffic
-- coming from". This table records what those clients actually do:
-- tool calls, split into reads and writes.
--
-- `client` is the sanitized MCP `clientInfo.name` from the initialize
-- handshake when the HTTP transport runs stateful, else the
-- `X-Memory-Actor-Agent` overlay when an ingress proxy asserts one,
-- else the literal 'unknown'. MCP client names remain an open set rather
-- than being forced through the `AgentKind` CHECK, but the write boundary
-- caps both label length and distinct labels per UTC day. Labels beyond
-- that daily budget fold into the stable 'other' bucket.
--
-- One row per (client, day), capped to 128 named clients plus 'other',
-- keeps growth bounded by the calendar rather than request traffic.
CREATE TABLE client_activity (
    client  TEXT NOT NULL CHECK (length(client) BETWEEN 1 AND 64),
    day     INTEGER NOT NULL,             -- UTC days since the epoch
    reads   INTEGER NOT NULL DEFAULT 0 CHECK (reads >= 0),
    writes  INTEGER NOT NULL DEFAULT 0 CHECK (writes >= 0),
    PRIMARY KEY (client, day)
) WITHOUT ROWID;
