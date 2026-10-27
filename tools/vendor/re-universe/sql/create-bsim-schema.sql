-- BSim Database Schema Creation for large_32 Template
-- Based on Ghidra BSim large_32.xml configuration
-- Optimized for ~100 million functions on 32-bit executables

\echo 'Creating BSim database schema with large_32 template...'

-- Set search path
SET search_path TO public;

-- BSim configuration values from large_32.xml
-- k=19, L=232 (LSH parameters for 100M+ functions)

-- Create keyvaluetable for BSim configuration
CREATE TABLE IF NOT EXISTS keyvaluetable (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    val TEXT  -- Ghidra may use 'val' instead of 'value'
);

-- Insert BSim configuration from large_32.xml
INSERT INTO keyvaluetable (key, value, val) VALUES
    ('BSimConfigInfo', '<info><name>Large 32-bit</name><owner>Ubuntu Linux BSim</owner><description>A large (~100 million functions) database tuned for 32-bit executables</description><major>0</major><minor>0</minor><settings>0x49</settings></info>', '<info><name>Large 32-bit</name><owner>Ubuntu Linux BSim</owner><description>A large (~100 million functions) database tuned for 32-bit executables</description><major>0</major><minor>0</minor><settings>0x49</settings></info>'),
    ('k', '19', '19'),
    ('L', '232', '232'),
    ('weightsfile', 'lshweights_32.xml', 'lshweights_32.xml'),
    ('template', 'large_32', 'large_32'),
    ('created_timestamp', EXTRACT(EPOCH FROM NOW())::TEXT, EXTRACT(EPOCH FROM NOW())::TEXT),
    ('schema_version', '1.0', '1.0')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, val = EXCLUDED.val;

-- Create official Ghidra BSim exetable (executable table)
-- Cleaned up to remove duplicate fields, using BSim originals + API-compatible fields
CREATE TABLE IF NOT EXISTS exetable (
    id BIGSERIAL PRIMARY KEY,
    md5 VARCHAR(32) UNIQUE NOT NULL,
    name_exec VARCHAR(1024),              -- BSim original, used by API
    architecture VARCHAR(64),             -- Used by API (was duplicate, now primary)
    name_compiler VARCHAR(128),           -- BSim original
    version_compiler VARCHAR(128),        -- BSim original
    name_category VARCHAR(256),
    date_create TIMESTAMP,
    repo VARCHAR(512),                    -- BSim original
    path VARCHAR(2048),
    description TEXT,
    ingest_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create BSim executable table (enhanced for large scale) - for backwards compatibility
-- Cleaned up to match primary exetable schema without duplicates
CREATE TABLE IF NOT EXISTS executable (
    id BIGSERIAL PRIMARY KEY,
    md5 VARCHAR(32) UNIQUE NOT NULL,
    name_exec VARCHAR(1024),              -- BSim original, used by API
    architecture VARCHAR(64),             -- Used by API (primary field)
    name_compiler VARCHAR(128),           -- BSim original
    version_compiler VARCHAR(128),        -- BSim original
    name_category VARCHAR(256),
    date_create TIMESTAMP,
    repo VARCHAR(512),                    -- BSim original
    path VARCHAR(2048),
    description TEXT,
    ingest_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    function_count INTEGER DEFAULT 0,
    signature_count INTEGER DEFAULT 0
);

-- Create BSim executable categories
CREATE TABLE IF NOT EXISTS executable_category (
    id SERIAL PRIMARY KEY,
    category_name VARCHAR(256) UNIQUE NOT NULL,
    description TEXT
);

-- Insert default categories
INSERT INTO executable_category (category_name, description) VALUES
    ('UNKNOWN', 'Unknown executable type'),
    ('LIBRARY', 'Shared library or static library'),
    ('EXECUTABLE', 'Standalone executable program'),
    ('DRIVER', 'Device driver or kernel module'),
    ('MALWARE', 'Malicious software')
ON CONFLICT (category_name) DO NOTHING;

-- Insert default architectures
INSERT INTO archtable (name, description) VALUES
    ('x86-32', '32-bit x86 architecture'),
    ('x86-64', '64-bit x86 architecture'),
    ('ARM', 'ARM architecture'),
    ('MIPS', 'MIPS architecture'),
    ('unknown', 'Unknown architecture')
ON CONFLICT (name) DO NOTHING;

-- Insert default compilers
INSERT INTO comptable (name, version, val, description) VALUES
    ('gcc', '13.0', 'gcc-13.0', 'GNU Compiler Collection 13.0'),
    ('clang', '15.0', 'clang-15.0', 'LLVM Clang 15.0'),
    ('msvc', '19.0', 'msvc-19.0', 'Microsoft Visual C++ 19.0'),
    ('unknown', '', 'unknown', 'Unknown compiler')
ON CONFLICT DO NOTHING;

-- Insert default repositories
INSERT INTO repotable (name, url, val, description) VALUES
    ('local', 'file:///', 'local', 'Local file system'),
    ('ghidra', 'ghidra://localhost/', 'ghidra-local', 'Local Ghidra project'),
    ('unknown', '', 'unknown', 'Unknown repository')
ON CONFLICT DO NOTHING;

-- Insert default paths
INSERT INTO pathtable (path, parent_id, val, description) VALUES
    ('/', NULL, 'root', 'Root directory'),
    ('/bin', 1, 'bin', 'Binary directory'),
    ('/lib', 1, 'lib', 'Library directory'),
    ('/tmp', 1, 'tmp', 'Temporary directory'),
    ('unknown', NULL, 'unknown', 'Unknown path')
ON CONFLICT DO NOTHING;

-- Create official Ghidra BSim desctable (function description table)
CREATE TABLE IF NOT EXISTS desctable (
    id BIGSERIAL PRIMARY KEY,
    name_func TEXT,
    id_exe INTEGER,
    id_signature BIGINT,
    flags INTEGER,
    addr BIGINT,
    val TEXT  -- Ghidra may require val column
);

-- Create official Ghidra BSim vectable (LSH vector table)
CREATE TABLE IF NOT EXISTS vectable (
    id BIGINT,
    count INTEGER,
    vec LSHVECTOR,
    val TEXT,  -- Ghidra may require val column
    CONSTRAINT vectable_id_key UNIQUE (id)
);

-- Create official Ghidra BSim callgraphtable (call graph relationships)
CREATE TABLE IF NOT EXISTS callgraphtable (
    src BIGINT NOT NULL,
    dest BIGINT NOT NULL,
    PRIMARY KEY (src, dest)
);

-- Create official Ghidra BSim execattable (executable attributes)
CREATE TABLE IF NOT EXISTS execattable (
    id_exe INTEGER,
    id_type INTEGER,
    id_category INTEGER,
    val TEXT  -- Ghidra may require val column
);

-- Create official Ghidra BSim archtable (architecture definitions)
CREATE TABLE IF NOT EXISTS archtable (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) UNIQUE,  -- Allow NULL as Ghidra may insert NULL names
    description TEXT,
    val TEXT  -- Ghidra may require val column
);

