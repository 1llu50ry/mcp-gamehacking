-- Clear BSim data for fresh reprocessing
-- Run this before reprocessing all programs with the fixed script

\echo 'Clearing BSim data for fresh reprocessing...'

-- Clear data tables (preserves schema and functions)
DELETE FROM function_analysis;
DELETE FROM enhanced_signatures;
DELETE FROM desctable;
DELETE FROM exetable;

-- Reset sequences to start from 1
SELECT setval('exetable_id_seq', 1, false);
SELECT setval('desctable_id_seq', 1, false);

-- Verify cleanup
\echo 'Cleanup verification:'
SELECT 'exetable' as table_name, COUNT(*) as row_count FROM exetable
UNION ALL
SELECT 'desctable' as table_name, COUNT(*) as row_count FROM desctable
UNION ALL
SELECT 'function_analysis' as table_name, COUNT(*) as row_count FROM function_analysis
UNION ALL
SELECT 'enhanced_signatures' as table_name, COUNT(*) as row_count FROM enhanced_signatures;

\echo 'Database cleared and ready for reprocessing!'
\echo 'Next step: Run Step1_AddProgramToBSimDatabase.java with UPDATE_ALL mode'