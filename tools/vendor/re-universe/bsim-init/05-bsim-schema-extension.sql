-- Architecturally Sound BSim Schema Extensions
-- Purpose: Minimal extensions to authentic BSim schema for enhanced analysis
-- Design Principles:
--   1. Extend existing tables instead of creating many new ones
--   2. Use generic relationships, not hard-coded version columns
--   3. Minimize table proliferation - consolidate related data
--   4. Support script requirements with minimal schema changes
--
-- Auto-executed on container initialization via /docker-entrypoint-initdb.d/
-- Runs after: 04-create-bsim-schema.sql (requires base BSim tables to exist)
--
-- Idempotent: Safe to re-run (uses IF NOT EXISTS, ADD COLUMN IF NOT EXISTS)

BEGIN;

-- ============================================================================
-- STEP 1: Extend authentic BSim tables with minimal additions
-- ============================================================================

-- Extend desctable (authentic BSim function table) with documentation fields
ALTER TABLE desctable ADD COLUMN IF NOT EXISTS return_type TEXT;
ALTER TABLE desctable ADD COLUMN IF NOT EXISTS calling_convention VARCHAR(32);
ALTER TABLE desctable ADD COLUMN IF NOT EXISTS namespace_path TEXT;
ALTER TABLE desctable ADD COLUMN IF NOT EXISTS plate_comment TEXT;
ALTER TABLE desctable ADD COLUMN IF NOT EXISTS doc_source VARCHAR(16) DEFAULT 'manual';
ALTER TABLE desctable ADD COLUMN IF NOT EXISTS completeness_score REAL DEFAULT 0.0;
ALTER TABLE desctable ADD COLUMN IF NOT EXISTS documented_at TIMESTAMP;
ALTER TABLE desctable ADD COLUMN IF NOT EXISTS enhanced_signature TEXT;

-- Extend exetable (authentic BSim executable table) with version metadata
-- game_version stores INTEGER version code (e.g., 1093 for 1.09d) - FK to game_versions.id
-- NOTE: game_version is the FIRST version this binary was seen in (canonical/origin version)
ALTER TABLE exetable ADD COLUMN IF NOT EXISTS sha256 VARCHAR(64);
ALTER TABLE exetable ADD COLUMN IF NOT EXISTS game_version INTEGER;
ALTER TABLE exetable ADD COLUMN IF NOT EXISTS version_family VARCHAR(16);
ALTER TABLE exetable ADD COLUMN IF NOT EXISTS is_reference BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- STEP 1b: Game Versions and Valid Executables Lookup Tables
-- ============================================================================

-- Game versions lookup table (id = version code for natural sorting)
-- Numeric code format: major*1000 + minor*10 + patch_letter_offset
CREATE TABLE IF NOT EXISTS game_versions (
    id INTEGER PRIMARY KEY,                       -- Version code: 1093 = 1.09d
    version_string VARCHAR(10) NOT NULL UNIQUE,  -- e.g., "1.09d"
    version_family VARCHAR(10) NOT NULL,          -- "Classic" or "LoD"
    description TEXT,                             -- Optional description
    created_at TIMESTAMP DEFAULT NOW()
);

-- Game versions will be populated dynamically by the Ghidra script as binaries are encountered
-- This ensures only versions with actual data are added to the database

-- Binary-to-Version junction table for tracking which versions contain each binary
-- Allows the same binary (by MD5) to be associated with multiple game versions
-- Example: Storm.dll might be identical in 1.04b, 1.04c, and 1.05
CREATE TABLE IF NOT EXISTS binary_versions (
    executable_id BIGINT REFERENCES exetable(id) ON DELETE CASCADE,
    game_version INTEGER REFERENCES game_versions(id) ON DELETE CASCADE,
    version_family VARCHAR(16),
    discovered_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (executable_id, game_version)
);

CREATE INDEX IF NOT EXISTS idx_binary_versions_exe ON binary_versions(executable_id);
CREATE INDEX IF NOT EXISTS idx_binary_versions_ver ON binary_versions(game_version);

