-- Enhanced BSim Schema with Separate Version Fields
-- Author: Claude Code Assistant
-- Date: 2026-01-16
-- Purpose: Complete schema for clean BSim deployments with proper version field architecture

-- ============================================================================
-- ENHANCED EXECUTABLE TABLE CONSTRAINTS AND INDEXES
-- ============================================================================

-- Ensure version fields have proper constraints (assumes base schema exists)
ALTER TABLE exetable ADD CONSTRAINT IF NOT EXISTS valid_game_version
CHECK (game_version IS NULL OR game_version ~ '^1\.[0-9]+[a-z]?$');

ALTER TABLE exetable ADD CONSTRAINT IF NOT EXISTS valid_version_family
CHECK (version_family IS NULL OR version_family IN ('Classic', 'LoD', 'D2R'));

-- Performance indexes for version fields
CREATE INDEX IF NOT EXISTS idx_exetable_game_version ON exetable(game_version);
CREATE INDEX IF NOT EXISTS idx_exetable_version_family ON exetable(version_family);
CREATE INDEX IF NOT EXISTS idx_exetable_version_combo ON exetable(version_family, game_version);

-- ============================================================================
-- UNIQUE CONSTRAINTS FOR ON CONFLICT SUPPORT IN GHIDRA SCRIPTS
-- ============================================================================

-- Note: md5 is already UNIQUE in exetable (standard BSim behavior)
-- ON CONFLICT (md5) is used in Ghidra scripts for idempotent inserts

-- Add unique constraint on desctable(id_exe, addr) for ON CONFLICT (id_exe, addr) support
-- This ensures each address within an executable can only have one function
ALTER TABLE desctable ADD CONSTRAINT IF NOT EXISTS desctable_exe_addr_key UNIQUE (id_exe, addr);

-- ============================================================================
-- ENHANCED SIGNATURES TABLE FOR BSIM LSH VECTORS
-- ============================================================================

CREATE TABLE IF NOT EXISTS enhanced_signatures (
    id SERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    lsh_vector lshvector NOT NULL,
    feature_count INTEGER DEFAULT 0,
    signature_quality DOUBLE PRECISION DEFAULT 0.0,
    instruction_count INTEGER DEFAULT 0,
    parameter_count INTEGER DEFAULT 0,
    branch_count INTEGER DEFAULT 0,
    call_count INTEGER DEFAULT 0,
    mnemonic_pattern TEXT,
    control_flow_pattern TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(function_id)
);

CREATE INDEX IF NOT EXISTS idx_enhanced_signatures_function ON enhanced_signatures(function_id);
CREATE INDEX IF NOT EXISTS idx_enhanced_signatures_quality ON enhanced_signatures(signature_quality);
CREATE INDEX IF NOT EXISTS idx_enhanced_signatures_feature_count ON enhanced_signatures(feature_count);

-- ============================================================================
-- FUNCTION SIMILARITY MATRIX FOR BSIM RESULTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS function_similarity_matrix (
    id SERIAL PRIMARY KEY,
    source_function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    target_function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    similarity_score DOUBLE PRECISION NOT NULL CHECK (similarity_score >= 0 AND similarity_score <= 1),
    confidence_score DOUBLE PRECISION NOT NULL CHECK (confidence_score >= 0),
    match_type VARCHAR(50) DEFAULT 'bsim_similarity',
    feature_overlap INTEGER DEFAULT 0,
    structural_similarity DOUBLE PRECISION DEFAULT 0.0,
    semantic_similarity DOUBLE PRECISION DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(source_function_id, target_function_id)
);

CREATE INDEX IF NOT EXISTS idx_function_similarity_source ON function_similarity_matrix(source_function_id);
CREATE INDEX IF NOT EXISTS idx_function_similarity_target ON function_similarity_matrix(target_function_id);
CREATE INDEX IF NOT EXISTS idx_function_similarity_score ON function_similarity_matrix(similarity_score);
CREATE INDEX IF NOT EXISTS idx_function_similarity_confidence ON function_similarity_matrix(confidence_score);
CREATE INDEX IF NOT EXISTS idx_function_similarity_match_type ON function_similarity_matrix(match_type);

