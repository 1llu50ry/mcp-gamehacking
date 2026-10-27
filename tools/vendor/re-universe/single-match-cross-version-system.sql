-- Single-Match Cross-Version System
-- Purpose: Implement your exact requirement - one primary version compared against all others
-- with exactly one best match per version, preventing database bloat

-- ============================================================================
-- CORE REQUIREMENT ANALYSIS
-- ============================================================================
-- 1. Select ONE primary version per binary (e.g., 1.13d_D2Game.dll)
-- 2. For each function in primary version, find SINGLE BEST MATCH in each other version
-- 3. Rate matches as: exact (1.0), high (0.9-0.99), medium (0.7-0.89), low (0.5-0.69)
-- 4. NO multiple matches per version - database constraint enforced
-- 5. Efficient web table display with focus version in center

-- ============================================================================
-- TABLE 1: Cross-Version Function Equivalence (YOUR EXACT REQUIREMENT)
-- ============================================================================

-- Drop existing if we're replacing the schema approach
DROP TABLE IF EXISTS function_equivalence_members CASCADE;
DROP TABLE IF EXISTS function_equivalence CASCADE;

-- Primary table: One record per function in primary version
CREATE TABLE function_equivalence (
    id BIGSERIAL PRIMARY KEY,

    -- Primary version function (the "center" of your web table)
    primary_function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    primary_version VARCHAR(16) NOT NULL,
    binary_name VARCHAR(128) NOT NULL,
    canonical_name VARCHAR(256) NOT NULL, -- Function name from primary version

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    last_analyzed TIMESTAMP DEFAULT NOW(),

    -- Ensure one record per primary function
    UNIQUE(primary_function_id),

    -- Ensure one primary version per binary (your requirement)
    UNIQUE(binary_name, primary_version)
);

-- TABLE 2: Single Best Matches (ONE MATCH PER VERSION MAX)
CREATE TABLE function_version_matches (
    id BIGSERIAL PRIMARY KEY,

    -- Links back to primary function
    equivalence_id BIGINT REFERENCES function_equivalence(id) ON DELETE CASCADE,

    -- Target version and function (the match)
    target_function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    target_version VARCHAR(16) NOT NULL,

    -- Similarity data for your color coding
    similarity_score REAL NOT NULL CHECK (similarity_score BETWEEN 0.0 AND 1.0),
    confidence_level VARCHAR(16) NOT NULL CHECK (confidence_level IN ('exact', 'high', 'medium', 'low')),

    -- Analysis metadata
    match_method VARCHAR(32) DEFAULT 'similarity_analysis', -- how this match was found
    analyzed_at TIMESTAMP DEFAULT NOW(),

    -- CRITICAL CONSTRAINT: Exactly one match per version per primary function
    UNIQUE(equivalence_id, target_version),

    -- Additional constraint: a target function can't match multiple primary functions in same binary
    UNIQUE(target_function_id)
);

-- Indexes for performance
CREATE INDEX idx_equiv_primary_function ON function_equivalence(primary_function_id);
CREATE INDEX idx_equiv_binary_name ON function_equivalence(binary_name);
CREATE INDEX idx_equiv_primary_version ON function_equivalence(primary_version);

CREATE INDEX idx_matches_equivalence ON function_version_matches(equivalence_id);
CREATE INDEX idx_matches_target_version ON function_version_matches(target_version);
CREATE INDEX idx_matches_similarity ON function_version_matches(similarity_score DESC);
CREATE INDEX idx_matches_confidence ON function_version_matches(confidence_level);

-- ============================================================================
-- CONSTRAINT FUNCTIONS (PREVENT YOUR CONCERNS ABOUT MULTIPLE MATCHES)
-- ============================================================================

-- Function to automatically determine confidence level from similarity score
CREATE OR REPLACE FUNCTION calculate_confidence_level(score REAL)
RETURNS VARCHAR(16) AS $$
BEGIN
    RETURN CASE
        WHEN score >= 0.98 THEN 'exact'
        WHEN score >= 0.90 THEN 'high'
        WHEN score >= 0.70 THEN 'medium'
        ELSE 'low'
    END;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-calculate confidence level
CREATE OR REPLACE FUNCTION update_confidence_level()
RETURNS TRIGGER AS $$
BEGIN
    NEW.confidence_level = calculate_confidence_level(NEW.similarity_score);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_confidence_level
    BEFORE INSERT OR UPDATE ON function_version_matches
    FOR EACH ROW
    EXECUTE FUNCTION update_confidence_level();

-- ============================================================================
-- YOUR PRIMARY VERSION COMPARISON WORKFLOW
-- ============================================================================

-- Function to set up primary version for a binary (your exact workflow)
CREATE OR REPLACE FUNCTION setup_primary_version_analysis(
    p_binary_name TEXT,
    p_primary_version TEXT
) RETURNS INTEGER AS $$
DECLARE
    primary_exe_id INTEGER;
    func_record RECORD;
    equivalence_count INTEGER := 0;
BEGIN
    -- Get the primary version executable
    SELECT e.id INTO primary_exe_id
    FROM exetable e
    WHERE e.name_exec LIKE '%' || p_primary_version || '%' || p_binary_name || '%'
    AND e.game_version = p_primary_version;

    IF primary_exe_id IS NULL THEN
        RAISE EXCEPTION 'Primary version % for binary % not found', p_primary_version, p_binary_name;
    END IF;

    -- Create equivalence records for each function in primary version
    FOR func_record IN
        SELECT d.id, d.name_func
        FROM desctable d
        WHERE d.id_exe = primary_exe_id
    LOOP
        INSERT INTO function_equivalence (
            primary_function_id,
            primary_version,
            binary_name,
            canonical_name
        ) VALUES (
            func_record.id,
            p_primary_version,
            p_binary_name,
            func_record.name_func
        ) ON CONFLICT (primary_function_id) DO NOTHING;

        equivalence_count := equivalence_count + 1;
    END LOOP;

    RETURN equivalence_count;
