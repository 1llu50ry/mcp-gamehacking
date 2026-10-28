-- Preserve the exact cross-harness source selected at prepare time. Linking
-- the destination session updates native-session recency before SessionStart
-- renders its packet, so this cannot be reconstructed later from timestamps.

ALTER TABLE managed_runs ADD COLUMN previous_agent_kind TEXT;
ALTER TABLE managed_runs ADD COLUMN previous_native_session_id TEXT;
