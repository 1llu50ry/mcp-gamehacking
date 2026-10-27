-- Updated BSim Schema: Single Version System
-- Author: Claude Code Assistant
-- Date: 2026-01-16
-- Purpose: Remove version_family, handle unified versions with exception binaries

-- ============================================================================
-- SCHEMA UPDATES FOR SINGLE VERSION SYSTEM
-- ============================================================================

-- Remove version_family constraint (if exists)
ALTER TABLE exetable DROP CONSTRAINT IF EXISTS require_version_family;
ALTER TABLE exetable DROP CONSTRAINT IF EXISTS require_versioned_filename;

-- Update game_version constraint to allow exception binaries
ALTER TABLE exetable DROP CONSTRAINT IF EXISTS require_game_version;
ALTER TABLE exetable ADD CONSTRAINT require_game_version
CHECK (game_version ~ '^1\.[0-9]+[a-z]?$');

-- Add constraint for proper naming convention
ALTER TABLE exetable ADD CONSTRAINT proper_executable_naming
CHECK (
    -- Standard unified binaries: 1.03_D2Game.dll
    name_exec ~ '^1\.[0-9]+[a-z]?_[A-Za-z0-9_]+\.(dll|exe)$'
    OR
    -- Exception binaries: Classic_1.03_Game.exe, LoD_1.13c_Game.exe
    name_exec ~ '^(Classic|LoD)_1\.[0-9]+[a-z]?_(Game|Diablo_II)\.(exe|dll)$'
);

-- ============================================================================
-- FUNCTION TO EXTRACT VERSION FROM UNIFIED NAMING
-- ============================================================================

