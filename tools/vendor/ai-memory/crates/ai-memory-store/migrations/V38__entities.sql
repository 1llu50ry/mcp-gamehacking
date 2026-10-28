-- Entity index: the noun layer of the wiki, used as a fourth retrieval
-- stream alongside FTS5, vector cosine, and page-link neighbours.
--
-- Entities come from the frontmatter `entities:` list that the
-- consolidator writes (extraction happens where an LLM already runs, so
-- the zero-LLM default path is untouched — an empty table simply
-- contributes nothing, exactly like the vector stream with no embedder).
-- Markdown stays the source of truth: `reindex` rebuilds both tables
-- from the files, same contract as `links`.
--
-- Query-time matching is lexical (exact + prefix over `name`), never an
-- LLM call.
--
-- Deliberately a plain noun table, not a triple store. This migration
-- ships only the retrieval index used by current callers.
CREATE TABLE entities (
    id            BLOB PRIMARY KEY,
    workspace_id  BLOB NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id    BLOB NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- Lowercase-normalized surface form; uniqueness is per project so
    -- two projects can each have their own `postgres` entity.
    name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
    created_at    INTEGER NOT NULL,
    UNIQUE (workspace_id, project_id, name)
);

CREATE TABLE entity_page_links (
    entity_id  BLOB NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    page_id    BLOB NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    PRIMARY KEY (entity_id, page_id)
);

-- Reverse lookup for the retrieval stream (page → entities) and for
-- replacing a page's entity set on rewrite.
CREATE INDEX idx_entity_page_links_page ON entity_page_links(page_id);
-- Prefix matching (`name LIKE 'postg%'`) rides this index.
CREATE INDEX idx_entities_name ON entities(workspace_id, project_id, name);

-- The project id alone is not enough: preserve the universal
-- (workspace_id, project_id) identity pairing at the storage boundary.
CREATE TRIGGER entities_ws_proj_pairing_ai
BEFORE INSERT ON entities
WHEN NOT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = NEW.project_id AND p.workspace_id = NEW.workspace_id
)
BEGIN
    SELECT RAISE(ABORT, 'entities workspace/project mismatch');
END;

-- An entity may only link to a page version in the same project scope.
CREATE TRIGGER entity_page_links_scope_pairing_ai
BEFORE INSERT ON entity_page_links
WHEN NOT EXISTS (
    SELECT 1
    FROM entities e
    JOIN pages p ON p.id = NEW.page_id
    WHERE e.id = NEW.entity_id
      AND e.workspace_id = p.workspace_id
      AND e.project_id = p.project_id
)
BEGIN
    SELECT RAISE(ABORT, 'entity/page scope mismatch');
END;
