-- Add patch proposal metadata while preserving existing full-page rows.

ALTER TABLE auto_improve_proposals
    ADD COLUMN edit_mode TEXT NOT NULL DEFAULT 'full_page'
        CHECK (edit_mode IN ('full_page','patch'));

ALTER TABLE auto_improve_proposals
    ADD COLUMN patch_json TEXT;

ALTER TABLE auto_improve_proposals
    ADD COLUMN expected_base_body_sha256 BLOB;

ALTER TABLE auto_improve_proposals
    ADD COLUMN materialized_base_body_sha256 BLOB;