CREATE OR REPLACE FUNCTION extract_version_from_name(executable_name TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Extract version from unified naming convention
    -- 1.03_D2Game.dll -> 1.03
    -- Classic_1.03_Game.exe -> 1.03
    -- LoD_1.13c_Game.exe -> 1.13c

    IF executable_name ~ '^1\.[0-9]+[a-z]?_' THEN
        -- Standard unified binary: extract version from "1.03_D2Game.dll"
        RETURN (regexp_match(executable_name, '^(1\.[0-9]+[a-z]?)_'))[1];
    ELSIF executable_name ~ '^(Classic|LoD)_1\.[0-9]+[a-z]?_' THEN
        -- Exception binary: extract version from "Classic_1.03_Game.exe"
        RETURN (regexp_match(executable_name, '^(Classic|LoD)_(1\.[0-9]+[a-z]?)_'))[2];
    ELSE
        RETURN NULL;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Test the function
SELECT
    '1.03_D2Game.dll'::text as input,
    extract_version_from_name('1.03_D2Game.dll') as extracted_version
UNION ALL
SELECT
    'Classic_1.03_Game.exe'::text as input,
    extract_version_from_name('Classic_1.03_Game.exe') as extracted_version
UNION ALL
SELECT
    'LoD_1.13c_Game.exe'::text as input,
    extract_version_from_name('LoD_1.13c_Game.exe') as extracted_version;

-- ============================================================================
-- FUNCTION TO IDENTIFY EXCEPTION BINARIES
-- ============================================================================

CREATE OR REPLACE FUNCTION is_exception_binary(executable_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    -- Check if this is an exception binary that differs between families
    RETURN executable_name ~ '^(Classic|LoD)_1\.[0-9]+[a-z]?_(Game|Diablo_II)\.(exe|dll)$';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION TO GET FAMILY FOR EXCEPTION BINARIES
-- ============================================================================

CREATE OR REPLACE FUNCTION get_family_for_exception(executable_name TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Extract family for exception binaries only
    IF is_exception_binary(executable_name) THEN
        RETURN substring(executable_name from '^(Classic|LoD)_');
    ELSE
        RETURN 'Unified'; -- Most binaries are unified across families
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- UPDATED CROSS-VERSION FUNCTIONS VIEW
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS cross_version_functions CASCADE;

CREATE MATERIALIZED VIEW cross_version_functions AS
SELECT DISTINCT
    d.id AS function_id,
    d.name_func,
    d.addr,
    d.id_signature,
    e.name_exec,
    e.architecture,
    -- Use family only for exception binaries, otherwise 'Unified'
    get_family_for_exception(e.name_exec) AS family_type,
    -- Extract version from filename, fallback to game_version field
    COALESCE(
        extract_version_from_name(e.name_exec),
        e.game_version,
        'Unknown'
    ) AS version,
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
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_family_type ON cross_version_functions(family_type);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_matches ON cross_version_functions(cross_version_matches);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_similarity ON cross_version_functions(avg_cross_version_similarity);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_md5 ON cross_version_functions(md5);

-- ============================================================================
-- UPDATED API VIEWS
-- ============================================================================

-- API-friendly view of cross-version function data
CREATE OR REPLACE VIEW api_cross_version_functions AS
SELECT
    function_id,
    name_func as function_name,
    addr as address,
    name_exec as executable_name,
    family_type,
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

-- Summary statistics view
CREATE OR REPLACE VIEW cross_version_statistics AS
SELECT
    COUNT(*) as total_functions,
    COUNT(*) FILTER (WHERE cross_version_matches > 0) as functions_with_matches,
    ROUND(AVG(cross_version_matches)::numeric, 2) as avg_matches_per_function,
    ROUND(AVG(avg_cross_version_similarity)::numeric, 3) as avg_similarity_score,
    COUNT(DISTINCT version) as total_versions,
    COUNT(DISTINCT family_type) as total_family_types,
    COUNT(DISTINCT function_group_id) FILTER (WHERE function_group_id > 0) as total_function_groups
FROM cross_version_functions;

-- ============================================================================
-- UPDATED VERSION FIELD POPULATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION populate_version_fields_from_filename()
RETURNS INTEGER AS $$
DECLARE
    affected_rows INTEGER;
BEGIN
    UPDATE exetable
    SET
        game_version = extract_version_from_name(name_exec),
        -- Clear version_family since we're not using it anymore
        version_family = NULL
    WHERE extract_version_from_name(name_exec) IS NOT NULL
      AND (game_version IS NULL OR game_version != extract_version_from_name(name_exec));

    GET DIAGNOSTICS affected_rows = ROW_COUNT;

    RAISE NOTICE 'Updated version fields for % executable records', affected_rows;
    RETURN affected_rows;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- DOCUMENTATION
-- ============================================================================

COMMENT ON FUNCTION extract_version_from_name(TEXT) IS 'Extract version from unified naming convention (1.03_D2Game.dll -> 1.03)';
COMMENT ON FUNCTION is_exception_binary(TEXT) IS 'Check if executable is an exception binary that differs between families';
COMMENT ON FUNCTION get_family_for_exception(TEXT) IS 'Get family type for exception binaries, returns Unified for standard binaries';

COMMENT ON COLUMN exetable.game_version IS 'Game version extracted from filename (e.g., 1.03, 1.13c) - unified across families';
COMMENT ON COLUMN exetable.version_family IS 'DEPRECATED: No longer used in single version system';

COMMENT ON MATERIALIZED VIEW cross_version_functions IS 'Cross-version function analysis using single version system with exception binary handling';
COMMENT ON VIEW api_cross_version_functions IS 'API-friendly view of cross-version function data with unified versions';
COMMENT ON VIEW cross_version_statistics IS 'Summary statistics for unified cross-version function matching';

-- ============================================================================
-- EXAMPLES AND VALIDATION
-- ============================================================================

-- Show expected naming conventions
SELECT 'Naming Convention Examples:' as info;
SELECT
    'Standard Binary' as type,
    '1.03_D2Game.dll' as example,
    extract_version_from_name('1.03_D2Game.dll') as extracted_version,
    is_exception_binary('1.03_D2Game.dll') as is_exception,
    get_family_for_exception('1.03_D2Game.dll') as family_type
UNION ALL
SELECT
    'Exception Binary' as type,
    'Classic_1.03_Game.exe' as example,
    extract_version_from_name('Classic_1.03_Game.exe') as extracted_version,
    is_exception_binary('Classic_1.03_Game.exe') as is_exception,
    get_family_for_exception('Classic_1.03_Game.exe') as family_type
UNION ALL
SELECT
    'Exception Binary' as type,
    'LoD_1.13c_Game.exe' as example,
    extract_version_from_name('LoD_1.13c_Game.exe') as extracted_version,
    is_exception_binary('LoD_1.13c_Game.exe') as is_exception,
    get_family_for_exception('LoD_1.13c_Game.exe') as family_type;