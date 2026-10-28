-- Session-bound startup claims are released when the exact receiver exits
-- without substantive work. Both the duplicate-claim guard and release path
-- look up accepted rows by receiver session.
CREATE INDEX idx_handoffs_accepted_session
    ON handoffs (accepted_by_session, accepted_at DESC)
    WHERE state = 'accepted' AND accepted_by_session IS NOT NULL;
