-- Hybrid Cross-Version Approach: Best of Both Worlds
--
-- Strategy:
-- 1. Use normalized FK relationships for data input (flexible, maintainable)
-- 2. Create materialized views with version columns for web display (fast reads)
-- 3. Refresh materialized views when data changes

-- ============================================================================
-- PART 1: Normalized Data Storage (for script input)
-- ============================================================================

-- Generic function equivalence table (populated by scripts)
CREATE TABLE IF NOT EXISTS function_equivalence (
    id BIGSERIAL PRIMARY KEY,
    canonical_name VARCHAR(256) NOT NULL,
    binary_name VARCHAR(128) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(canonical_name, binary_name)
);

-- Links specific functions to equivalence groups
CREATE TABLE IF NOT EXISTS function_equivalence_members (
    id BIGSERIAL PRIMARY KEY,
    equivalence_id BIGINT REFERENCES function_equivalence(id) ON DELETE CASCADE,
    function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    game_version VARCHAR(16) NOT NULL,
    similarity_score REAL DEFAULT 1.0,  -- 1.0 = exact, 0.9+ = high confidence, etc.
    confidence_level VARCHAR(16) DEFAULT 'exact', -- 'exact', 'high', 'medium', 'low'
    UNIQUE(equivalence_id, function_id)
);

CREATE INDEX IF NOT EXISTS idx_equiv_members_equiv ON function_equivalence_members(equivalence_id);
CREATE INDEX IF NOT EXISTS idx_equiv_members_function ON function_equivalence_members(function_id);
CREATE INDEX IF NOT EXISTS idx_equiv_members_version ON function_equivalence_members(game_version);

-- ============================================================================
-- PART 2: Fast Read Materialized Views (for web display)
-- ============================================================================

-- Cross-version matrix optimized for your web display
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_cross_version_matrix AS
SELECT
    fe.id as equivalence_id,
    fe.canonical_name,
    fe.binary_name,

    -- Version columns with function names and similarity info
    MAX(CASE WHEN fem.game_version = '1.00' THEN
        jsonb_build_object(
            'name', d.name_func,
            'id', d.id,
            'addr', d.addr,
            'similarity', fem.similarity_score,
            'confidence', fem.confidence_level
        ) END) as v1_00,

    MAX(CASE WHEN fem.game_version = '1.07' THEN
        jsonb_build_object(
            'name', d.name_func,
            'id', d.id,
            'addr', d.addr,
            'similarity', fem.similarity_score,
            'confidence', fem.confidence_level
        ) END) as v1_07,

    MAX(CASE WHEN fem.game_version = '1.09d' THEN
        jsonb_build_object(
            'name', d.name_func,
            'id', d.id,
            'addr', d.addr,
            'similarity', fem.similarity_score,
            'confidence', fem.confidence_level
        ) END) as v1_09d,

    MAX(CASE WHEN fem.game_version = '1.13c' THEN
        jsonb_build_object(
            'name', d.name_func,
            'id', d.id,
            'addr', d.addr,
            'similarity', fem.similarity_score,
            'confidence', fem.confidence_level
        ) END) as v1_13c,

    MAX(CASE WHEN fem.game_version = '1.13d' THEN
        jsonb_build_object(
            'name', d.name_func,
            'id', d.id,
            'addr', d.addr,
            'similarity', fem.similarity_score,
            'confidence', fem.confidence_level
        ) END) as v1_13d,

    MAX(CASE WHEN fem.game_version = '1.14d' THEN
        jsonb_build_object(
            'name', d.name_func,
            'id', d.id,
            'addr', d.addr,
            'similarity', fem.similarity_score,
            'confidence', fem.confidence_level
        ) END) as v1_14d,

    -- Metadata for sorting and filtering
    COUNT(fem.id) as version_count,
    MAX(fem.similarity_score) as max_similarity,
    MIN(fem.similarity_score) as min_similarity,

    -- Focus version support (which version is the "primary" one)
    (SELECT game_version FROM function_equivalence_members fem2
     WHERE fem2.equivalence_id = fe.id
     AND fem2.similarity_score = 1.0
     LIMIT 1) as focus_version

FROM function_equivalence fe
LEFT JOIN function_equivalence_members fem ON fe.id = fem.equivalence_id
LEFT JOIN desctable d ON fem.function_id = d.id
GROUP BY fe.id, fe.canonical_name, fe.binary_name;

-- Index for fast web queries
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_cross_version_equiv ON mv_cross_version_matrix(equivalence_id);
CREATE INDEX IF NOT EXISTS idx_mv_cross_version_binary ON mv_cross_version_matrix(binary_name);
CREATE INDEX IF NOT EXISTS idx_mv_cross_version_focus ON mv_cross_version_matrix(focus_version);

-- ============================================================================
-- PART 3: Helper Functions for Web Display
-- ============================================================================

-- Function to get cross-version matrix for a specific binary with focus version
CREATE OR REPLACE FUNCTION get_cross_version_matrix(
    p_binary_name TEXT,
    p_focus_version TEXT DEFAULT NULL
) RETURNS TABLE (
    canonical_name TEXT,
    v1_00 JSONB,
    v1_07 JSONB,
    v1_09d JSONB,
    v1_13c JSONB,
    v1_13d JSONB,
    v1_14d JSONB,
    focus_version TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.canonical_name,
        m.v1_00,
        m.v1_07,
        m.v1_09d,
        m.v1_13c,
        m.v1_13d,
        m.v1_14d,
        m.focus_version
    FROM mv_cross_version_matrix m
    WHERE m.binary_name = p_binary_name
    AND (p_focus_version IS NULL OR m.focus_version = p_focus_version)
    ORDER BY m.canonical_name;
END;
$$ LANGUAGE plpgsql;

-- Function to refresh materialized view (call after data updates)
CREATE OR REPLACE FUNCTION refresh_cross_version_matrix()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cross_version_matrix;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 4: Example Usage for Your Web Interface
-- ============================================================================

-- Web query example (super fast - single table scan)
/*
SELECT
    canonical_name,
    v1_13d->>'name' as focus_function,  -- Focus version in center
    v1_07->>'name' as v1_07_match,      -- Matches on left/right
    v1_14d->>'name' as v1_14d_match,
    v1_13d->>'confidence' as confidence_level  -- For color coding
FROM mv_cross_version_matrix
WHERE binary_name = 'D2Game.dll'
AND focus_version = '1.13d'  -- User selected focus version
ORDER BY canonical_name;
*/

-- Color coding logic for web interface:
/*
CSS classes based on confidence_level:
- 'exact' -> green text
- 'high' -> orange text
- 'medium' -> red text
- 'low' -> gray text
*/

COMMENT ON MATERIALIZED VIEW mv_cross_version_matrix IS
'Fast cross-version function matrix for web display. Combines normalized data into version columns.';

COMMENT ON FUNCTION get_cross_version_matrix IS
'Optimized function for web interface to get cross-version matrix with focus version support.';