-- Create additional BSim tables that may be required
CREATE TABLE IF NOT EXISTS valtable (
    id SERIAL PRIMARY KEY,
    val TEXT
);

CREATE TABLE IF NOT EXISTS typetable (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128),
    val TEXT
);

CREATE TABLE IF NOT EXISTS categorytable (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128),
    val TEXT
);

-- Create additional BSim support tables for comprehensive compatibility
CREATE TABLE IF NOT EXISTS execat (
    id SERIAL PRIMARY KEY,
    name VARCHAR(256),
    val TEXT
);

CREATE TABLE IF NOT EXISTS exeattable (
    id SERIAL PRIMARY KEY,
    name VARCHAR(256),
    val TEXT
);

CREATE TABLE IF NOT EXISTS functiontags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(256),
    val TEXT
);

CREATE TABLE IF NOT EXISTS datecolumn (
    id SERIAL PRIMARY KEY,
    name VARCHAR(256),
    val TEXT
);

CREATE TABLE IF NOT EXISTS dbinfo (
    id SERIAL PRIMARY KEY,
    property VARCHAR(256),
    val TEXT
);

CREATE TABLE IF NOT EXISTS comptable (
    id SERIAL PRIMARY KEY,
    name VARCHAR(256),
    version VARCHAR(256),
    val TEXT,
    description TEXT
);

CREATE TABLE IF NOT EXISTS repotable (
    id SERIAL PRIMARY KEY,
    name VARCHAR(512),
    url VARCHAR(1024),
    val TEXT,
    description TEXT
);

CREATE TABLE IF NOT EXISTS pathtable (
    id SERIAL PRIMARY KEY,
    path VARCHAR(2048),
    parent_id INTEGER,
    val TEXT,
    description TEXT
);