END;
$$ LANGUAGE plpgsql;

-- Function to find single best match for a primary function in a target version
CREATE OR REPLACE FUNCTION find_single_best_match(
    p_equivalence_id BIGINT,
    p_target_version TEXT,
    p_binary_name TEXT
) RETURNS VOID AS $$
DECLARE
    primary_func_id BIGINT;
    best_match_id BIGINT;
    best_similarity REAL;
    target_exe_id INTEGER;
BEGIN
    -- Get primary function
    SELECT primary_function_id INTO primary_func_id
    FROM function_equivalence
    WHERE id = p_equivalence_id;

    -- Get target executable
    SELECT e.id INTO target_exe_id
    FROM exetable e
    WHERE e.name_exec LIKE '%' || p_target_version || '%' || p_binary_name || '%'
    AND e.game_version = p_target_version;

    IF target_exe_id IS NULL THEN
        RETURN; -- No target version exists
    END IF;

    -- Find the SINGLE BEST MATCH using your similarity logic
    SELECT
        target_func.id,
        GREATEST(
            -- Name similarity (exact match = 1.0)
            CASE WHEN primary_func.name_func = target_func.name_func THEN 1.0 ELSE 0.0 END,

            -- Address similarity (close addresses = higher score)
            CASE WHEN ABS(primary_func.addr - target_func.addr) < 4096 THEN 0.95 ELSE 0.5 END,

            -- Signature similarity (if available)
            COALESCE(
                (SELECT fsm.similarity_score
                 FROM function_similarity_matrix fsm
                 WHERE fsm.source_function_id = primary_func_id
                 AND fsm.target_function_id = target_func.id),
                0.5
            )
        ) as best_score
    INTO best_match_id, best_similarity
    FROM desctable primary_func
    JOIN desctable target_func ON target_func.id_exe = target_exe_id
    WHERE primary_func.id = primary_func_id
    ORDER BY best_score DESC, target_func.name_func
    LIMIT 1; -- SINGLE BEST MATCH ONLY

    -- Insert the single best match (constraint prevents duplicates)
    INSERT INTO function_version_matches (
        equivalence_id,
        target_function_id,
        target_version,
        similarity_score,
        match_method
    ) VALUES (
        p_equivalence_id,
        best_match_id,
        p_target_version,
        best_similarity,
        'best_match_analysis'
    ) ON CONFLICT (equivalence_id, target_version) DO UPDATE SET
        target_function_id = EXCLUDED.target_function_id,
        similarity_score = EXCLUDED.similarity_score,
        analyzed_at = NOW()
    ;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- WEB DISPLAY VIEW (YOUR EXACT TABLE LAYOUT)
-- ============================================================================

-- View for your web interface - primary version in center, matches left/right
CREATE OR REPLACE VIEW v_cross_version_web_table AS
SELECT
    fe.canonical_name,
    fe.binary_name,
    fe.primary_version,

    -- Primary function (center column)
    jsonb_build_object(
        'name', primary_d.name_func,
        'id', fe.primary_function_id,
        'addr', primary_d.addr,
        'confidence', 'primary'
    ) as primary_function,

    -- All version matches as JSONB for easy web consumption
    jsonb_object_agg(
        fvm.target_version,
        jsonb_build_object(
            'name', target_d.name_func,
            'id', fvm.target_function_id,
            'addr', target_d.addr,
            'similarity', fvm.similarity_score,
            'confidence', fvm.confidence_level,
            'css_class', CASE
                WHEN fvm.confidence_level = 'exact' THEN 'exact-match'
                WHEN fvm.confidence_level = 'high' THEN 'high-confidence'
                WHEN fvm.confidence_level = 'medium' THEN 'medium-confidence'
                ELSE 'low-confidence'
            END
        )
    ) FILTER (WHERE fvm.target_function_id IS NOT NULL) as version_matches

FROM function_equivalence fe
JOIN desctable primary_d ON fe.primary_function_id = primary_d.id
LEFT JOIN function_version_matches fvm ON fe.id = fvm.equivalence_id
LEFT JOIN desctable target_d ON fvm.target_function_id = target_d.id
GROUP BY fe.id, fe.canonical_name, fe.binary_name, fe.primary_version,
         primary_d.name_func, fe.primary_function_id, primary_d.addr;

-- ============================================================================
-- EXAMPLE USAGE FOR YOUR WORKFLOW
-- ============================================================================

-- Step 1: Set up 1.13d as primary version for D2Game.dll
-- SELECT setup_primary_version_analysis('D2Game.dll', '1.13d');

-- Step 2: Find matches in other versions (one at a time, prevents bloat)
-- SELECT find_single_best_match(equivalence_id, '1.07', 'D2Game.dll')
-- FROM function_equivalence WHERE binary_name = 'D2Game.dll';

-- Step 3: Web query (super fast, your exact layout)
-- SELECT * FROM v_cross_version_web_table WHERE binary_name = 'D2Game.dll';

COMMENT ON TABLE function_equivalence IS 'One record per function in primary version - prevents database bloat';
COMMENT ON TABLE function_version_matches IS 'Single best match per version - constraint enforced';
COMMENT ON VIEW v_cross_version_web_table IS 'Web-ready cross-version table with color-coding data';

-- Final verification
SELECT 'Single-Match System Ready' as status;