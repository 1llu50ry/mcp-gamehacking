-- Remove Duplicate Fields from BSim Database
-- Migrate data from duplicate fields to BSim/API standard fields and drop duplicates

\echo 'Starting duplicate field removal process...'

-- ============================================================================
-- STEP 1: Migrate data from duplicate fields to primary fields
-- ============================================================================

\echo 'Step 1: Migrating data from duplicate fields...'

-- Migrate arch data to architecture (if any)
UPDATE exetable
SET architecture = COALESCE(architecture, arch)
WHERE architecture IS NULL AND arch IS NOT NULL;

-- Migrate name_compiler data to the BSim standard (if any)
UPDATE exetable
SET name_compiler = COALESCE(name_compiler, compiler_name)
WHERE name_compiler IS NULL AND compiler_name IS NOT NULL;

-- Migrate version_compiler data to the BSim standard (if any)
UPDATE exetable
SET version_compiler = COALESCE(version_compiler, compiler_version)
WHERE version_compiler IS NULL AND compiler_version IS NOT NULL;

-- Migrate repo data to the BSim standard (if any)
UPDATE exetable
SET repo = COALESCE(repo, repository)
WHERE repo IS NULL AND repository IS NOT NULL;

-- Migrate name_exec data to the BSim standard (if any)
UPDATE exetable
SET name_exec = COALESCE(name_exec, executable_name)
WHERE name_exec IS NULL AND executable_name IS NOT NULL;

\echo 'Data migration completed.'

-- ============================================================================
-- STEP 2: Drop duplicate fields
-- ============================================================================

\echo 'Step 2: Dropping duplicate fields...'

-- Drop indexes on duplicate fields first
DROP INDEX IF EXISTS idx_exetable_compiler_name;

-- Drop duplicate fields
ALTER TABLE exetable DROP COLUMN IF EXISTS arch;
ALTER TABLE exetable DROP COLUMN IF EXISTS compiler_name;
ALTER TABLE exetable DROP COLUMN IF EXISTS compiler_version;
ALTER TABLE exetable DROP COLUMN IF EXISTS repository;
ALTER TABLE exetable DROP COLUMN IF EXISTS executable_name;

\echo 'Duplicate fields dropped.'

-- ============================================================================
-- STEP 3: Verify remaining fields and data
-- ============================================================================

\echo 'Step 3: Verifying final schema...'

-- Show final exetable structure
\d exetable

-- Show sample data to verify migration worked
SELECT
    id,
    name_exec,
    architecture,
    name_compiler,
    version_compiler,
    repo
FROM exetable
LIMIT 3;

-- Count non-null values in primary fields
SELECT
    COUNT(*) as total_records,
    COUNT(name_exec) as name_exec_count,
    COUNT(architecture) as architecture_count,
    COUNT(name_compiler) as compiler_count,
    COUNT(version_compiler) as version_count,
    COUNT(repo) as repo_count
FROM exetable;

\echo 'Schema verification completed.'

-- ============================================================================
-- STEP 4: Update enhanced schema to reflect changes
-- ============================================================================

\echo 'Duplicate field removal process completed successfully!'
\echo 'Remaining fields use BSim standards and API-compatible names:'
\echo '  - name_exec (BSim original, used by API)'
\echo '  - architecture (used by API, was duplicate but has data)'
\echo '  - name_compiler (BSim original)'
\echo '  - version_compiler (BSim original)'
\echo '  - repo (BSim original)'
\echo ''
\echo 'Removed duplicate fields:'
\echo '  - arch (empty BSim original)'
\echo '  - compiler_name (duplicate)'
\echo '  - compiler_version (duplicate)'
\echo '  - repository (duplicate)'
\echo '  - executable_name (duplicate)'