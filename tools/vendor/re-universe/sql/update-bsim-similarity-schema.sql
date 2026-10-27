-- Enhanced BSim Similarity Schema for Cross-Version Function Matching
-- This updates the database to support true BSim similarity matching

-- Drop existing simple similarity table if it exists
DROP TABLE IF EXISTS function_similarity_matrix CASCADE;

-- Create enhanced signatures table for BSim LSH vectors
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

-- Create similarity matrix table for BSim results
CREATE TABLE function_similarity_matrix (
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

-- Create cross-version function groups table
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

-- Link functions to their cross-version groups
CREATE TABLE IF NOT EXISTS function_group_memberships (
    id SERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES cross_version_function_groups(id) ON DELETE CASCADE,
    membership_confidence DOUBLE PRECISION DEFAULT 0.0,
    is_primary_representative BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(function_id, group_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_enhanced_signatures_function ON enhanced_signatures(function_id);
CREATE INDEX IF NOT EXISTS idx_enhanced_signatures_quality ON enhanced_signatures(signature_quality);
CREATE INDEX IF NOT EXISTS idx_enhanced_signatures_feature_count ON enhanced_signatures(feature_count);

CREATE INDEX IF NOT EXISTS idx_function_similarity_source ON function_similarity_matrix(source_function_id);
CREATE INDEX IF NOT EXISTS idx_function_similarity_target ON function_similarity_matrix(target_function_id);
CREATE INDEX IF NOT EXISTS idx_function_similarity_score ON function_similarity_matrix(similarity_score);
CREATE INDEX IF NOT EXISTS idx_function_similarity_confidence ON function_similarity_matrix(confidence_score);
CREATE INDEX IF NOT EXISTS idx_function_similarity_match_type ON function_similarity_matrix(match_type);

CREATE INDEX IF NOT EXISTS idx_cross_version_groups_name ON cross_version_function_groups(primary_function_name);
CREATE INDEX IF NOT EXISTS idx_cross_version_groups_hash ON cross_version_function_groups(group_hash);

CREATE INDEX IF NOT EXISTS idx_function_group_memberships_function ON function_group_memberships(function_id);
CREATE INDEX IF NOT EXISTS idx_function_group_memberships_group ON function_group_memberships(group_id);
CREATE INDEX IF NOT EXISTS idx_function_group_memberships_primary ON function_group_memberships(is_primary_representative);

-- Update trigger for similarity matrix
CREATE OR REPLACE FUNCTION update_similarity_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_similarity_timestamp
    BEFORE UPDATE ON function_similarity_matrix
    FOR EACH ROW EXECUTE FUNCTION update_similarity_timestamp();

-- Create improved cross-version functions view using similarity data
DROP MATERIALIZED VIEW IF EXISTS cross_version_functions CASCADE;

CREATE MATERIALIZED VIEW cross_version_functions AS
WITH version_groups AS (
    SELECT
        cvfg.id as group_id,
        cvfg.primary_function_name,
        cvfg.function_count,
        cvfg.avg_similarity,
        cvfg.version_span,
        cvfg.game_types,
        array_agg(DISTINCT
            CASE
                WHEN e.name_exec ~ '_1\.14[a-z]?_' THEN substring(e.name_exec from '_(1\.14[a-z]?)_')
                WHEN e.name_exec ~ '_1\.13[a-z]?_' THEN substring(e.name_exec from '_(1\.13[a-z]?)_')
                WHEN e.name_exec ~ '_1\.12[a-z]?_' THEN substring(e.name_exec from '_(1\.12[a-z]?)_')
                WHEN e.name_exec ~ '_1\.11[a-z]?_' THEN substring(e.name_exec from '_(1\.11[a-z]?)_')
                WHEN e.name_exec ~ '_1\.10[a-z]?_' THEN substring(e.name_exec from '_(1\.10[a-z]?)_')
                WHEN e.name_exec ~ '_1\.0[0-9][a-z]?_' THEN substring(e.name_exec from '_(1\.0[0-9][a-z]?)_')
                ELSE 'Unknown'
            END
        ) FILTER (WHERE substring(e.name_exec from '_(1\.[0-9]+[a-z]?)_') IS NOT NULL) AS versions_found
    FROM cross_version_function_groups cvfg
    JOIN function_group_memberships fgm ON cvfg.id = fgm.group_id
    JOIN desctable d ON fgm.function_id = d.id
    JOIN exetable e ON d.id_exe = e.id
    GROUP BY cvfg.id, cvfg.primary_function_name, cvfg.function_count, cvfg.avg_similarity, cvfg.version_span, cvfg.game_types
)
SELECT DISTINCT
    d.id AS function_id,
    d.name_func,
    d.addr,
    e.name_exec,
    e.architecture,
    CASE
        WHEN e.name_exec ~ '^Classic_' THEN 'Classic'
        WHEN e.name_exec ~ '^LoD_' THEN 'LoD'
        WHEN e.name_exec ~ '^D2R_' THEN 'D2R'
        ELSE 'Other'
    END AS game_type,
    CASE
        WHEN e.name_exec ~ '_1\.14[a-z]?_' THEN substring(e.name_exec from '_(1\.14[a-z]?)_')
        WHEN e.name_exec ~ '_1\.13[a-z]?_' THEN substring(e.name_exec from '_(1\.13[a-z]?)_')
        WHEN e.name_exec ~ '_1\.12[a-z]?_' THEN substring(e.name_exec from '_(1\.12[a-z]?)_')
        WHEN e.name_exec ~ '_1\.11[a-z]?_' THEN substring(e.name_exec from '_(1\.11[a-z]?)_')
        WHEN e.name_exec ~ '_1\.10[a-z]?_' THEN substring(e.name_exec from '_(1\.10[a-z]?)_')
        WHEN e.name_exec ~ '_1\.0[0-9][a-z]?_' THEN substring(e.name_exec from '_(1\.0[0-9][a-z]?)_')
        ELSE 'Unknown'
    END AS version,
    -- Enhanced cross-version matching data
    COALESCE(similarity_stats.total_similarities, 0) AS cross_version_matches,
    COALESCE(similarity_stats.avg_similarity, 0.0) AS avg_cross_version_similarity,
    COALESCE(similarity_stats.max_similarity, 0.0) AS max_cross_version_similarity,
    COALESCE(similarity_stats.version_count, 0) AS versions_with_matches,
    COALESCE(vg.group_id, 0) AS function_group_id,
    COALESCE(vg.primary_function_name, d.name_func) AS canonical_function_name,
    COALESCE(vg.function_count, 1) AS group_function_count,
    COALESCE(array_length(vg.versions_found, 1), 1) AS group_version_count,
    es.signature_quality,
    es.feature_count
FROM desctable d
JOIN exetable e ON d.id_exe = e.id
LEFT JOIN enhanced_signatures es ON d.id = es.function_id
LEFT JOIN function_group_memberships fgm ON d.id = fgm.function_id
LEFT JOIN version_groups vg ON fgm.group_id = vg.group_id
LEFT JOIN (
    SELECT
        fsm.source_function_id,
        COUNT(*) as total_similarities,
        AVG(fsm.similarity_score) as avg_similarity,
        MAX(fsm.similarity_score) as max_similarity,
        COUNT(DISTINCT te.name_exec) as version_count
    FROM function_similarity_matrix fsm
    JOIN desctable td ON fsm.target_function_id = td.id
    JOIN exetable te ON td.id_exe = te.id
    WHERE fsm.similarity_score >= 0.7
    GROUP BY fsm.source_function_id
) similarity_stats ON d.id = similarity_stats.source_function_id
WHERE e.name_exec ~ '^(Classic|LoD|D2R)_.*\.(dll|exe)$'
ORDER BY d.name_func, e.name_exec;

-- Create indexes on the materialized view
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_name ON cross_version_functions(name_func);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_version ON cross_version_functions(version);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_type ON cross_version_functions(game_type);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_group ON cross_version_functions(function_group_id);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_matches ON cross_version_functions(cross_version_matches);
CREATE INDEX IF NOT EXISTS idx_cross_version_functions_similarity ON cross_version_functions(avg_cross_version_similarity);

-- Create function to refresh cross-version data
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

-- Create convenience views for API usage
CREATE OR REPLACE VIEW api_cross_version_functions AS
SELECT
    function_id,
    name_func as function_name,
    addr as address,
    name_exec as executable_name,
    game_type,
    version,
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
WHERE cross_version_matches > 0
ORDER BY avg_cross_version_similarity DESC, cross_version_matches DESC;

-- Create summary statistics view
CREATE OR REPLACE VIEW cross_version_statistics AS
SELECT
    COUNT(*) as total_functions,
    COUNT(*) FILTER (WHERE cross_version_matches > 0) as functions_with_matches,
    ROUND(AVG(cross_version_matches), 2) as avg_matches_per_function,
    ROUND(AVG(avg_cross_version_similarity), 3) as avg_similarity_score,
    COUNT(DISTINCT version) as total_versions,
    COUNT(DISTINCT game_type) as total_game_types,
    COUNT(DISTINCT function_group_id) FILTER (WHERE function_group_id > 0) as total_function_groups
FROM cross_version_functions;

COMMENT ON TABLE enhanced_signatures IS 'Stores BSim LSH signatures and metadata for functions';
COMMENT ON TABLE function_similarity_matrix IS 'BSim-based similarity relationships between functions across versions';
COMMENT ON TABLE cross_version_function_groups IS 'Groups of similar functions across different game versions';
COMMENT ON TABLE function_group_memberships IS 'Links functions to their cross-version similarity groups';
COMMENT ON MATERIALIZED VIEW cross_version_functions IS 'Main view for cross-version function analysis with similarity data';
COMMENT ON VIEW api_cross_version_functions IS 'API-friendly view of cross-version function data';
COMMENT ON VIEW cross_version_statistics IS 'Summary statistics for cross-version function matching';