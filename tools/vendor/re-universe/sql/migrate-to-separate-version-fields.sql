-- Migration Script: Convert from filename-based to separate version fields
-- Author: Claude Code Assistant
-- Date: 2026-01-16
-- Purpose: Move version info from filename parsing to proper database fields

-- ============================================================================
-- PHASE 1: POPULATE VERSION FIELDS FROM EXISTING FILENAMES
-- ============================================================================

-- Update game_version and version_family fields from existing filename conventions
UPDATE exetable
SET
    game_version = CASE
        WHEN name_exec ~ '_1\.14[a-z]?_' THEN substring(name_exec from '_(1\.14[a-z]?)_')
        WHEN name_exec ~ '_1\.13[a-z]?_' THEN substring(name_exec from '_(1\.13[a-z]?)_')
        WHEN name_exec ~ '_1\.12[a-z]?_' THEN substring(name_exec from '_(1\.12[a-z]?)_')
        WHEN name_exec ~ '_1\.11[a-z]?_' THEN substring(name_exec from '_(1\.11[a-z]?)_')
        WHEN name_exec ~ '_1\.10[a-z]?_' THEN substring(name_exec from '_(1\.10[a-z]?)_')
        WHEN name_exec ~ '_1\.0[0-9][a-z]?_' THEN substring(name_exec from '_(1\.0[0-9][a-z]?)_')
        WHEN name_exec ~ '_1\.00_' THEN '1.00'
        ELSE NULL
    END,
    version_family = CASE
        WHEN name_exec ~ '^Classic_' THEN 'Classic'
        WHEN name_exec ~ '^LoD_' THEN 'LoD'
        WHEN name_exec ~ '^D2R_' THEN 'D2R'
        ELSE NULL
    END
WHERE name_exec ~ '^(Classic|LoD|D2R)_1\.[0-9]+[a-z]?_'
  AND (game_version IS NULL OR version_family IS NULL);

-- ============================================================================
-- PHASE 2: ADD CONSTRAINTS AND INDEXES
-- ============================================================================

-- Add constraints for data integrity
ALTER TABLE exetable ADD CONSTRAINT valid_game_version
CHECK (game_version IS NULL OR game_version ~ '^1\.[0-9]+[a-z]?$');

ALTER TABLE exetable ADD CONSTRAINT valid_version_family
CHECK (version_family IS NULL OR version_family IN ('Classic', 'LoD', 'D2R'));

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_exetable_game_version ON exetable(game_version);
CREATE INDEX IF NOT EXISTS idx_exetable_version_family ON exetable(version_family);
CREATE INDEX IF NOT EXISTS idx_exetable_version_combo ON exetable(version_family, game_version);

-- ============================================================================
-- PHASE 3: UPDATE MATERIALIZED VIEW TO USE SEPARATE FIELDS
-- ============================================================================

-- Drop existing materialized view and recreate with proper field usage
DROP MATERIALIZED VIEW IF EXISTS cross_version_functions CASCADE;

CREATE MATERIALIZED VIEW cross_version_functions AS
SELECT DISTINCT
    d.id AS function_id,
    d.name_func,
    d.addr,
    d.id_signature,
    e.name_exec,
    e.architecture,
    -- Use database fields instead of filename parsing
    COALESCE(e.version_family, 'Other') AS game_type,
    COALESCE(e.game_version, 'Unknown') AS version,
    -- Generate MD5 for API compatibility
    md5(d.name_func || '::' || d.addr::text || '::' || e.name_exec) AS md5,
    -- Enhanced cross-version matching data
    COALESCE(similarity_stats.total_similarities, 0) AS cross_version_matches,
    COALESCE(similarity_stats.avg_similarity, 0.0) AS avg_cross_version_similarity,
    COALESCE(similarity_stats.max_similarity, 0.0) AS max_cross_version_similarity,
    COALESCE(similarity_stats.version_count, 0) AS versions_with_matches,
    0 AS function_group_id,
    d.name_func AS canonical_function_name,
    1 AS group_function_count,
    1 AS group_version_count,
    COALESCE(es.signature_quality, 0.0) AS signature_quality,
    COALESCE(es.feature_count, 0) AS feature_count
