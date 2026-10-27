-- Create API views for web interface compatibility
-- This script creates the views needed by the BSim Analysis Portal web interface
--
-- Last Updated: January 18, 2026
-- Purpose: Web interface API compatibility layer

\echo 'Creating API views for web interface...'

-- Set search path
SET search_path TO public;

-- =========================================================================
-- CROSS VERSION FUNCTIONS VIEW (BASE)
-- =========================================================================

-- Create base cross_version_functions view from existing tables
CREATE OR REPLACE VIEW cross_version_functions AS
SELECT
    d.id as function_id,
    d.name_func,
    d.addr,
    e.name_exec,
    CASE
        WHEN gv.version_family IS NOT NULL THEN gv.version_family
        WHEN e.name_exec ~ '^Classic_.*\.(exe|dll)$' THEN 'Classic'
        WHEN e.name_exec ~ '^LoD_.*\.(exe|dll)$' THEN 'LoD'
        WHEN e.name_exec IN ('Game.exe', 'Diablo_II.exe') THEN 'Classic'
        ELSE 'Unified'
    END as family_type,
    COALESCE(gv.version_string, '0') as version,
    e.md5,
    d.id_signature,
    0 as cross_version_matches,  -- Default values for now
    0.0 as avg_cross_version_similarity,
    0.0 as max_cross_version_similarity,
    0 as versions_with_matches,
    d.name_func as canonical_function_name,
    1 as group_function_count,
    1 as group_version_count,
    COALESCE(es.confidence_score, 0.0) as signature_quality,
    1 as feature_count
FROM desctable d
JOIN exetable e ON d.id_exe = e.id
LEFT JOIN game_versions gv ON e.game_version = gv.id
LEFT JOIN enhanced_signatures es ON d.id = es.function_id;

-- =========================================================================
-- HELPER FUNCTION FOR BINARY CLASSIFICATION
-- =========================================================================

-- Create function to determine family type for exception binaries
CREATE OR REPLACE FUNCTION get_family_for_exception(executable_name TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Handle exception binaries that have specific family mappings
    IF executable_name ~ '^Classic_.*\.(exe|dll)$' THEN
        RETURN 'Classic';
    ELSIF executable_name ~ '^LoD_.*\.(exe|dll)$' THEN
        RETURN 'LoD';
    ELSIF executable_name IN ('Game.exe', 'Diablo_II.exe') THEN
        -- These could be either Classic or LoD depending on version
        -- Default to Classic for now
        RETURN 'Classic';
    ELSE
        -- All other binaries are unified
        RETURN 'Unified';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =========================================================================
-- EXETABLE DENORMALIZED VIEW (REQUIRED BY SPRING BOOT API)
-- =========================================================================

-- Create denormalized view of exetable with game_versions joined via binary_versions
-- This view shows each binary for EACH version it appears in (not just canonical version)
-- Required by the Spring Boot API for binary loading
CREATE OR REPLACE VIEW exetable_denormalized AS
SELECT
    e.id,
    e.name_exec,
    e.md5,
    e.sha256,
    e.architecture,
    e.name_compiler,
    e.ingest_date,
    e.repository,
    e.path,
    e.is_reference,
    bv.game_version,
    gv.version_family,
    gv.version_string,
    gv.description as version_description,
    bv.discovered_at as version_discovered_at
FROM exetable e
JOIN binary_versions bv ON e.id = bv.executable_id
JOIN game_versions gv ON bv.game_version = gv.id;

-- =========================================================================
-- API VIEWS FOR WEB INTERFACE
-- =========================================================================

-- API cross-version functions view
CREATE OR REPLACE VIEW api_cross_version_functions AS
SELECT
    function_id,
    name_func as function_name,
    addr as address,
    name_exec as executable_name,
    family_type as game_type,
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
FROM cross_version_functions;

-- API versions view
CREATE OR REPLACE VIEW api_versions AS
SELECT DISTINCT
    CONCAT(family_type, '/', version) as folder_name,
    family_type as game_type,
    version,
    COUNT(DISTINCT name_exec) as file_count,
    COUNT(DISTINCT function_id) as change_count,
    CASE WHEN family_type = 'LoD' THEN true ELSE false END as is_lod,
    'Unknown' as total_size_readable,
    'unknown' as nocd_status
FROM cross_version_functions
GROUP BY family_type, version
ORDER BY folder_name;

-- API binaries view
CREATE OR REPLACE VIEW api_binaries AS
SELECT
    e.name_exec as filename,
    CASE
        WHEN gv.version_family IS NOT NULL THEN gv.version_family
        WHEN e.name_exec ~ '^Classic_.*\.(exe|dll)$' THEN 'Classic'
        WHEN e.name_exec ~ '^LoD_.*\.(exe|dll)$' THEN 'LoD'
        WHEN e.name_exec IN ('Game.exe', 'Diablo_II.exe') THEN 'Classic'
        ELSE 'Unified'
    END as game_type,
    COALESCE(gv.version_string, '0') as version,
    e.md5,
    a.val as architecture,
    CAST(EXTRACT(EPOCH FROM e.ingest_date) AS INTEGER) as timestamp,
    'binary' as type
FROM exetable e
LEFT JOIN archtable a ON e.architecture = a.id
LEFT JOIN game_versions gv ON e.game_version = gv.id
ORDER BY game_type, version, filename;

-- API functions index view
CREATE OR REPLACE VIEW api_functions_index AS
SELECT DISTINCT
    name_exec as filename,
    COUNT(function_id) as function_count
FROM cross_version_functions
GROUP BY name_exec;

-- =========================================================================
-- PLACEHOLDER TABLES FOR OTHER API ENDPOINTS
-- =========================================================================

-- Categories placeholder
CREATE TABLE IF NOT EXISTS api_categories (
    id SERIAL PRIMARY KEY,
    name TEXT,
    description TEXT
);

INSERT INTO api_categories (name, description) VALUES
('Game', 'Game logic functions'),
('Network', 'Network communication'),
('Graphics', 'Graphics and rendering'),
('Audio', 'Sound and audio')
ON CONFLICT DO NOTHING;

-- Create a view for easy API access
CREATE OR REPLACE VIEW api_categories_view AS
SELECT name, description FROM api_categories;

-- Note: api_exports table is created in 05-bsim-schema-extension.sql and populated by Step1

-- =========================================================================
-- COMPLETION MESSAGE
-- =========================================================================

\echo 'API views created successfully!'
\echo ''
\echo 'Created views:'
\echo '  - exetable_denormalized (required by Spring Boot API)'
\echo '  - cross_version_functions (base data)'
\echo '  - api_cross_version_functions'
\echo '  - api_versions'
\echo '  - api_binaries'
\echo '  - api_functions_index'
\echo '  - api_categories_view'
\echo ''
\echo 'Created helper function:'
\echo '  - get_family_for_exception()'
\echo ''
\echo 'Web interface API compatibility layer ready!'