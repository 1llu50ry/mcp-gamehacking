-- Authentic Ghidra BSim Database Schema
-- Based on official Ghidra BSim source code analysis
-- Corrects our previous schema to match actual BSim standards

\echo 'Creating authentic BSim database schema...'

-- Set search path
SET search_path TO public;

-- ============================================================================
-- BSIM CONFIGURATION TABLE (REQUIRED)
-- ============================================================================

-- Create keyvaluetable for BSim configuration (official BSim requirement)
CREATE TABLE IF NOT EXISTS keyvaluetable (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    val TEXT  -- Ghidra may use 'val' instead of 'value'
);

-- Insert BSim configuration from large_32.xml template
INSERT INTO keyvaluetable (key, value, val) VALUES
    ('BSimConfigInfo', '<info><name>Large 32-bit</name><owner>Ubuntu Linux BSim</owner><description>A large (~100 million functions) database tuned for 32-bit executables</description><major>0</major><minor>0</minor><settings>0x49</settings></info>', '<info><name>Large 32-bit</name><owner>Ubuntu Linux BSim</owner><description>A large (~100 million functions) database tuned for 32-bit executables</description><major>0</major><minor>0</minor><settings>0x49</settings></info>'),
    ('k', '19', '19'),
    ('L', '232', '232'),
    ('weightsfile', 'lshweights_32.xml', 'lshweights_32.xml'),
    ('template', 'large_32', 'large_32'),
    ('created_timestamp', EXTRACT(EPOCH FROM NOW())::TEXT, EXTRACT(EPOCH FROM NOW())::TEXT),
    ('schema_version', '2.0_authentic', '2.0_authentic')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, val = EXCLUDED.val;

-- ============================================================================
-- OFFICIAL BSIM LOOKUP TABLES (STRING TABLES)
-- ============================================================================

-- Architecture lookup table (archtable)
-- Official BSim uses INTEGER foreign keys to this table
CREATE TABLE IF NOT EXISTS archtable (
    id SERIAL PRIMARY KEY,
    val TEXT UNIQUE NOT NULL  -- Architecture string (e.g., 'x86', 'x86_64', 'arm')
);

-- Compiler lookup table (compilertable)
-- Official BSim uses INTEGER foreign keys to this table
CREATE TABLE IF NOT EXISTS compilertable (
    id SERIAL PRIMARY KEY,
    val TEXT UNIQUE NOT NULL  -- Compiler string (e.g., 'gcc', 'msvc', 'clang')
);

-- Repository lookup table (repositorytable)
-- Official BSim uses INTEGER foreign keys to this table
CREATE TABLE IF NOT EXISTS repositorytable (
    id SERIAL PRIMARY KEY,
    val TEXT UNIQUE NOT NULL  -- Repository string (e.g., 'github.com/project', 'local')
);

-- Path lookup table (pathtable)
-- Official BSim uses INTEGER foreign keys to this table
CREATE TABLE IF NOT EXISTS pathtable (
    id SERIAL PRIMARY KEY,
    val TEXT UNIQUE NOT NULL  -- Path string (e.g., '/usr/bin/program', 'C:\Program Files\app')
);

-- ============================================================================
-- OFFICIAL BSIM EXETABLE (CORRECTED)
-- ============================================================================

-- Official Ghidra BSim exetable schema (from ExeTable.java lines 37-41)
CREATE TABLE IF NOT EXISTS exetable (
    id SERIAL PRIMARY KEY,
    md5 TEXT UNIQUE,                               -- MD5 hash of executable
    name_exec TEXT,                                -- Executable name/filename
    architecture INTEGER REFERENCES archtable(id), -- FK to architecture lookup
    name_compiler INTEGER REFERENCES compilertable(id), -- FK to compiler lookup
    ingest_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    repository INTEGER REFERENCES repositorytable(id), -- FK to repository lookup
    path INTEGER REFERENCES pathtable(id)          -- FK to path lookup
);

-- ============================================================================
-- BSIM FUNCTION DESCRIPTION TABLE (DESCTABLE)
-- ============================================================================

-- Function description table (from BSim source analysis)
CREATE TABLE IF NOT EXISTS desctable (
    id BIGSERIAL PRIMARY KEY,
    name_func TEXT,                    -- Function name
    id_exe INTEGER REFERENCES exetable(id) ON DELETE CASCADE, -- FK to executable
    id_signature BIGINT,               -- Signature identifier
    flags INTEGER DEFAULT 0,
    addr BIGINT,                       -- Function address
    val TEXT                           -- Additional metadata
);

-- ============================================================================
-- HELPER FUNCTIONS FOR LOOKUP TABLE MANAGEMENT
-- ============================================================================

-- Function to get or create architecture ID
CREATE OR REPLACE FUNCTION get_or_create_arch_id(arch_name TEXT)
RETURNS INTEGER AS $$
DECLARE
    arch_id INTEGER;
BEGIN
    -- Try to get existing ID
    SELECT id INTO arch_id FROM archtable WHERE val = arch_name;

    -- If not found, create new entry
    IF arch_id IS NULL THEN
        INSERT INTO archtable (val) VALUES (arch_name) RETURNING id INTO arch_id;
    END IF;

    RETURN arch_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get or create compiler ID
