-- Fix the materialized view to include game_type field for API compatibility
-- This addresses the API expectation for gameType field

-- Drop and recreate the materialized view with game_type field
DROP MATERIALIZED VIEW IF EXISTS cross_version_functions CASCADE;

CREATE MATERIALIZED VIEW cross_version_functions AS
SELECT
    d.id as function_id,
    d.name_func,
    d.addr,
    d.id_signature,
    e.name_exec,
    e.architecture,
    -- Map family_type with proper game type mapping for unified binaries
    CASE
        WHEN get_family_for_exception(e.name_exec) != 'Unified' THEN get_family_for_exception(e.name_exec)
        WHEN e.game_version IN ('1.00', '1.01', '1.02', '1.03', '1.04', '1.04b', '1.04c', '1.05', '1.05b', '1.06', '1.06b')
        THEN 'Classic'
        ELSE 'LoD'
    END as family_type,
    -- Add game_type as an alias for API compatibility
    CASE
        WHEN get_family_for_exception(e.name_exec) != 'Unified' THEN get_family_for_exception(e.name_exec)
        WHEN e.game_version IN ('1.00', '1.01', '1.02', '1.03', '1.04', '1.04b', '1.04c', '1.05', '1.05b', '1.06', '1.06b')
        THEN 'Classic'
        ELSE 'LoD'
    END as game_type,
    e.game_version as version,
    e.md5,

    -- Cross-version analysis metrics
    COALESCE(fev.cross_version_matches, 0) as cross_version_matches,
    COALESCE(fev.avg_cross_version_similarity, 0.0) as avg_cross_version_similarity,
    COALESCE(fev.max_cross_version_similarity, 0.0) as max_cross_version_similarity,
    COALESCE(fev.versions_with_matches, 0) as versions_with_matches,
    COALESCE(fev.function_group_id, 0) as function_group_id,
    COALESCE(fev.canonical_function_name, d.name_func) as canonical_function_name,
    COALESCE(fev.group_function_count, 1) as group_function_count,
    COALESCE(fev.group_version_count, 1) as group_version_count,

    -- Enhanced signature data
    COALESCE(es.signature_quality, 0.5) as signature_quality,
    COALESCE(es.feature_count, 0) as feature_count

FROM desctable d
JOIN exetable e ON d.id_exe = e.id
LEFT JOIN function_evolution fev ON fev.function_id = d.id
LEFT JOIN enhanced_signatures es ON es.function_id = d.id
WHERE e.game_version IS NOT NULL
ORDER BY d.name_func, e.game_version;

-- Create indexes for performance
CREATE INDEX idx_cross_version_functions_game_type ON cross_version_functions(game_type);
CREATE INDEX idx_cross_version_functions_family_type ON cross_version_functions(family_type);
CREATE INDEX idx_cross_version_functions_version ON cross_version_functions(version);
CREATE INDEX idx_cross_version_functions_name ON cross_version_functions(name_func);
CREATE INDEX idx_cross_version_functions_matches ON cross_version_functions(cross_version_matches);
CREATE INDEX idx_cross_version_functions_similarity ON cross_version_functions(avg_cross_version_similarity);
CREATE INDEX idx_cross_version_functions_md5 ON cross_version_functions(md5);

-- Update API views to use both game_type and family_type
DROP VIEW IF EXISTS api_cross_version_functions CASCADE;

CREATE OR REPLACE VIEW api_cross_version_functions AS
SELECT
    function_id,
    name_func as function_name,
    addr as address,
    name_exec as executable_name,
    game_type,  -- Use the new game_type field
    family_type, -- Keep family_type for backward compatibility
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

-- Update API versions view to use the new structure
DROP VIEW IF EXISTS api_versions CASCADE;

CREATE OR REPLACE VIEW api_versions AS
SELECT DISTINCT
    CONCAT(game_type, '/', version) as folder_name,
    game_type,
    version,
    COUNT(DISTINCT name_exec) as file_count,
    COUNT(DISTINCT function_id) as change_count,
    CASE WHEN game_type = 'LoD' THEN true ELSE false END as is_lod,
    CONCAT('1, 0, ', REPLACE(REPLACE(version, '.', ', '), REGEXP_REPLACE(version, '[a-z]$', ''), ''), ', 0') as raw_pe_version,
    'Unknown' as total_size_readable,
    'unknown' as nocd_status
FROM cross_version_functions
WHERE game_type IS NOT NULL
GROUP BY game_type, version
ORDER BY folder_name;

SELECT 'Materialized view updated with game_type field for API compatibility' as status;