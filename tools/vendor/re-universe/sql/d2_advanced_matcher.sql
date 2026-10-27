-- Advanced D2 Function Similarity Metrics
-- Enhanced matching algorithms for better cross-version function identification

-- Create advanced similarity scoring function
CREATE OR REPLACE FUNCTION calculate_advanced_similarity(
    source_sig REAL,
    target_sig REAL,
    source_hash BIGINT,
    target_hash BIGINT,
    source_addr BIGINT,
    target_addr BIGINT,
    source_func_name TEXT,
    target_func_name TEXT
) RETURNS REAL AS $$
DECLARE
    sig_similarity REAL;
    hash_similarity REAL;
    addr_pattern_similarity REAL;
    name_pattern_similarity REAL;
    final_score REAL;
BEGIN
    -- Significance similarity (closer values = higher similarity)
    sig_similarity := 1.0 - LEAST(1.0, ABS(source_sig - target_sig) * 2);

    -- Hash code similarity (logarithmic scale for large differences)
    hash_similarity := 1.0 - LEAST(1.0,
        LOG(1 + ABS(source_hash - target_hash)) / LOG(1000000000.0));

    -- Address pattern similarity (relative positioning)
    addr_pattern_similarity := CASE
        WHEN ABS((source_addr % 65536) - (target_addr % 65536)) < 4096 THEN 0.8
        WHEN ABS((source_addr % 4096) - (target_addr % 4096)) < 256 THEN 0.6
        ELSE 0.3
    END;

    -- Name pattern hints (for partially named functions)
    name_pattern_similarity := CASE
        WHEN source_func_name LIKE '%player%' AND target_func_name LIKE '%player%' THEN 0.9
        WHEN source_func_name LIKE '%item%' AND target_func_name LIKE '%item%' THEN 0.9
        WHEN source_func_name LIKE '%skill%' AND target_func_name LIKE '%skill%' THEN 0.9
        WHEN source_func_name LIKE '%network%' AND target_func_name LIKE '%network%' THEN 0.9
        ELSE 0.0
    END;

    -- Weighted combination
    final_score := (
        sig_similarity * 0.4 +
        hash_similarity * 0.3 +
        addr_pattern_similarity * 0.2 +
        name_pattern_similarity * 0.1
    );

    RETURN GREATEST(0.0, LEAST(1.0, final_score));
END;
$$ LANGUAGE plpgsql;