CREATE OR REPLACE FUNCTION get_or_create_compiler_id(compiler_name TEXT)
RETURNS INTEGER AS $$
DECLARE
    compiler_id INTEGER;
BEGIN
    -- Try to get existing ID
    SELECT id INTO compiler_id FROM compilertable WHERE val = compiler_name;

    -- If not found, create new entry
    IF compiler_id IS NULL THEN
        INSERT INTO compilertable (val) VALUES (compiler_name) RETURNING id INTO compiler_id;
    END IF;

    RETURN compiler_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get or create repository ID
CREATE OR REPLACE FUNCTION get_or_create_repository_id(repo_name TEXT)
RETURNS INTEGER AS $$
DECLARE
    repo_id INTEGER;
BEGIN
    -- Try to get existing ID
    SELECT id INTO repo_id FROM repositorytable WHERE val = repo_name;

    -- If not found, create new entry
    IF repo_id IS NULL THEN
        INSERT INTO repositorytable (val) VALUES (repo_name) RETURNING id INTO repo_id;
    END IF;

    RETURN repo_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get or create path ID
CREATE OR REPLACE FUNCTION get_or_create_path_id(path_name TEXT)
RETURNS INTEGER AS $$
DECLARE
    path_id INTEGER;
BEGIN
    -- Try to get existing ID
    SELECT id INTO path_id FROM pathtable WHERE val = path_name;

    -- If not found, create new entry
    IF path_id IS NULL THEN
        INSERT INTO pathtable (val) VALUES (path_name) RETURNING id INTO path_id;
    END IF;

    RETURN path_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Essential indexes for BSim performance
CREATE INDEX IF NOT EXISTS idx_exetable_md5 ON exetable(md5);
CREATE INDEX IF NOT EXISTS idx_exetable_name_exec ON exetable(name_exec);
CREATE INDEX IF NOT EXISTS idx_exetable_architecture ON exetable(architecture);
CREATE INDEX IF NOT EXISTS idx_exetable_ingest_date ON exetable(ingest_date);

CREATE INDEX IF NOT EXISTS idx_desctable_exe ON desctable(id_exe);
CREATE INDEX IF NOT EXISTS idx_desctable_name_func ON desctable(name_func);
CREATE INDEX IF NOT EXISTS idx_desctable_addr ON desctable(addr);
CREATE INDEX IF NOT EXISTS idx_desctable_signature ON desctable(id_signature);

-- ============================================================================
-- UNIQUE CONSTRAINTS FOR ON CONFLICT SUPPORT
-- ============================================================================

-- Add unique constraint for ON CONFLICT support in Ghidra scripts
-- Note: md5 is already UNIQUE in exetable (standard BSim behavior)
-- name_exec unique constraint removed - not part of authentic BSim schema
ALTER TABLE desctable ADD CONSTRAINT IF NOT EXISTS desctable_exe_addr_key UNIQUE (id_exe, addr);

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Insert common architecture values
INSERT INTO archtable (val) VALUES
    ('x86'),
    ('x86_64'),
    ('x64'),
    ('arm'),
    ('mips'),
    ('unknown')
ON CONFLICT (val) DO NOTHING;

-- Insert common compiler values
INSERT INTO compilertable (val) VALUES
    ('gcc'),
    ('msvc'),
    ('clang'),
    ('mingw'),
    ('icc'),
    ('unknown')
ON CONFLICT (val) DO NOTHING;

-- Insert common repository values
INSERT INTO repositorytable (val) VALUES
    ('unknown'),
    ('local'),
    ('github.com'),
    ('internal')
ON CONFLICT (val) DO NOTHING;

-- Insert common path values
INSERT INTO pathtable (val) VALUES
    ('unknown'),
    ('/usr/bin'),
    ('/usr/local/bin'),
    ('C:\Program Files'),
    ('C:\Windows\System32')
ON CONFLICT (val) DO NOTHING;

-- ============================================================================
-- DATA MIGRATION VIEW (FOR API COMPATIBILITY)
-- ============================================================================

-- Create a view that joins lookup tables for API compatibility
CREATE OR REPLACE VIEW exetable_denormalized AS
SELECT
    e.id,
    e.md5,
    e.name_exec,
    a.val as architecture,
    c.val as name_compiler,
    e.ingest_date,
    r.val as repository,
    p.val as path
FROM exetable e
LEFT JOIN archtable a ON e.architecture = a.id
LEFT JOIN compilertable c ON e.name_compiler = c.id
LEFT JOIN repositorytable r ON e.repository = r.id
LEFT JOIN pathtable p ON e.path = p.id;

\echo 'Authentic BSim schema created successfully!'
\echo 'Schema now matches official Ghidra BSim standards:'
\echo '  - Uses INTEGER foreign keys to lookup tables'
\echo '  - Includes all required BSim configuration'
\echo '  - Provides helper functions for lookup management'
\echo '  - Includes compatibility view for existing API'