-- Cross-session abstraction ("experience") pass state — 2.0 item 6.
-- One nullable column on the existing per-scope scheduler row: when the
-- pass last ran. NULL = never; the cadence rule compares completed
-- sessions' ended_at against COALESCE(this, initialized_at), so
-- enabling the pass on an old store does not immediately re-digest all
-- of history.
ALTER TABLE auto_improve_scheduler_state ADD COLUMN last_experience_run_at INTEGER;