-- Create function to find D2-specific patterns
CREATE OR REPLACE FUNCTION find_d2_function_patterns(
    source_version TEXT,
    target_version TEXT,
    min_confidence REAL DEFAULT 0.8
) RETURNS TABLE (
    source_func_name VARCHAR(512),
    target_func_name VARCHAR(512),
    target_func_id BIGINT,
    similarity_score REAL,
    confidence_level TEXT,
    match_reason TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH source_functions AS (
        SELECT
            f.id, f.name_func, f.name_namespace, f.addr,
            s.significance, s.hash_code,
            CASE
                WHEN f.name_func LIKE '%player%' THEN 'PLAYER'
                WHEN f.name_func LIKE '%item%' THEN 'ITEM'
                WHEN f.name_func LIKE '%skill%' THEN 'SKILL'
                WHEN f.name_func LIKE '%network%' THEN 'NETWORK'
                WHEN f.name_func LIKE '%save%' THEN 'SAVE'
                WHEN f.name_func LIKE '%ui%' OR f.name_func LIKE '%interface%' THEN 'UI'
                WHEN f.name_func LIKE '%monster%' OR f.name_func LIKE '%mob%' THEN 'MONSTER'
                ELSE 'UNKNOWN'
            END as function_category
        FROM function f
        JOIN signature s ON f.id = s.function_id
        JOIN executable e ON f.executable_id = e.id
        WHERE e.name_exec = source_version
        AND f.name_func NOT LIKE 'FUN_%'
        AND s.significance >= 0.5
    ),
    target_functions AS (
        SELECT
            f.id, f.name_func, f.name_namespace, f.addr,
            s.significance, s.hash_code,
            CASE
                WHEN f.name_func LIKE '%player%' THEN 'PLAYER'
                WHEN f.name_func LIKE '%item%' THEN 'ITEM'
                WHEN f.name_func LIKE '%skill%' THEN 'SKILL'
                WHEN f.name_func LIKE '%network%' THEN 'NETWORK'
                WHEN f.name_func LIKE '%save%' THEN 'SAVE'
                WHEN f.name_func LIKE '%ui%' OR f.name_func LIKE '%interface%' THEN 'UI'
                WHEN f.name_func LIKE '%monster%' OR f.name_func LIKE '%mob%' THEN 'MONSTER'
                ELSE 'UNKNOWN'
            END as function_category
        FROM function f
        JOIN signature s ON f.id = s.function_id
        JOIN executable e ON f.executable_id = e.id
        WHERE e.name_exec = target_version
        AND s.significance >= 0.5
    ),
    similarity_analysis AS (
        SELECT
            sf.name_func,
            tf.name_func as target_name,
            tf.id as target_id,
            calculate_advanced_similarity(
                sf.significance, tf.significance,
                sf.hash_code, tf.hash_code,
                sf.addr, tf.addr,
                sf.name_func, tf.name_func
            ) as advanced_score,
            CASE
                WHEN sf.function_category = tf.function_category
                     AND sf.function_category != 'UNKNOWN' THEN 'CATEGORY_MATCH'
                WHEN ABS(sf.significance - tf.significance) < 0.05 THEN 'SIGNATURE_MATCH'
                WHEN ABS(sf.hash_code - tf.hash_code) < 1000000 THEN 'HASH_MATCH'
                ELSE 'GENERAL_SIMILARITY'
            END as match_type,
            ROW_NUMBER() OVER (
                PARTITION BY tf.id
                ORDER BY calculate_advanced_similarity(
                    sf.significance, tf.significance,
                    sf.hash_code, tf.hash_code,
                    sf.addr, tf.addr,
                    sf.name_func, tf.name_func
                ) DESC
            ) as match_rank
        FROM source_functions sf
        CROSS JOIN target_functions tf
        WHERE sf.id != tf.id
        AND (tf.name_func LIKE 'FUN_%' OR tf.name_func = '')
    )
    SELECT
        sa.name_func,
        sa.target_name,
        sa.target_id,
        sa.advanced_score,
        CASE
            WHEN sa.advanced_score >= 0.9 THEN 'HIGH'
            WHEN sa.advanced_score >= 0.8 THEN 'MEDIUM'
            WHEN sa.advanced_score >= 0.7 THEN 'LOW'
            ELSE 'VERY_LOW'
        END,
        sa.match_type
    FROM similarity_analysis sa
    WHERE sa.match_rank = 1
    AND sa.advanced_score >= min_confidence
    ORDER BY sa.advanced_score DESC;
END;
$$ LANGUAGE plpgsql;

-- Create function for batch processing multiple versions
CREATE OR REPLACE FUNCTION batch_propagate_d2_names(
    source_versions TEXT[],
    target_versions TEXT[],
    min_confidence REAL DEFAULT 0.8,
    dry_run BOOLEAN DEFAULT TRUE
) RETURNS TABLE (
    operation TEXT,
    source_version TEXT,
    target_version TEXT,
    functions_updated INTEGER,
    success BOOLEAN
) AS $$
DECLARE
    src_version TEXT;
    tgt_version TEXT;
    update_count INTEGER;
    total_updated INTEGER := 0;
BEGIN
    -- Loop through all source-target combinations
    FOREACH src_version IN ARRAY source_versions LOOP
        FOREACH tgt_version IN ARRAY target_versions LOOP
            IF src_version != tgt_version THEN
                -- Count potential updates
                SELECT COUNT(*) INTO update_count
                FROM find_d2_function_patterns(src_version, tgt_version, min_confidence);

                IF NOT dry_run AND update_count > 0 THEN
                    -- Perform actual updates
                    WITH updates AS (
                        SELECT
                            target_func_id,
                            source_func_name,
                            (SELECT name_namespace FROM function f2
                             JOIN executable e2 ON f2.executable_id = e2.id
                             WHERE e2.name_exec = src_version
                             AND f2.name_func = fp.source_func_name
                             LIMIT 1) as source_namespace
                        FROM find_d2_function_patterns(src_version, tgt_version, min_confidence) fp
                    )
                    UPDATE function
                    SET name_func = updates.source_func_name,
                        name_namespace = COALESCE(updates.source_namespace, name_namespace)
                    FROM updates
                    WHERE function.id = updates.target_func_id;

                    GET DIAGNOSTICS update_count = ROW_COUNT;
                END IF;

                total_updated := total_updated + update_count;

                RETURN QUERY SELECT
                    CASE WHEN dry_run THEN 'DRY_RUN' ELSE 'APPLIED' END,
                    src_version,
                    tgt_version,
                    update_count,
                    TRUE;
            END IF;
        END LOOP;
    END LOOP;

    RETURN QUERY SELECT
        'SUMMARY'::TEXT,
        ''::TEXT,
        ''::TEXT,
        total_updated,
        TRUE;
END;
$$ LANGUAGE plpgsql;

-- Create view for D2 function analysis dashboard
CREATE OR REPLACE VIEW d2_function_coverage AS
SELECT
    e.name_exec as version,
    e.id as executable_id,
    COUNT(f.id) as total_functions,
    COUNT(CASE WHEN f.name_func NOT LIKE 'FUN_%' AND f.name_func != '' THEN 1 END) as named_functions,
    COUNT(CASE WHEN f.name_func LIKE 'FUN_%' OR f.name_func = '' THEN 1 END) as unnamed_functions,
    ROUND(
        COUNT(CASE WHEN f.name_func NOT LIKE 'FUN_%' AND f.name_func != '' THEN 1 END) * 100.0 /
        NULLIF(COUNT(f.id), 0), 2
    ) as coverage_percent,
    ROUND(AVG(s.significance)::numeric, 3) as avg_significance,
    MAX(f.create_date) as last_updated
FROM executable e
LEFT JOIN function f ON e.id = f.executable_id
LEFT JOIN signature s ON f.id = s.function_id
WHERE e.name_category = 'Diablo2' OR e.name_exec LIKE '%diablo2%'
GROUP BY e.id, e.name_exec
ORDER BY coverage_percent DESC, total_functions DESC;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_function_category
ON function ((CASE
    WHEN name_func LIKE '%player%' THEN 'PLAYER'
    WHEN name_func LIKE '%item%' THEN 'ITEM'
    WHEN name_func LIKE '%skill%' THEN 'SKILL'
    WHEN name_func LIKE '%network%' THEN 'NETWORK'
    ELSE 'OTHER'
END));

CREATE INDEX IF NOT EXISTS idx_signature_advanced
ON signature (significance, hash_code)
WHERE significance >= 0.5;