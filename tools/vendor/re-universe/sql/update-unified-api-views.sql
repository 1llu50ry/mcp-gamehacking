-- Update API views to properly handle unified version system
-- This addresses the issue where Unified binaries need to be accessible
-- through both Classic and LoD game type contexts

-- Enhanced API view that maps Unified binaries to appropriate game types
DROP VIEW IF EXISTS api_cross_version_functions CASCADE;

CREATE OR REPLACE VIEW api_cross_version_functions AS
-- Exception binaries (Game.exe, Diablo_II.exe) - keep their specific family types
SELECT
    function_id,
    name_func as function_name,
    addr as address,
    name_exec as executable_name,
    family_type as game_type,  -- Renamed for API consistency
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
WHERE family_type IN ('Classic', 'LoD')

UNION ALL

-- Unified binaries mapped to Classic context (for pre-LoD versions)
SELECT
    function_id,
    name_func as function_name,
    addr as address,
    name_exec as executable_name,
    CASE
        WHEN version IN ('1.00', '1.01', '1.02', '1.03', '1.04', '1.04b', '1.04c', '1.05', '1.05b', '1.06', '1.06b')
        THEN 'Classic'
        ELSE 'LoD'
    END as game_type,
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
WHERE family_type = 'Unified'

ORDER BY avg_cross_version_similarity DESC, cross_version_matches DESC;

-- Enhanced versions API view that properly maps unified versions
DROP VIEW IF EXISTS api_versions CASCADE;

CREATE OR REPLACE VIEW api_versions AS
-- Exception binaries provide their specific game type
SELECT DISTINCT
    CONCAT(family_type, '/', version) as folder_name,
    family_type as game_type,
    version,
    COUNT(DISTINCT name_exec) as file_count,
    COUNT(DISTINCT function_id) as change_count,
    CASE WHEN family_type = 'LoD' THEN true ELSE false END as is_lod,
    CONCAT('1, 0, ', REPLACE(REPLACE(version, '.', ', '), REGEXP_REPLACE(version, '[a-z]$', ''), ''), ', 0') as raw_pe_version,
    'Unknown' as total_size_readable,
    'unknown' as nocd_status
FROM cross_version_functions
WHERE family_type IN ('Classic', 'LoD')
GROUP BY family_type, version

UNION ALL

-- Unified binaries mapped appropriately based on version
SELECT DISTINCT
    CASE
        WHEN version IN ('1.00', '1.01', '1.02', '1.03', '1.04', '1.04b', '1.04c', '1.05', '1.05b', '1.06', '1.06b')
        THEN CONCAT('Classic/', version)
        ELSE CONCAT('LoD/', version)
    END as folder_name,
    CASE
        WHEN version IN ('1.00', '1.01', '1.02', '1.03', '1.04', '1.04b', '1.04c', '1.05', '1.05b', '1.06', '1.06b')
        THEN 'Classic'
        ELSE 'LoD'
    END as game_type,
    version,
    COUNT(DISTINCT name_exec) as file_count,
    COUNT(DISTINCT function_id) as change_count,
    CASE
        WHEN version IN ('1.00', '1.01', '1.02', '1.03', '1.04', '1.04b', '1.04c', '1.05', '1.05b', '1.06', '1.06b')
        THEN false
        ELSE true
    END as is_lod,
    CONCAT('1, 0, ', REPLACE(REPLACE(version, '.', ', '), REGEXP_REPLACE(version, '[a-z]$', ''), ''), ', 0') as raw_pe_version,
    'Unknown' as total_size_readable,
    'unknown' as nocd_status
FROM cross_version_functions
WHERE family_type = 'Unified'
GROUP BY version

ORDER BY folder_name;

-- Enhanced binaries API view that handles both exception and unified binaries
DROP VIEW IF EXISTS api_binaries CASCADE;

CREATE OR REPLACE VIEW api_binaries AS
-- All binaries with appropriate game type mapping using the family function
SELECT
    name_exec as filename,
    CASE
        WHEN get_family_for_exception(name_exec) != 'Unified' THEN get_family_for_exception(name_exec)
        WHEN game_version IN ('1.00', '1.01', '1.02', '1.03', '1.04', '1.04b', '1.04c', '1.05', '1.05b', '1.06', '1.06b')
        THEN 'Classic'
        ELSE 'LoD'
    END as game_type,
    game_version as version,
    md5,
    architecture,
    CAST(EXTRACT(EPOCH FROM ingest_date) AS INTEGER) as timestamp,
    'binary' as type
FROM exetable e
WHERE game_version IS NOT NULL

ORDER BY game_type, version, filename;

-- Comment the new views
COMMENT ON VIEW api_cross_version_functions IS 'API view that maps unified binaries to appropriate Classic/LoD contexts';
COMMENT ON VIEW api_versions IS 'API view that provides version information with unified binary mapping';
COMMENT ON VIEW api_binaries IS 'API view that provides binary listings with proper game type mapping';

-- Show successful deployment message
SELECT 'Enhanced API views deployed for unified version system support' as status;