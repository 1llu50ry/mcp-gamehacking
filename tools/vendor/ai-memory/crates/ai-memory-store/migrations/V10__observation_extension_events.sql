-- Optional third-party event metadata.
--
-- Core observation.kind remains the closed ai-memory lifecycle enum. These
-- nullable fields preserve an opt-in extension namespace + source event name
-- for custom event vocabularies without letting unknown hook event names sprawl
-- into the canonical kind column.

ALTER TABLE observations ADD COLUMN extension TEXT;
ALTER TABLE observations ADD COLUMN source_event TEXT;

CREATE INDEX idx_observations_extension_event
    ON observations(workspace_id, project_id, extension, source_event, created_at)
    WHERE extension IS NOT NULL AND source_event IS NOT NULL;