-- Valid executables lookup table
CREATE TABLE IF NOT EXISTS valid_executables (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,      -- e.g., "D2Common.dll"
    exe_type VARCHAR(16) NOT NULL,          -- "dll" or "exe"
    description TEXT,                       -- What this binary does
    is_core BOOLEAN DEFAULT TRUE,           -- Core game file vs optional
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert complete Diablo 2 file list (executables, DLLs, MPQs, and data files)
INSERT INTO valid_executables (name, exe_type, description, is_core) VALUES
    -- Core executables
    ('Game.exe',        'exe', 'Main game executable', TRUE),
    ('Diablo II.exe',   'exe', 'Alternative main executable', TRUE),
    ('D2VidTst.exe',    'exe', 'Video test utility', FALSE),
    -- Core DLLs
    ('D2Client.dll',    'dll', 'Client-side game logic', TRUE),
    ('D2Common.dll',    'dll', 'Common game utilities', TRUE),
    ('D2Game.dll',      'dll', 'Game server logic', TRUE),
    ('D2Server.dll',    'dll', 'Dedicated server logic', TRUE),
    ('D2Lang.dll',      'dll', 'Language/localization', TRUE),
    ('D2Launch.dll',    'dll', 'Launcher functionality', TRUE),
    ('D2MCPClient.dll', 'dll', 'Battle.net MCP client', TRUE),
    ('D2Net.dll',       'dll', 'Network functionality', TRUE),
    ('D2Sound.dll',     'dll', 'Sound/audio system', TRUE),
    ('D2Win.dll',       'dll', 'Windows integration', TRUE),
    ('D2CMP.dll',       'dll', 'Compression utilities', TRUE),
    ('D2Multi.dll',     'dll', 'Multiplayer functionality', TRUE),
    ('D2DDraw.dll',     'dll', 'DirectDraw renderer', TRUE),
    ('D2Direct3D.dll',  'dll', 'Direct3D renderer', TRUE),
    ('D2Glide.dll',     'dll', 'Glide renderer', TRUE),
    ('D2Gfx.dll',       'dll', 'Graphics utilities', TRUE),
    ('D2Gdi.dll',       'dll', 'GDI renderer', TRUE),
    ('Fog.dll',         'dll', 'Memory/utility library', TRUE),
    ('Storm.dll',       'dll', 'MPQ archive handling', TRUE),
    ('Bnclient.dll',    'dll', 'Battle.net client', TRUE),
    ('Binkw32.dll',     'dll', 'Bink video playback', FALSE),
    ('Ijl11.dll',       'dll', 'Intel JPEG library', FALSE),
    ('SmackW32.dll',    'dll', 'Smacker video playback', FALSE),
    -- MPQ archives
    ('D2Data.mpq',      'mpq', 'Core game data archive', TRUE),
    ('D2Char.mpq',      'mpq', 'Character data archive', TRUE),
    ('D2Sfx.mpq',       'mpq', 'Sound effects archive', TRUE),
    ('D2Music.mpq',     'mpq', 'Music archive', TRUE),
    ('D2Speech.mpq',    'mpq', 'Speech audio archive', TRUE),
    ('D2Video.mpq',     'mpq', 'Video cutscenes archive', TRUE),
    ('D2Exp.mpq',       'mpq', 'Expansion data archive', FALSE),
    ('D2Xtalk.mpq',     'mpq', 'Expansion speech archive', FALSE),
    ('D2Xvideo.mpq',    'mpq', 'Expansion video archive', FALSE),
    ('Patch_D2.mpq',    'mpq', 'Patch data archive', FALSE),
    -- Language and configuration files
    ('D2.LNG',          'lng', 'Language configuration', TRUE),
    ('Patch.txt',       'txt', 'Patch notes', FALSE)
ON CONFLICT (name) DO NOTHING;

-- Add FK constraint from exetable.game_version to game_versions.id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_exetable_game_version'
    ) THEN
        ALTER TABLE exetable 
        ADD CONSTRAINT fk_exetable_game_version 
        FOREIGN KEY (game_version) REFERENCES game_versions(id)
        ON DELETE SET NULL;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not add FK constraint: %', SQLERRM;
END $$;

-- Helper function: Get version code from string
CREATE OR REPLACE FUNCTION get_version_code(version_str TEXT)
RETURNS INTEGER AS $$
DECLARE
    v_code INTEGER;
BEGIN
    SELECT id INTO v_code
    FROM game_versions
    WHERE version_string = version_str;
    
    RETURN v_code;
