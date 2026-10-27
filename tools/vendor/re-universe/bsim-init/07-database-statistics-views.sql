-- Database Statistics and Analysis Views
-- This script creates views for database structure analysis and statistics
--
-- Created: January 24, 2026
-- Purpose: Permanent views for database introspection and version statistics

\echo 'Creating database statistics and analysis views...'

-- Set search path
SET search_path TO public;

-- =========================================================================
-- DATABASE STRUCTURE VIEWS
-- =========================================================================

-- View to list all user tables with metadata
CREATE OR REPLACE VIEW database_tables_info AS
SELECT
    schemaname,
    tablename as table_name,
    tableowner as owner,
    'table'::text as table_type,
    pg_total_relation_size(schemaname||'.'||tablename)::bigint as size_bytes,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size_readable
FROM pg_tables
WHERE schemaname = 'public'
UNION ALL
SELECT
    schemaname,
    viewname as table_name,
    viewowner as owner,
    'view'::text as table_type,
    0::bigint as size_bytes,
    '0 bytes'::text as size_readable
FROM pg_views
WHERE schemaname = 'public'
ORDER BY table_name;

-- View to show table column information (equivalent to \d+ table)
CREATE OR REPLACE VIEW table_columns_info AS
SELECT
    t.table_name,
    c.column_name,
    c.ordinal_position,
    c.data_type,
    c.character_maximum_length,
    c.is_nullable,
    c.column_default,
    CASE
        WHEN pk.column_name IS NOT NULL THEN 'PRIMARY KEY'
        WHEN fk.column_name IS NOT NULL THEN 'FOREIGN KEY'
        ELSE NULL
    END as key_type
FROM information_schema.tables t
JOIN information_schema.columns c ON t.table_name = c.table_name
LEFT JOIN (
    SELECT ku.table_name, ku.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage ku
        ON tc.constraint_name = ku.constraint_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
LEFT JOIN (
    SELECT ku.table_name, ku.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage ku
        ON tc.constraint_name = ku.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
) fk ON c.table_name = fk.table_name AND c.column_name = fk.column_name
WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name, c.ordinal_position;

-- =========================================================================
-- VERSION STATISTICS VIEWS
-- =========================================================================

-- View showing which binaries are shared across multiple versions
-- Useful for identifying unchanged DLLs between patches
CREATE OR REPLACE VIEW shared_binaries AS
SELECT
    e.name_exec as binary_name,
    e.md5,
    COUNT(bv.game_version) as version_count,
    string_agg(gv.version_string, ', ' ORDER BY gv.id) as versions,
    MIN(gv.version_string) as first_version,
    MAX(gv.version_string) as last_version
FROM exetable e
JOIN binary_versions bv ON e.id = bv.executable_id
JOIN game_versions gv ON bv.game_version = gv.id
GROUP BY e.id, e.name_exec, e.md5
HAVING COUNT(bv.game_version) > 1
ORDER BY COUNT(bv.game_version) DESC, e.name_exec;

-- View for binary count per version (uses binary_versions junction table)
-- This counts ALL binaries in each version, including shared binaries
CREATE OR REPLACE VIEW version_binary_counts AS
SELECT
    gv.version_string,
    gv.version_family,
    COUNT(bv.executable_id) as binary_count,
    COUNT(CASE WHEN e.is_reference = true THEN 1 END) as reference_binaries,
    COUNT(CASE WHEN e.is_reference = false OR e.is_reference IS NULL THEN 1 END) as non_reference_binaries,
    MIN(bv.discovered_at) as first_ingested,
    MAX(bv.discovered_at) as last_ingested,
    string_agg(DISTINCT a.val, ', ' ORDER BY a.val) as architectures
FROM game_versions gv
LEFT JOIN binary_versions bv ON gv.id = bv.game_version
LEFT JOIN exetable e ON bv.executable_id = e.id
LEFT JOIN archtable a ON e.architecture = a.id
GROUP BY gv.id, gv.version_string, gv.version_family
ORDER BY gv.version_string;

-- Summary view for version families
CREATE OR REPLACE VIEW version_family_summary AS
SELECT
    version_family,
    COUNT(DISTINCT version_string) as version_count,
    SUM(binary_count) as total_binaries,
    AVG(binary_count)::numeric(10,2) as avg_binaries_per_version,
    MIN(binary_count) as min_binaries,
    MAX(binary_count) as max_binaries
FROM version_binary_counts
WHERE version_family IS NOT NULL
GROUP BY version_family
ORDER BY version_family;

-- Detailed binary analysis per version (uses binary_versions junction table)
CREATE OR REPLACE VIEW version_binary_details AS
SELECT
    gv.version_string,
    gv.version_family,
    gv.description as version_description,
    e.name_exec as binary_name,
    e.md5,
    e.sha256,
    a.val as architecture,
    c.val as compiler,
    bv.discovered_at as ingest_date,
    e.is_reference,
    pg_size_pretty((LENGTH(e.md5::text) * 8)::bigint) as hash_info,
    CASE
        WHEN e.name_exec LIKE '%.exe' THEN 'Executable'
        WHEN e.name_exec LIKE '%.dll' THEN 'Dynamic Library'
        ELSE 'Other'
    END as binary_type
FROM game_versions gv
JOIN binary_versions bv ON gv.id = bv.game_version
JOIN exetable e ON bv.executable_id = e.id
LEFT JOIN archtable a ON e.architecture = a.id
LEFT JOIN compilertable c ON e.name_compiler = c.id
ORDER BY gv.version_string, e.name_exec;

-- =========================================================================
-- DATABASE STATISTICS SUMMARY
-- =========================================================================

-- Overall database statistics view
CREATE OR REPLACE VIEW database_summary AS
SELECT
    'Total Tables' as metric,
    COUNT(*)::text as value
FROM database_tables_info
WHERE table_type = 'table'
UNION ALL
SELECT
    'Total Views' as metric,
    COUNT(*)::text as value
FROM database_tables_info
WHERE table_type = 'view'
UNION ALL
SELECT
    'Total Versions' as metric,
    COUNT(*)::text as value
FROM game_versions
UNION ALL
SELECT
    'Total Binaries' as metric,
    COUNT(*)::text as value
FROM exetable
UNION ALL
SELECT
    'Total Functions' as metric,
    COUNT(*)::text as value
FROM desctable
UNION ALL
SELECT
    'Version Families' as metric,
    COUNT(DISTINCT version_family)::text as value
FROM game_versions
WHERE version_family IS NOT NULL
UNION ALL
SELECT
    'Database Size' as metric,
    pg_size_pretty(pg_database_size(current_database())) as value;

-- =========================================================================
-- COMPLETION MESSAGE
-- =========================================================================

\echo 'Database statistics views created successfully!'
\echo ''
\echo 'Created views:'
\echo '  - database_tables_info (equivalent to \dt with metadata)'
\echo '  - table_columns_info (equivalent to \d+ for all tables)'
\echo '  - version_binary_counts (count of binaries per version)'
\echo '  - version_family_summary (summary statistics by family)'
\echo '  - version_binary_details (detailed binary information)'
\echo '  - database_summary (overall database statistics)'
\echo ''
\echo 'Usage examples:'
\echo '  SELECT * FROM version_binary_counts;'
\echo '  SELECT * FROM database_tables_info;'
\echo '  SELECT * FROM database_summary;'
\echo ''
\echo 'Database statistics views ready!'