FROM desctable d
JOIN exetable e ON d.id_exe = e.id
LEFT JOIN enhanced_signatures es ON d.id = es.function_id
LEFT JOIN (
    SELECT
        fsm.source_function_id,
        COUNT(*) as total_similarities,
        AVG(fsm.similarity_score) as avg_similarity,
        MAX(fsm.similarity_score) as max_similarity,
        COUNT(DISTINCT te.game_version) as version_count
    FROM function_similarity_matrix fsm
    JOIN desctable td ON fsm.target_function_id = td.id
    JOIN exetable te ON td.id_exe = te.id
    WHERE fsm.similarity_score >= 0.7
      AND te.game_version IS NOT NULL
    GROUP BY fsm.source_function_id
) similarity_stats ON d.id = similarity_stats.source_function_id
ORDER BY d.name_func, e.name_exec;

-- Create indexes on the materialized view
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_name ON cross_version_functions(name_func);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_version ON cross_version_functions(version);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_game_type ON cross_version_functions(game_type);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_group ON cross_version_functions(function_group_id);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_matches ON cross_version_functions(cross_version_matches);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_similarity ON cross_version_functions(avg_cross_version_similarity);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_md5 ON cross_version_functions(md5);

-- ============================================================================
-- PHASE 4: RECREATE DEPENDENT VIEWS
-- ============================================================================

-- Recreate API view
CREATE OR REPLACE VIEW api_cross_version_functions AS
SELECT
    function_id,
    name_func as function_name,
    addr as address,
    name_exec as executable_name,
    game_type,
    version,
    md5,
    id_signature,
    cross_version_matches,
    avg_cross_version_similarity,
    max_cross_version_similarity,
    versions_with_matches,
    canonical_function_name,
    group_function_count,
    group_version_count,
    signature_quality,
    feature_count
FROM cross_version_functions
ORDER BY avg_cross_version_similarity DESC, cross_version_matches DESC;

-- Recreate statistics view
CREATE OR REPLACE VIEW cross_version_statistics AS
SELECT
    COUNT(*) as total_functions,
    COUNT(*) FILTER (WHERE cross_version_matches > 0) as functions_with_matches,
    ROUND(AVG(cross_version_matches)::numeric, 2) as avg_matches_per_function,
    ROUND(AVG(avg_cross_version_similarity)::numeric, 3) as avg_similarity_score,
    COUNT(DISTINCT version) as total_versions,
    COUNT(DISTINCT game_type) as total_game_types,
    COUNT(DISTINCT function_group_id) FILTER (WHERE function_group_id > 0) as total_function_groups
FROM cross_version_functions;

-- ============================================================================
-- PHASE 5: UPDATE FUNCTION_EVOLUTION TABLE
-- ============================================================================

-- Clear and repopulate function_evolution with clean data
DELETE FROM function_evolution;

INSERT INTO function_evolution (name_func, version_count, versions, confidence_score)
SELECT
    cvf.name_func,
    COUNT(DISTINCT cvf.version) as version_count,
    array_agg(DISTINCT cvf.version ORDER BY cvf.version) FILTER (WHERE cvf.version != 'Unknown') as versions,
    AVG(cvf.avg_cross_version_similarity) as confidence_score
FROM cross_version_functions cvf
WHERE cvf.version != 'Unknown'
  AND cvf.game_type != 'Other'
  AND cvf.cross_version_matches > 0
GROUP BY cvf.name_func
HAVING COUNT(DISTINCT cvf.version) >= 1;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Show migration results
SELECT 'Migration Results:' as status;

SELECT
    'Populated Fields' as metric,
    COUNT(*) FILTER (WHERE game_version IS NOT NULL) as game_version_count,
    COUNT(*) FILTER (WHERE version_family IS NOT NULL) as version_family_count,
    COUNT(*) as total_executables
FROM exetable;

SELECT
    'Version Distribution' as metric,
    version_family,
    game_version,
    COUNT(*) as count
FROM exetable
WHERE version_family IS NOT NULL AND game_version IS NOT NULL
GROUP BY version_family, game_version
ORDER BY version_family, game_version;

SELECT
    'Cross-Version Functions' as metric,
    game_type,
    version,
    COUNT(*) as function_count
FROM cross_version_functions
WHERE version != 'Unknown' AND game_type != 'Other'
GROUP BY game_type, version
ORDER BY game_type, version;

-- Add comments for documentation
COMMENT ON COLUMN exetable.game_version IS 'Game version extracted from filename (e.g., 1.13c, 1.14d)';
COMMENT ON COLUMN exetable.version_family IS 'Game type/family (Classic, LoD, D2R)';
COMMENT ON MATERIALIZED VIEW cross_version_functions IS 'Cross-version function analysis using separate version fields instead of filename parsing';