END;
$$ LANGUAGE plpgsql;

-- Helper function: Validate executable name
CREATE OR REPLACE FUNCTION is_valid_executable(exe_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM valid_executables WHERE name = exe_name
    );
END;
$$ LANGUAGE plpgsql;

-- Indexes for lookup tables and exetable extensions
CREATE INDEX IF NOT EXISTS idx_game_versions_family ON game_versions(version_family);
CREATE INDEX IF NOT EXISTS idx_valid_executables_name ON valid_executables(name);
CREATE INDEX IF NOT EXISTS idx_exetable_sha256 ON exetable(sha256);
CREATE INDEX IF NOT EXISTS idx_exetable_game_version ON exetable(game_version);

-- ============================================================================
-- STEP 2: Create minimal support tables for data that doesn't fit in BSim core
-- ============================================================================

-- Function parameters (referenced by scripts)
CREATE TABLE IF NOT EXISTS function_parameters (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    param_name VARCHAR(128),
    param_type VARCHAR(256),
    storage_location VARCHAR(64),
    param_comment TEXT,
    UNIQUE(function_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_func_params_function ON function_parameters(function_id);

-- Function signatures (populated by Step1)
CREATE TABLE IF NOT EXISTS function_signatures (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    signature_text TEXT,
    parameter_count INTEGER DEFAULT 0,
    return_type VARCHAR(256),
    calling_convention VARCHAR(32),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(function_id)
);

CREATE INDEX IF NOT EXISTS idx_func_sig_function ON function_signatures(function_id);

-- Enhanced signatures (expected by Step2 and Step5)
CREATE TABLE IF NOT EXISTS enhanced_signatures (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    executable_id INTEGER REFERENCES exetable(id) ON DELETE CASCADE,
    signature_hash TEXT,
    signature_data TEXT,
    lsh_vector TEXT,
    confidence_score REAL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(function_id)
);

CREATE INDEX IF NOT EXISTS idx_enhanced_sig_function ON enhanced_signatures(function_id);
CREATE INDEX IF NOT EXISTS idx_enhanced_sig_executable ON enhanced_signatures(executable_id);

-- Function similarity matrix (expected by Step4)
CREATE TABLE IF NOT EXISTS function_similarity_matrix (
    id BIGSERIAL PRIMARY KEY,
    source_function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    target_function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    similarity_score REAL NOT NULL,
    confidence_score REAL,
    match_type VARCHAR(32),
    computed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(source_function_id, target_function_id)
);

CREATE INDEX IF NOT EXISTS idx_sim_matrix_source ON function_similarity_matrix(source_function_id);
CREATE INDEX IF NOT EXISTS idx_sim_matrix_target ON function_similarity_matrix(target_function_id);
CREATE INDEX IF NOT EXISTS idx_sim_matrix_score ON function_similarity_matrix(similarity_score DESC);

-- Function analysis (expected by Step1)
CREATE TABLE IF NOT EXISTS function_analysis (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    executable_id INTEGER REFERENCES exetable(id) ON DELETE CASCADE,
    function_name VARCHAR(256),
    entry_address BIGINT,
    instruction_count INTEGER,
    basic_block_count INTEGER,
    cyclomatic_complexity INTEGER,
    calls_made INTEGER DEFAULT 0,
    calls_received INTEGER DEFAULT 0,
    has_loops BOOLEAN DEFAULT FALSE,
    has_recursion BOOLEAN DEFAULT FALSE,
    max_depth INTEGER DEFAULT 0,
    stack_frame_size INTEGER DEFAULT 0,
    calling_convention VARCHAR(32),
    is_leaf_function BOOLEAN DEFAULT FALSE,
    is_library_function BOOLEAN DEFAULT FALSE,
    is_thunk BOOLEAN DEFAULT FALSE,
    confidence_score REAL DEFAULT 1.0,
    complexity_score INTEGER,
    analyzed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(function_id, executable_id)
);

CREATE INDEX IF NOT EXISTS idx_func_analysis_function ON function_analysis(function_id);
CREATE INDEX IF NOT EXISTS idx_func_analysis_executable ON function_analysis(executable_id);

-- Function tags (lightweight tagging system)
CREATE TABLE IF NOT EXISTS function_tags (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    executable_id INTEGER REFERENCES exetable(id) ON DELETE CASCADE,
    tag_category VARCHAR(64),
    tag_value VARCHAR(128),
    confidence REAL DEFAULT 1.0,
    auto_generated BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(function_id, executable_id, tag_category, tag_value)
);

CREATE INDEX IF NOT EXISTS idx_func_tags_function ON function_tags(function_id);
CREATE INDEX IF NOT EXISTS idx_func_tags_category ON function_tags(tag_category);

-- ============================================================================
-- STEP 3: Create tables for import/export analysis (populated by Step1)
-- ============================================================================

-- API imports
CREATE TABLE IF NOT EXISTS api_imports (
    id BIGSERIAL PRIMARY KEY,
    executable_id INTEGER REFERENCES exetable(id) ON DELETE CASCADE,
    dll_name VARCHAR(128),
    function_name VARCHAR(256),
    ordinal_number INTEGER,
    is_delayed BOOLEAN DEFAULT FALSE,
    analyzed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(executable_id, dll_name, function_name)
);

CREATE INDEX IF NOT EXISTS idx_api_imports_executable ON api_imports(executable_id);
CREATE INDEX IF NOT EXISTS idx_api_imports_dll ON api_imports(dll_name);

-- API exports
CREATE TABLE IF NOT EXISTS api_exports (
    id BIGSERIAL PRIMARY KEY,
    executable_id INTEGER REFERENCES exetable(id) ON DELETE CASCADE,
    function_name VARCHAR(256),
    ordinal_number INTEGER,
    rva_address BIGINT,
    is_forwarded BOOLEAN DEFAULT FALSE,
    analyzed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(executable_id, function_name)
);

CREATE INDEX IF NOT EXISTS idx_api_exports_executable ON api_exports(executable_id);
CREATE INDEX IF NOT EXISTS idx_api_exports_function ON api_exports(function_name);

-- Function API usage (links functions to imports/exports)
-- Updated to match Step1 script expectations
CREATE TABLE IF NOT EXISTS function_api_usage (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    executable_id INTEGER REFERENCES exetable(id) ON DELETE CASCADE,
    api_name VARCHAR(256),
    api_import_id BIGINT REFERENCES api_imports(id) ON DELETE SET NULL,
    usage_type VARCHAR(32) DEFAULT 'call',
    usage_count INTEGER DEFAULT 1,
    reference_count INTEGER DEFAULT 1,
    analyzed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(function_id, executable_id, api_name)
);

CREATE INDEX IF NOT EXISTS idx_api_usage_function ON function_api_usage(function_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_executable ON function_api_usage(executable_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_import ON function_api_usage(api_import_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_api_name ON function_api_usage(api_name);

-- ============================================================================
-- STEP 4: Create tables for cross-reference analysis (populated by Step1)
-- ============================================================================

-- Function calls
CREATE TABLE IF NOT EXISTS function_calls (
    id BIGSERIAL PRIMARY KEY,
    caller_function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    callee_function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    call_type VARCHAR(32) DEFAULT 'direct',
    call_count INTEGER DEFAULT 1,
    analyzed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(caller_function_id, callee_function_id, call_type)
);

CREATE INDEX IF NOT EXISTS idx_func_calls_caller ON function_calls(caller_function_id);
CREATE INDEX IF NOT EXISTS idx_func_calls_callee ON function_calls(callee_function_id);

-- Data references
CREATE TABLE IF NOT EXISTS data_references (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    data_address BIGINT,
    reference_type VARCHAR(32),
    access_type VARCHAR(16),
    reference_count INTEGER DEFAULT 1,
    analyzed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(function_id, data_address, reference_type)
);

CREATE INDEX IF NOT EXISTS idx_data_refs_function ON data_references(function_id);
CREATE INDEX IF NOT EXISTS idx_data_refs_address ON data_references(data_address);

-- Call graph metrics
CREATE TABLE IF NOT EXISTS call_graph_metrics (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    incoming_calls INTEGER DEFAULT 0,
    outgoing_calls INTEGER DEFAULT 0,
    unique_callers INTEGER DEFAULT 0,
    unique_callees INTEGER DEFAULT 0,
    is_leaf BOOLEAN DEFAULT FALSE,
    is_entry_point BOOLEAN DEFAULT FALSE,
    computed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(function_id)
);

CREATE INDEX IF NOT EXISTS idx_call_metrics_function ON call_graph_metrics(function_id);

-- ============================================================================
-- STEP 5: Create tables for string analysis (populated by Step1)
-- ============================================================================

-- String references
CREATE TABLE IF NOT EXISTS string_references (
    id BIGSERIAL PRIMARY KEY,
    executable_id INTEGER REFERENCES exetable(id) ON DELETE CASCADE,
    string_address BIGINT,
    string_content TEXT,
    string_length INTEGER,
    encoding_type VARCHAR(16) DEFAULT 'ascii',
    analyzed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(executable_id, string_address)
);

CREATE INDEX IF NOT EXISTS idx_string_refs_executable ON string_references(executable_id);
CREATE INDEX IF NOT EXISTS idx_string_refs_content ON string_references USING gin(to_tsvector('english', string_content));

-- Function string references (links functions to strings)
CREATE TABLE IF NOT EXISTS function_string_refs (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    string_ref_id BIGINT REFERENCES string_references(id) ON DELETE CASCADE,
    usage_type VARCHAR(32) DEFAULT 'reference',
    reference_count INTEGER DEFAULT 1,
    analyzed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(function_id, string_ref_id)
);

CREATE INDEX IF NOT EXISTS idx_func_string_refs_function ON function_string_refs(function_id);
CREATE INDEX IF NOT EXISTS idx_func_string_refs_string ON function_string_refs(string_ref_id);

-- ============================================================================
-- STEP 6: Create comments table for Step3a
-- ============================================================================

-- Core comments (simplified from the script's complex requirement)
CREATE TABLE IF NOT EXISTS core_comment (
    id BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(32) NOT NULL,  -- 'function', 'executable', etc.
    entity_id BIGINT NOT NULL,         -- References desctable.id, exetable.id, etc.
    entity_name VARCHAR(256),          -- For display purposes
    content TEXT NOT NULL,
    content_html TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE,
    parent_id BIGINT REFERENCES core_comment(id) ON DELETE CASCADE,
    user_id INTEGER  -- Simple user reference
);

CREATE INDEX IF NOT EXISTS idx_core_comment_entity ON core_comment(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_core_comment_user ON core_comment(user_id);

-- Simple user table for comments
CREATE TABLE IF NOT EXISTS auth_user (
    id SERIAL PRIMARY KEY,
    username VARCHAR(150) UNIQUE NOT NULL,
    first_name VARCHAR(30),
    last_name VARCHAR(150),
    email VARCHAR(254),
    password VARCHAR(128),
    is_superuser BOOLEAN DEFAULT FALSE,
    is_staff BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    date_joined TIMESTAMP DEFAULT NOW()
);

-- Insert default user for comments
INSERT INTO auth_user (username, first_name, last_name, email, is_active, is_staff)
VALUES ('ghidra_script', 'Ghidra', 'Script', 'script@localhost', TRUE, FALSE)
ON CONFLICT (username) DO NOTHING;

-- ============================================================================
-- STEP 7: Single-Match Cross-Version System (Primary Version Focus)
-- ============================================================================

-- Primary version function equivalence (ONE record per function in primary version)
CREATE TABLE IF NOT EXISTS function_equivalence (
    id BIGSERIAL PRIMARY KEY,

    -- Primary version function (center of web table)
    primary_function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    primary_version VARCHAR(16) NOT NULL,
    binary_name VARCHAR(128) NOT NULL,
    canonical_name VARCHAR(256) NOT NULL,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    last_analyzed TIMESTAMP DEFAULT NOW(),

    -- Constraints to prevent database bloat
    UNIQUE(primary_function_id),
    UNIQUE(binary_name, primary_version) -- Only one primary version per binary
);

-- Single best matches (EXACTLY one match per version per primary function)
CREATE TABLE IF NOT EXISTS function_version_matches (
    id BIGSERIAL PRIMARY KEY,

    -- Links back to primary function
    equivalence_id BIGINT REFERENCES function_equivalence(id) ON DELETE CASCADE,

    -- Target version and function (the match)
    target_function_id BIGINT REFERENCES desctable(id) ON DELETE CASCADE,
    target_version VARCHAR(16) NOT NULL,

    -- Similarity data for color coding
    similarity_score REAL NOT NULL CHECK (similarity_score BETWEEN 0.0 AND 1.0),
    confidence_level VARCHAR(16) NOT NULL CHECK (confidence_level IN ('exact', 'high', 'medium', 'low')),

    -- Analysis metadata
    match_method VARCHAR(32) DEFAULT 'similarity_analysis',
    analyzed_at TIMESTAMP DEFAULT NOW(),

    -- CRITICAL: Exactly one match per version per primary function
    UNIQUE(equivalence_id, target_version),
    -- Prevent target function from matching multiple primary functions
    UNIQUE(target_function_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_equiv_primary_function ON function_equivalence(primary_function_id);
CREATE INDEX IF NOT EXISTS idx_equiv_binary_name ON function_equivalence(binary_name);
CREATE INDEX IF NOT EXISTS idx_equiv_primary_version ON function_equivalence(primary_version);

CREATE INDEX IF NOT EXISTS idx_matches_equivalence ON function_version_matches(equivalence_id);
CREATE INDEX IF NOT EXISTS idx_matches_target_version ON function_version_matches(target_version);
CREATE INDEX IF NOT EXISTS idx_matches_similarity ON function_version_matches(similarity_score DESC);

-- Auto-calculate confidence level from similarity score
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

-- Trigger to auto-set confidence level
CREATE OR REPLACE FUNCTION update_confidence_level()
RETURNS TRIGGER AS $$
BEGIN
    NEW.confidence_level = calculate_confidence_level(NEW.similarity_score);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_confidence_level ON function_version_matches;
CREATE TRIGGER trigger_update_confidence_level
    BEFORE INSERT OR UPDATE ON function_version_matches
    FOR EACH ROW
    EXECUTE FUNCTION update_confidence_level();

-- ============================================================================
-- STEP 8: Create compatibility views for script expectations
-- ============================================================================

-- Ensure scripts can find functions with proper joins
CREATE OR REPLACE VIEW v_enhanced_functions AS
SELECT
    d.id as function_id,
    d.name_func,
    d.addr,
    d.flags,
    d.return_type,
    d.calling_convention,
    d.plate_comment,
    e.id as executable_id,
    e.name_exec,
    e.md5,
    e.game_version,
    a.val as architecture,
    c.val as name_compiler,
    r.val as repository,
    p.val as path
FROM desctable d
JOIN exetable e ON d.id_exe = e.id
LEFT JOIN archtable a ON e.architecture = a.id
LEFT JOIN compilertable c ON e.name_compiler = c.id
LEFT JOIN repositorytable r ON e.repository = r.id
LEFT JOIN pathtable p ON e.path = p.id;

COMMENT ON VIEW v_enhanced_functions IS 'Complete function view combining authentic BSim with extensions';

-- Web-optimized cross-version table (your exact requirement)
CREATE OR REPLACE VIEW v_cross_version_web_table AS
SELECT
    fe.canonical_name,
    fe.binary_name,
    fe.primary_version,

    -- Primary function (center column of web table)
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

COMMENT ON VIEW v_cross_version_web_table IS 'Web-ready cross-version table with primary version focus and color-coding data';

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================

-- Verify all required tables exist for the scripts
SELECT 'Schema Extension Complete' as status,
    (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = 'public'
     AND table_name IN (
         'function_analysis', 'enhanced_signatures', 'function_similarity_matrix',
         'function_parameters', 'function_signatures', 'api_imports', 'api_exports',
         'function_api_usage', 'function_calls', 'data_references', 'call_graph_metrics',
         'string_references', 'function_string_refs', 'core_comment', 'auth_user',
         'function_equivalence', 'function_version_matches', 'game_versions', 'valid_executables'
     )) as required_tables_created;

SELECT 'Extension Columns Added' as status,
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_name = 'desctable'
     AND column_name IN ('return_type', 'calling_convention', 'plate_comment', 'enhanced_signature')) as desc_extensions,
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_name = 'exetable'
     AND column_name IN ('game_version', 'is_reference')) as exe_extensions;

-- Verify lookup tables populated
SELECT 'Game versions loaded:' as info, COUNT(*) as count FROM game_versions;
SELECT 'Valid executables loaded:' as info, COUNT(*) as count FROM valid_executables;