-- ============================================================================
-- CROSS-VERSION FUNCTION GROUPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS cross_version_function_groups (
    id SERIAL PRIMARY KEY,
    group_hash VARCHAR(64) UNIQUE NOT NULL,
    primary_function_name TEXT NOT NULL,
    function_count INTEGER DEFAULT 0,
    avg_similarity DOUBLE PRECISION DEFAULT 0.0,
    version_span TEXT, -- e.g., "1.00-1.14d"
    game_types TEXT[], -- e.g., ["Classic", "LoD"]
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS function_group_memberships (
    id SERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES cross_version_function_groups(id) ON DELETE CASCADE,
    membership_confidence DOUBLE PRECISION DEFAULT 0.0,
    is_primary_representative BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(function_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_cross_version_groups_name ON cross_version_function_groups(primary_function_name);
CREATE INDEX IF NOT EXISTS idx_cross_version_groups_hash ON cross_version_function_groups(group_hash);
CREATE INDEX IF NOT EXISTS idx_function_group_memberships_function ON function_group_memberships(function_id);
CREATE INDEX IF NOT EXISTS idx_function_group_memberships_group ON function_group_memberships(group_id);
CREATE INDEX IF NOT EXISTS idx_function_group_memberships_primary ON function_group_memberships(is_primary_representative);

-- ============================================================================
-- FUNCTION EVOLUTION TABLE (API COMPATIBILITY)
-- ============================================================================

CREATE TABLE IF NOT EXISTS function_evolution (
    id SERIAL PRIMARY KEY,
    name_func TEXT NOT NULL,
    version_count INTEGER DEFAULT 0,
    versions TEXT[] DEFAULT '{}',
    confidence_score DOUBLE PRECISION DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_function_evolution_name ON function_evolution(name_func);
CREATE INDEX IF NOT EXISTS idx_function_evolution_version_count ON function_evolution(version_count);

-- ============================================================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ============================================================================

-- Update similarity matrix timestamp trigger
CREATE OR REPLACE FUNCTION update_similarity_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER IF NOT EXISTS trigger_update_similarity_timestamp
    BEFORE UPDATE ON function_similarity_matrix
    FOR EACH ROW EXECUTE FUNCTION update_similarity_timestamp();

-- ============================================================================
-- MATERIALIZED VIEW: CROSS-VERSION FUNCTIONS (USING SEPARATE FIELDS)
-- ============================================================================

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

-- Indexes for materialized view performance
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_name ON cross_version_functions(name_func);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_version ON cross_version_functions(version);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_game_type ON cross_version_functions(game_type);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_group ON cross_version_functions(function_group_id);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_matches ON cross_version_functions(cross_version_matches);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_similarity ON cross_version_functions(avg_cross_version_similarity);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_md5 ON cross_version_functions(md5);

-- ============================================================================
-- API VIEWS FOR CLEAN INTERFACE
-- ============================================================================

-- API-friendly view of cross-version function data
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

-- Summary statistics view
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
-- UTILITY FUNCTIONS
-- ============================================================================

-- Function to refresh cross-version data
CREATE OR REPLACE FUNCTION refresh_cross_version_data()
RETURNS VOID AS $$
BEGIN
    -- Refresh the materialized view
    REFRESH MATERIALIZED VIEW CONCURRENTLY cross_version_functions;

    -- Update function group statistics
    UPDATE cross_version_function_groups
    SET
        function_count = subq.func_count,
        avg_similarity = subq.avg_sim,
        updated_at = NOW()
    FROM (
        SELECT
            fgm.group_id,
            COUNT(*) as func_count,
            AVG(fsm.similarity_score) as avg_sim
        FROM function_group_memberships fgm
        LEFT JOIN function_similarity_matrix fsm ON fgm.function_id = fsm.source_function_id
        GROUP BY fgm.group_id
    ) subq
    WHERE id = subq.group_id;

    RAISE NOTICE 'Cross-version data refreshed successfully';
END;
$$ LANGUAGE plpgsql;

-- Function to populate version fields from filename (for migration/import)
CREATE OR REPLACE FUNCTION populate_version_fields_from_filename()
RETURNS INTEGER AS $$
DECLARE
    affected_rows INTEGER;
BEGIN
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
            ELSE game_version -- Keep existing value if no pattern matches
        END,
        version_family = CASE
            WHEN name_exec ~ '^Classic_' THEN 'Classic'
            WHEN name_exec ~ '^LoD_' THEN 'LoD'
            WHEN name_exec ~ '^D2R_' THEN 'D2R'
            ELSE version_family -- Keep existing value if no pattern matches
        END
    WHERE name_exec ~ '^(Classic|LoD|D2R)_1\.[0-9]+[a-z]?_'
      AND (game_version IS NULL OR version_family IS NULL);

    GET DIAGNOSTICS affected_rows = ROW_COUNT;

    RAISE NOTICE 'Updated version fields for % executable records', affected_rows;
    RETURN affected_rows;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- DOCUMENTATION/COMMENTS
-- ============================================================================

COMMENT ON TABLE enhanced_signatures IS 'Stores BSim LSH signatures and metadata for functions';
COMMENT ON TABLE function_similarity_matrix IS 'BSim-based similarity relationships between functions across versions';
COMMENT ON TABLE cross_version_function_groups IS 'Groups of similar functions across different game versions';
COMMENT ON TABLE function_group_memberships IS 'Links functions to their cross-version similarity groups';
COMMENT ON TABLE function_evolution IS 'API compatibility table for function evolution across versions';

COMMENT ON MATERIALIZED VIEW cross_version_functions IS 'Main view for cross-version function analysis using separate version fields';
COMMENT ON VIEW api_cross_version_functions IS 'API-friendly view of cross-version function data';
COMMENT ON VIEW cross_version_statistics IS 'Summary statistics for cross-version function matching';

COMMENT ON COLUMN exetable.game_version IS 'Game version extracted from filename or metadata (e.g., 1.13c, 1.14d)';
COMMENT ON COLUMN exetable.version_family IS 'Game type/family (Classic, LoD, D2R)';

COMMENT ON FUNCTION refresh_cross_version_data() IS 'Refreshes materialized views and updates cross-version statistics';
COMMENT ON FUNCTION populate_version_fields_from_filename() IS 'Populates version fields from filename patterns during import/migration';
-- ============================================================================
-- GHIDRA SCRIPTS COMPATIBILITY TABLES
-- ============================================================================

-- Function analysis table (required by Step1 script)
CREATE TABLE IF NOT EXISTS function_analysis (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT NOT NULL REFERENCES desctable(id) ON DELETE CASCADE,
    executable_id BIGINT NOT NULL REFERENCES exetable(id) ON DELETE CASCADE,
    function_name VARCHAR(512),
    entry_address BIGINT,
    instruction_count INTEGER,
    basic_block_count INTEGER,
    cyclomatic_complexity INTEGER,
    calls_made INTEGER DEFAULT 0,
    calls_received INTEGER DEFAULT 0,
    has_loops BOOLEAN DEFAULT false,
    has_recursion BOOLEAN DEFAULT false,
    max_depth INTEGER,
    stack_frame_size INTEGER,
    calling_convention VARCHAR(64),
    is_leaf_function BOOLEAN DEFAULT false,
    is_library_function BOOLEAN DEFAULT false,
    is_thunk BOOLEAN DEFAULT false,
    confidence_score DOUBLE PRECISION,
    analysis_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(function_id, executable_id)
);

-- Function tags table (required by Step1 script)
CREATE TABLE IF NOT EXISTS function_tags (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT NOT NULL REFERENCES desctable(id) ON DELETE CASCADE,
    executable_id BIGINT NOT NULL REFERENCES exetable(id) ON DELETE CASCADE,
    tag_category VARCHAR(128) NOT NULL,
    tag_value VARCHAR(256) NOT NULL,
    confidence DOUBLE PRECISION DEFAULT 1.0,
    auto_generated BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(function_id, executable_id, tag_category, tag_value)
);

-- String references table (populated by Step1)
CREATE TABLE IF NOT EXISTS string_references (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT NOT NULL REFERENCES desctable(id) ON DELETE CASCADE,
    string_value TEXT NOT NULL,
    reference_address BIGINT,
    reference_type VARCHAR(32) DEFAULT 'direct',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cross references table (populated by Step1)
CREATE TABLE IF NOT EXISTS cross_references (
    id BIGSERIAL PRIMARY KEY,
    from_function_id BIGINT NOT NULL REFERENCES desctable(id) ON DELETE CASCADE,
    to_function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    reference_type VARCHAR(32) NOT NULL, -- 'call', 'jump', 'data_ref', etc.
    from_address BIGINT NOT NULL,
    to_address BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Import/Export mappings table (populated by Step1)
CREATE TABLE IF NOT EXISTS import_export_mappings (
    id BIGSERIAL PRIMARY KEY,
    executable_id BIGINT NOT NULL REFERENCES exetable(id) ON DELETE CASCADE,
    function_id BIGINT REFERENCES desctable(id) ON DELETE SET NULL,
    symbol_name VARCHAR(512) NOT NULL,
    symbol_type VARCHAR(16) NOT NULL, -- 'import' or 'export'
    ordinal INTEGER,
    library_name VARCHAR(256),
    address_offset BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cross version function mappings table (required by Step5 script)
CREATE TABLE IF NOT EXISTS cross_version_function_mappings (
    id BIGSERIAL PRIMARY KEY,
    cross_version_id BIGINT NOT NULL REFERENCES cross_version_function_groups(id) ON DELETE CASCADE,
    function_id BIGINT NOT NULL REFERENCES desctable(id) ON DELETE CASCADE,
    executable_id BIGINT NOT NULL REFERENCES exetable(id) ON DELETE CASCADE,
    version_key VARCHAR(32) NOT NULL,
    address_offset BIGINT,
    confidence DOUBLE PRECISION DEFAULT 1.0,
    UNIQUE(cross_version_id, function_id)
);

-- ============================================================================
-- PERFORMANCE INDEXES FOR GHIDRA SCRIPTS TABLES
-- ============================================================================

-- Function analysis indexes
CREATE INDEX IF NOT EXISTS idx_function_analysis_function_id ON function_analysis(function_id);
CREATE INDEX IF NOT EXISTS idx_function_analysis_executable_id ON function_analysis(executable_id);
CREATE INDEX IF NOT EXISTS idx_function_analysis_complexity ON function_analysis(cyclomatic_complexity);

-- Function tags indexes
CREATE INDEX IF NOT EXISTS idx_function_tags_function_id ON function_tags(function_id);
CREATE INDEX IF NOT EXISTS idx_function_tags_executable_id ON function_tags(executable_id);
CREATE INDEX IF NOT EXISTS idx_function_tags_category ON function_tags(tag_category);
CREATE INDEX IF NOT EXISTS idx_function_tags_value ON function_tags(tag_value);

-- String references indexes
CREATE INDEX IF NOT EXISTS idx_string_references_function_id ON string_references(function_id);
CREATE INDEX IF NOT EXISTS idx_string_references_value ON string_references(string_value);

-- Cross references indexes
CREATE INDEX IF NOT EXISTS idx_cross_references_from ON cross_references(from_function_id);
CREATE INDEX IF NOT EXISTS idx_cross_references_to ON cross_references(to_function_id);
CREATE INDEX IF NOT EXISTS idx_cross_references_type ON cross_references(reference_type);

-- Import/export mappings indexes
CREATE INDEX IF NOT EXISTS idx_import_export_executable_id ON import_export_mappings(executable_id);
CREATE INDEX IF NOT EXISTS idx_import_export_function_id ON import_export_mappings(function_id);
CREATE INDEX IF NOT EXISTS idx_import_export_symbol_name ON import_export_mappings(symbol_name);
CREATE INDEX IF NOT EXISTS idx_import_export_type ON import_export_mappings(symbol_type);

-- Cross version function mappings indexes
CREATE INDEX IF NOT EXISTS idx_cross_version_mappings_cv_id ON cross_version_function_mappings(cross_version_id);
CREATE INDEX IF NOT EXISTS idx_cross_version_mappings_func_id ON cross_version_function_mappings(function_id);
CREATE INDEX IF NOT EXISTS idx_cross_version_mappings_version ON cross_version_function_mappings(version_key);

-- ============================================================================
-- TABLE COMMENTS FOR GHIDRA SCRIPTS TABLES
-- ============================================================================

COMMENT ON TABLE function_analysis IS 'Detailed function analysis data from Ghidra scripts';
COMMENT ON TABLE function_tags IS 'Function tags from Ghidra analysis (script-compatible format)';
COMMENT ON TABLE string_references IS 'String references populated by Step1';
COMMENT ON TABLE cross_references IS 'Function cross-references populated by Step1';
COMMENT ON TABLE import_export_mappings IS 'Import/export symbol mappings populated by Step1';
COMMENT ON TABLE cross_version_function_mappings IS 'Version-specific function mappings for Step5';

-- ============================================================================
-- PERMISSIONS FOR GHIDRA SCRIPTS TABLES
-- ============================================================================

GRANT ALL PRIVILEGES ON function_analysis TO ben;
GRANT ALL PRIVILEGES ON function_tags TO ben;
GRANT ALL PRIVILEGES ON string_references TO ben;
GRANT ALL PRIVILEGES ON cross_references TO ben;
GRANT ALL PRIVILEGES ON import_export_mappings TO ben;
GRANT ALL PRIVILEGES ON cross_version_function_mappings TO ben;

GRANT USAGE, SELECT ON SEQUENCE function_analysis_id_seq TO ben;
GRANT USAGE, SELECT ON SEQUENCE function_tags_id_seq TO ben;
GRANT USAGE, SELECT ON SEQUENCE string_references_id_seq TO ben;
GRANT USAGE, SELECT ON SEQUENCE cross_references_id_seq TO ben;
GRANT USAGE, SELECT ON SEQUENCE import_export_mappings_id_seq TO ben;
GRANT USAGE, SELECT ON SEQUENCE cross_version_function_mappings_id_seq TO ben;