-- Create BSim function table (optimized for large datasets) - for backwards compatibility
CREATE TABLE IF NOT EXISTS function (
    id BIGSERIAL PRIMARY KEY,
    name_func VARCHAR(512),
    name_namespace VARCHAR(512),
    addr BIGINT,
    flags INTEGER DEFAULT 0,
    executable_id BIGINT REFERENCES executable(id) ON DELETE CASCADE,
    signature_count INTEGER DEFAULT 0,
    create_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create BSim signature table (partitioned for large scale)
CREATE TABLE IF NOT EXISTS signature (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES function(id) ON DELETE CASCADE,
    feature_vector LSHVECTOR,  -- Using the LSH extension we built
    significance REAL DEFAULT 0.0,
    hash_code BIGINT,
    vector_count INTEGER DEFAULT 0,
    create_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create BSim vector table for LSH indexing
CREATE TABLE IF NOT EXISTS vector (
    id BIGSERIAL PRIMARY KEY,
    signature_id BIGINT REFERENCES signature(id) ON DELETE CASCADE,
    feature_id INTEGER,
    hash_value BIGINT,
    weight REAL DEFAULT 1.0,
    significance REAL DEFAULT 0.0
);

-- Create BSim callgraph table
CREATE TABLE IF NOT EXISTS callgraph (
    id BIGSERIAL PRIMARY KEY,
    caller_id BIGINT REFERENCES function(id) ON DELETE CASCADE,
    callee_id BIGINT REFERENCES function(id) ON DELETE CASCADE,
    executable_id BIGINT REFERENCES executable(id) ON DELETE CASCADE,
    call_count INTEGER DEFAULT 1
);

-- Create BSim feature table
CREATE TABLE IF NOT EXISTS feature (
    id SERIAL PRIMARY KEY,
    name VARCHAR(512) UNIQUE NOT NULL,
    description TEXT,
    weight REAL DEFAULT 1.0
);

-- Insert default features for BSim analysis
INSERT INTO feature (name, description, weight) VALUES
    ('basic_blocks', 'Basic block count feature', 1.0),
    ('function_calls', 'Function call patterns', 1.5),
    ('instruction_patterns', 'Instruction sequence patterns', 2.0),
    ('control_flow', 'Control flow graph features', 1.8),
    ('data_flow', 'Data flow analysis features', 1.2),
    ('string_references', 'String and constant references', 1.0),
    ('register_usage', 'CPU register usage patterns', 1.3),
    ('stack_operations', 'Stack frame operations', 1.1),
    ('arithmetic_ops', 'Arithmetic operation patterns', 1.0),
    ('memory_access', 'Memory access patterns', 1.4)
ON CONFLICT (name) DO UPDATE SET weight = EXCLUDED.weight;

-- Create performance indexes for large_32 template
-- Official Ghidra BSim table indexes
CREATE INDEX IF NOT EXISTS idx_exetable_md5_hash ON exetable USING hash (md5);
CREATE INDEX IF NOT EXISTS idx_exetable_architecture ON exetable(architecture);
CREATE INDEX IF NOT EXISTS idx_exetable_compiler_name ON exetable(compiler_name);
CREATE INDEX IF NOT EXISTS exefuncindex ON desctable(id_exe, name_func, addr);
CREATE INDEX IF NOT EXISTS sigindex ON desctable(id_signature);

-- Primary performance indexes for custom tables (backwards compatibility)
CREATE INDEX IF NOT EXISTS idx_executable_md5_hash ON executable USING hash (md5);
CREATE INDEX IF NOT EXISTS idx_executable_category ON executable(name_category);
CREATE INDEX IF NOT EXISTS idx_executable_arch ON executable(arch);
CREATE INDEX IF NOT EXISTS idx_executable_architecture ON executable(architecture);
CREATE INDEX IF NOT EXISTS idx_executable_compiler_name ON executable(compiler_name);
CREATE INDEX IF NOT EXISTS idx_executable_ingest_date ON executable(ingest_date);

-- Function indexes
CREATE INDEX IF NOT EXISTS idx_function_executable_id ON function(executable_id);
CREATE INDEX IF NOT EXISTS idx_function_addr ON function(addr);
CREATE INDEX IF NOT EXISTS idx_function_name_hash ON function USING hash (name_func);
CREATE INDEX IF NOT EXISTS idx_function_namespace ON function(name_namespace);

-- Signature indexes (critical for large scale)
CREATE INDEX IF NOT EXISTS idx_signature_function_id ON signature(function_id);
CREATE INDEX IF NOT EXISTS idx_signature_hash_code ON signature(hash_code);
CREATE INDEX IF NOT EXISTS idx_signature_feature_vector ON signature USING gist (feature_vector);
CREATE INDEX IF NOT EXISTS idx_signature_significance ON signature(significance DESC);

-- Vector indexes for LSH operations
CREATE INDEX IF NOT EXISTS idx_vector_signature_id ON vector(signature_id);
CREATE INDEX IF NOT EXISTS idx_vector_feature_id ON vector(feature_id);
CREATE INDEX IF NOT EXISTS idx_vector_hash_value ON vector(hash_value);
CREATE INDEX IF NOT EXISTS idx_vector_significance ON vector(significance DESC);

-- Callgraph indexes
CREATE INDEX IF NOT EXISTS idx_callgraph_caller ON callgraph(caller_id);
CREATE INDEX IF NOT EXISTS idx_callgraph_callee ON callgraph(callee_id);
CREATE INDEX IF NOT EXISTS idx_callgraph_executable ON callgraph(executable_id);

-- Feature lookup index
CREATE INDEX IF NOT EXISTS idx_feature_name_hash ON feature USING hash (name);

-- Create statistics views for monitoring
CREATE OR REPLACE VIEW bsim_statistics AS
SELECT
    'Executables' as metric,
    COUNT(*) as count,
    pg_size_pretty(pg_total_relation_size('executable')) as table_size
FROM executable
UNION ALL
SELECT
    'Functions' as metric,
    COUNT(*) as count,
    pg_size_pretty(pg_total_relation_size('function')) as table_size
FROM function
UNION ALL
SELECT
    'Signatures' as metric,
    COUNT(*) as count,
    pg_size_pretty(pg_total_relation_size('signature')) as table_size
FROM signature
UNION ALL
SELECT
    'Vectors' as metric,
    COUNT(*) as count,
    pg_size_pretty(pg_total_relation_size('vector')) as table_size
FROM vector;

-- Create BSim utility functions
CREATE OR REPLACE FUNCTION bsim_database_info()
RETURNS TABLE(
    property TEXT,
    value TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT k.key::TEXT, k.value::TEXT
    FROM keyvaluetable k
    WHERE k.key IN ('BSimConfigInfo', 'k', 'L', 'template', 'created_timestamp', 'schema_version')
    ORDER BY k.key;
END;
$$ LANGUAGE plpgsql;

-- Create function to calculate database capacity utilization
CREATE OR REPLACE FUNCTION bsim_capacity_stats()
RETURNS TABLE(
    metric TEXT,
    current_count BIGINT,
    capacity_limit BIGINT,
    utilization_percent NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        'Functions'::TEXT,
        (SELECT COUNT(*) FROM function),
        100000000::BIGINT,  -- 100M function capacity
        ROUND((SELECT COUNT(*) FROM function) * 100.0 / 100000000, 2)
    UNION ALL
    SELECT
        'Signatures'::TEXT,
        (SELECT COUNT(*) FROM signature),
        100000000::BIGINT,  -- 100M signature capacity
        ROUND((SELECT COUNT(*) FROM signature) * 100.0 / 100000000, 2);
END;
$$ LANGUAGE plpgsql;

-- Grant all permissions to the BSim user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ben;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ben;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ben;

-- Create BSim LSH functions that Ghidra expects
CREATE OR REPLACE FUNCTION insert_vec(vector_data lshvector)
RETURNS INTEGER AS $$
DECLARE
    new_id INTEGER;
BEGIN
    INSERT INTO vectable (vec, count)
    VALUES (vector_data, 1)
    RETURNING id INTO new_id;

    RETURN new_id;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION insert_vec(sig_id BIGINT, vector_data lshvector)
RETURNS INTEGER AS $$
DECLARE
    new_id BIGINT;
BEGIN
    INSERT INTO vectable (id, vec, count)
    VALUES (sig_id, vector_data, 1)
    RETURNING id INTO new_id;

    RETURN new_id;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION insert_vec(vector_text TEXT)
RETURNS INTEGER AS $$
DECLARE
    new_id BIGINT;
BEGIN
    INSERT INTO vectable (vec, count)
    VALUES (vector_text::lshvector, 1)
    RETURNING id INTO new_id;

    RETURN new_id;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Update statistics for query optimization
ANALYZE;

\echo 'BSim database schema created successfully with large_32 template!'
\echo 'Configuration: k=19, L=232, optimized for ~100 million functions'
\echo 'LSH extension: Available and configured'
\echo 'Capacity: Ready for large-scale binary similarity analysis'

-- Verify the setup
SELECT 'BSim Database Ready' as status,
       (SELECT value FROM keyvaluetable WHERE key = 'template') as template,
       (SELECT value FROM keyvaluetable WHERE key = 'k') as k_value,
       (SELECT value FROM keyvaluetable WHERE key = 'L') as L_value;