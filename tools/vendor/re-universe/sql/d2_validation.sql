-- D2 Cross-Reference Analysis and Validation
-- Validates function matches using call graph relationships and other heuristics

-- Create function to analyze call graph relationships for validation
CREATE OR REPLACE FUNCTION validate_matches_with_callgraph(
    source_version TEXT,
    target_version TEXT
) RETURNS TABLE (
    source_func_name VARCHAR(512),
    target_func_name VARCHAR(512),
    match_confidence REAL,
    caller_matches INTEGER,
    callee_matches INTEGER,
    validation_score REAL,
    recommendation TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH source_exec AS (
        SELECT id FROM executable WHERE name_exec = source_version
    ),
    target_exec AS (
        SELECT id FROM executable WHERE name_exec = target_version
    ),
    source_calls AS (
        SELECT
            caller.name_func as caller_name,
            callee.name_func as callee_name,
            cg.caller_id,
            cg.callee_id
        FROM callgraph cg
        JOIN function caller ON cg.caller_id = caller.id
        JOIN function callee ON cg.callee_id = callee.id
        JOIN source_exec se ON caller.executable_id = se.id
        WHERE caller.name_func NOT LIKE 'FUN_%'
    ),
    target_calls AS (
        SELECT
            caller.name_func as caller_name,
            callee.name_func as callee_name,
            cg.caller_id,
            cg.callee_id
        FROM callgraph cg
        JOIN function caller ON cg.caller_id = caller.id
        JOIN function callee ON cg.callee_id = callee.id
        JOIN target_exec te ON caller.executable_id = te.id
    ),
    potential_matches AS (
        SELECT
            fp.source_func_name,
            fp.target_func_name,
            fp.target_func_id,
            fp.similarity_score
        FROM find_d2_function_patterns(source_version, target_version, 0.6) fp
    ),
    validation_analysis AS (
        SELECT
            pm.source_func_name,
            pm.target_func_name,
            pm.similarity_score,
            -- Count how many callers match
            (SELECT COUNT(*)
             FROM source_calls sc
             JOIN target_calls tc ON sc.caller_name = tc.caller_name
             WHERE sc.callee_name = pm.source_func_name
             AND tc.callee_id = pm.target_func_id) as caller_matches,
            -- Count how many callees match
            (SELECT COUNT(*)
             FROM source_calls sc
             JOIN target_calls tc ON sc.callee_name = tc.callee_name
             WHERE sc.caller_name = pm.source_func_name
             AND tc.caller_id = pm.target_func_id) as callee_matches
        FROM potential_matches pm
    )
    SELECT
        va.source_func_name,
        va.target_func_name,
        va.similarity_score,
        va.caller_matches,
        va.callee_matches,
        -- Weighted validation score
        (va.similarity_score * 0.6 +
         LEAST(1.0, va.caller_matches * 0.2) +
         LEAST(1.0, va.callee_matches * 0.2)) as validation_score,
        CASE
            WHEN va.caller_matches + va.callee_matches >= 3 THEN 'STRONG_VALIDATION'
            WHEN va.caller_matches + va.callee_matches >= 1 THEN 'MODERATE_VALIDATION'
            WHEN va.similarity_score >= 0.8 THEN 'SIMILARITY_ONLY'
            ELSE 'WEAK_MATCH'
        END as recommendation
    FROM validation_analysis va
    ORDER BY validation_score DESC;
END;
$$ LANGUAGE plpgsql;

-- Create function to detect potential naming conflicts
CREATE OR REPLACE FUNCTION detect_naming_conflicts(
    target_version TEXT
) RETURNS TABLE (
    conflicted_name VARCHAR(512),
    function_count INTEGER,
    addresses TEXT,
    recommendation TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.name_func,
        COUNT(*)::INTEGER,
        STRING_AGG(f.addr::TEXT, ', ') as addresses,
        CASE
            WHEN COUNT(*) > 3 THEN 'INVESTIGATE_DUPLICATE_NAMES'
            WHEN COUNT(*) = 2 THEN 'POSSIBLE_OVERLOAD'
            ELSE 'NORMAL'
        END as recommendation
    FROM function f
    JOIN executable e ON f.executable_id = e.id
    WHERE e.name_exec = target_version
    AND f.name_func NOT LIKE 'FUN_%'
    AND f.name_func != ''
    GROUP BY f.name_func
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC;
END;
$$ LANGUAGE plpgsql;

-- Create comprehensive validation report function
CREATE OR REPLACE FUNCTION generate_validation_report(
    source_version TEXT,
    target_version TEXT
) RETURNS TABLE (
    report_section TEXT,
    metric_name TEXT,
    metric_value TEXT,
    status TEXT
) AS $$
BEGIN
    -- Coverage metrics
    RETURN QUERY
    SELECT
        'COVERAGE'::TEXT,
        'Source Coverage'::TEXT,
        coverage_percent::TEXT || '%',
        CASE WHEN coverage_percent >= 80 THEN 'GOOD'
             WHEN coverage_percent >= 50 THEN 'FAIR'
             ELSE 'POOR' END
    FROM d2_function_coverage
    WHERE version = source_version;

    RETURN QUERY
    SELECT
        'COVERAGE'::TEXT,
        'Target Coverage'::TEXT,
        coverage_percent::TEXT || '%',
        CASE WHEN coverage_percent >= 80 THEN 'GOOD'
             WHEN coverage_percent >= 50 THEN 'FAIR'
             ELSE 'POOR' END
    FROM d2_function_coverage
    WHERE version = target_version;

    -- Match quality metrics
    RETURN QUERY
    SELECT
        'MATCH_QUALITY'::TEXT,
        'High Confidence Matches'::TEXT,
        COUNT(*)::TEXT,
        CASE WHEN COUNT(*) >= 10 THEN 'EXCELLENT'
             WHEN COUNT(*) >= 5 THEN 'GOOD'
             WHEN COUNT(*) >= 1 THEN 'FAIR'
             ELSE 'POOR' END
    FROM find_d2_function_patterns(source_version, target_version, 0.8);

    RETURN QUERY
    SELECT
        'MATCH_QUALITY'::TEXT,
        'Medium Confidence Matches'::TEXT,
        COUNT(*)::TEXT,
        CASE WHEN COUNT(*) >= 20 THEN 'EXCELLENT'
             WHEN COUNT(*) >= 10 THEN 'GOOD'
             WHEN COUNT(*) >= 3 THEN 'FAIR'
             ELSE 'POOR' END
    FROM find_d2_function_patterns(source_version, target_version, 0.7)
    WHERE source_func_name NOT IN (
        SELECT source_func_name
        FROM find_d2_function_patterns(source_version, target_version, 0.8)
    );

    -- Validation metrics
    RETURN QUERY
    SELECT
        'VALIDATION'::TEXT,
        'Strong Validations'::TEXT,
        COUNT(*)::TEXT,
        CASE WHEN COUNT(*) >= 5 THEN 'EXCELLENT'
             WHEN COUNT(*) >= 2 THEN 'GOOD'
             WHEN COUNT(*) >= 1 THEN 'FAIR'
             ELSE 'NONE' END
    FROM validate_matches_with_callgraph(source_version, target_version)
    WHERE recommendation = 'STRONG_VALIDATION';

    -- Conflict detection
    RETURN QUERY
    SELECT
        'CONFLICTS'::TEXT,
        'Naming Conflicts'::TEXT,
        COUNT(*)::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'CLEAN'
             WHEN COUNT(*) <= 2 THEN 'MINOR'
             ELSE 'MAJOR' END
    FROM detect_naming_conflicts(target_version)
    WHERE recommendation != 'NORMAL';

    RETURN;
END;
$$ LANGUAGE plpgsql;

-- Create function to suggest manual review candidates
CREATE OR REPLACE FUNCTION suggest_manual_reviews(
    source_version TEXT,
    target_version TEXT,
    limit_results INTEGER DEFAULT 10
) RETURNS TABLE (
    priority INTEGER,
    source_func_name VARCHAR(512),
    target_func_name VARCHAR(512),
    similarity_score REAL,
    issues TEXT,
    review_reason TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH review_candidates AS (
        SELECT
            fp.source_func_name,
            fp.target_func_name,
            fp.similarity_score,
            fp.confidence_level,
            fp.match_reason,
            vm.validation_score,
            vm.recommendation as validation_rec,
            ROW_NUMBER() OVER (ORDER BY
                CASE
                    WHEN fp.similarity_score BETWEEN 0.7 AND 0.79 THEN 1  -- Borderline similarity
                    WHEN fp.match_reason = 'GENERAL_SIMILARITY' THEN 2    -- No specific pattern
                    WHEN fp.similarity_score >= 0.8 AND vm.validation_score < 0.6 THEN 3  -- High sim, low validation
                    ELSE 4
                END,
                fp.similarity_score DESC
            ) as review_priority
        FROM find_d2_function_patterns(source_version, target_version, 0.6) fp
        LEFT JOIN validate_matches_with_callgraph(source_version, target_version) vm
            ON fp.source_func_name = vm.source_func_name
            AND fp.target_func_name = vm.target_func_name
        WHERE fp.confidence_level IN ('LOW', 'VERY_LOW')
        OR (fp.confidence_level = 'MEDIUM' AND vm.validation_score < 0.6)
    )
    SELECT
        rc.review_priority::INTEGER,
        rc.source_func_name,
        rc.target_func_name,
        rc.similarity_score,
        CASE
            WHEN rc.similarity_score BETWEEN 0.7 AND 0.79 THEN 'Borderline similarity score'
            WHEN rc.match_reason = 'GENERAL_SIMILARITY' THEN 'No specific pattern match'
            WHEN rc.validation_score < 0.6 THEN 'Low call graph validation'
            ELSE 'Multiple concerns'
        END as issues,
        CASE
            WHEN rc.review_priority = 1 THEN 'BORDERLINE_SIMILARITY'
            WHEN rc.review_priority = 2 THEN 'WEAK_PATTERN'
            WHEN rc.review_priority = 3 THEN 'VALIDATION_MISMATCH'
            ELSE 'GENERAL_CONCERN'
        END as review_reason
    FROM review_candidates rc
    WHERE rc.review_priority <= limit_results
    ORDER BY rc.review_priority;
END;
$$ LANGUAGE plpgsql;