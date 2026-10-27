-- ============================================================================
-- VERSION AND EXECUTABLE LOOKUP TABLES
-- ============================================================================
-- Creates enumeration tables for valid game versions and executable names
-- These tables constrain what can be inserted into exetable

-- ============================================================================
-- GAME VERSIONS TABLE
-- ============================================================================
-- Enumerated list of valid Diablo 2 versions with numeric codes
-- Numeric code format: major*1000 + minor*10 + patch_letter_offset
-- Example: 1.04b = 1000 + 40 + 1 = 1041

CREATE TABLE IF NOT EXISTS game_versions (
    id INTEGER PRIMARY KEY,                       -- Version code: 1093 = 1.09d
    version_string VARCHAR(10) NOT NULL UNIQUE,  -- e.g., "1.09d"
    version_family VARCHAR(10) NOT NULL,          -- "Classic" or "LoD"
    description TEXT,                             -- Optional description
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert all known Diablo 2 versions (id = version code for direct sorting)
INSERT INTO game_versions (id, version_string, version_family, description) VALUES
    -- Classic era (1.00 - 1.06b)
    (1000, '1.00',  'Classic', 'Original release'),
    (1010, '1.01',  'Classic', 'First patch'),
    (1020, '1.02',  'Classic', 'Bug fixes'),
    (1030, '1.03',  'Classic', 'Balance changes'),
    (1040, '1.04',  'Classic', 'Major update'),
    (1041, '1.04b', 'Classic', 'Bug fix patch'),
    (1042, '1.04c', 'Classic', 'Bug fix patch'),
    (1050, '1.05',  'Classic', 'Pre-LoD update'),
    (1051, '1.05b', 'Classic', 'Bug fix patch'),
    (1060, '1.06',  'Classic', 'Final Classic-era patch'),
    (1061, '1.06b', 'Classic', 'Bug fix patch'),
    -- LoD era (1.07+)
    (1070, '1.07',  'LoD', 'Lord of Destruction release'),
    (1080, '1.08',  'LoD', 'LoD patch'),
    (1090, '1.09',  'LoD', 'Major LoD update'),
    (1091, '1.09b', 'LoD', 'Bug fix patch'),
    (1093, '1.09d', 'LoD', 'Bug fix patch'),
    (1100, '1.10',  'LoD', 'Synergies patch'),
    (1101, '1.10s', 'LoD', 'Beta/test version'),
    (1110, '1.11',  'LoD', 'Uber content'),
    (1111, '1.11b', 'LoD', 'Bug fix patch'),
    (1120, '1.12',  'LoD', 'No-CD patch'),
    (1121, '1.12a', 'LoD', 'Bug fix patch'),
    (1130, '1.13',  'LoD', 'Respec patch'),
    (1132, '1.13c', 'LoD', 'Bug fix patch'),
    (1133, '1.13d', 'LoD', 'Final 1.13 patch'),
    (1140, '1.14',  'LoD', 'Windows 10 compatibility'),
    (1141, '1.14a', 'LoD', 'Bug fix patch'),
    (1142, '1.14b', 'LoD', 'Bug fix patch'),
    (1143, '1.14c', 'LoD', 'Bug fix patch'),
    (1144, '1.14d', 'LoD', 'Final legacy patch')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- VALID EXECUTABLES TABLE
-- ============================================================================
-- Known Diablo 2 executable/DLL names that can be added to the database

CREATE TABLE IF NOT EXISTS valid_executables (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,      -- e.g., "D2Common.dll"
    exe_type VARCHAR(16) NOT NULL,          -- "dll" or "exe"
    description TEXT,                       -- What this binary does
    is_core BOOLEAN DEFAULT TRUE,           -- Core game file vs optional
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert known Diablo 2 executables and DLLs
INSERT INTO valid_executables (name, exe_type, description, is_core) VALUES
    -- Core executables
    ('Game.exe',       'exe', 'Main game executable', TRUE),
    ('Diablo II.exe',  'exe', 'Alternative main executable', TRUE),
    -- Core DLLs
    ('D2Client.dll',   'dll', 'Client-side game logic', TRUE),
    ('D2Common.dll',   'dll', 'Common game utilities', TRUE),
    ('D2Game.dll',     'dll', 'Game server logic', TRUE),
    ('D2Lang.dll',     'dll', 'Language/localization', TRUE),
    ('D2Launch.dll',   'dll', 'Launcher functionality', TRUE),
    ('D2MCPClient.dll','dll', 'Battle.net MCP client', TRUE),
    ('D2Net.dll',      'dll', 'Network functionality', TRUE),
    ('D2Sound.dll',    'dll', 'Sound/audio system', TRUE),
    ('D2Win.dll',      'dll', 'Windows integration', TRUE),
    ('D2CMP.dll',      'dll', 'Compression utilities', TRUE),
    ('D2Multi.dll',    'dll', 'Multiplayer functionality', TRUE),
    ('D2DDraw.dll',    'dll', 'DirectDraw renderer', TRUE),
    ('D2Direct3D.dll', 'dll', 'Direct3D renderer', TRUE),
    ('D2Glide.dll',    'dll', 'Glide renderer', TRUE),
    ('D2gfx.dll',      'dll', 'Graphics utilities', TRUE),
    ('Fog.dll',        'dll', 'Memory/utility library', TRUE),
    ('Storm.dll',      'dll', 'MPQ archive handling', TRUE),
    ('Bnclient.dll',   'dll', 'Battle.net client', TRUE),
    ('ijl11.dll',      'dll', 'Intel JPEG library', FALSE),
    ('SmackW32.dll',   'dll', 'Smacker video playback', FALSE)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- ADD SHA256 COLUMN TO EXETABLE
-- ============================================================================

ALTER TABLE exetable ADD COLUMN IF NOT EXISTS sha256 TEXT;

-- ============================================================================
-- UPDATE GAME_VERSION TO REFERENCE VERSIONS TABLE
-- ============================================================================
-- Note: We keep game_version as an integer that matches version_code
-- This allows direct foreign key relationship

-- First, update any existing game_version text values to version codes
-- (This handles migration from string-based to integer-based)

-- ============================================================================
-- CONVERT GAME_VERSION FROM VARCHAR TO INTEGER
-- ============================================================================
-- First migrate any existing data, then change the column type

DO $$
DECLARE
    col_type TEXT;
BEGIN
    -- Get current column type
    SELECT data_type INTO col_type
    FROM information_schema.columns 
    WHERE table_name = 'exetable' AND column_name = 'game_version';
    
    IF col_type IS NULL THEN
        RAISE NOTICE 'game_version column does not exist - will be created as INTEGER';
    ELSIF col_type = 'integer' THEN
        RAISE NOTICE 'game_version is already INTEGER type';
    ELSE
        -- It's a text/varchar type, need to convert
        RAISE NOTICE 'Converting game_version from % to INTEGER', col_type;
        
        -- Create temporary column
        ALTER TABLE exetable ADD COLUMN IF NOT EXISTS game_version_new INTEGER;
        
        -- Migrate data: convert version strings to version codes (id)
        UPDATE exetable e
        SET game_version_new = gv.id
        FROM game_versions gv
        WHERE e.game_version = gv.version_string
          AND e.game_version IS NOT NULL
          AND e.game_version_new IS NULL;
        
        -- Drop old column and rename new
        ALTER TABLE exetable DROP COLUMN game_version;
        ALTER TABLE exetable RENAME COLUMN game_version_new TO game_version;
        
        RAISE NOTICE 'Converted game_version to INTEGER';
    END IF;
END $$;

-- Add the foreign key constraint
DO $$
BEGIN
    -- Check if game_version column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'exetable' AND column_name = 'game_version'
    ) THEN
        -- Try to add foreign key
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'fk_exetable_game_version'
        ) THEN
            ALTER TABLE exetable 
            ADD CONSTRAINT fk_exetable_game_version 
            FOREIGN KEY (game_version) REFERENCES game_versions(id)
            ON DELETE SET NULL;
            RAISE NOTICE 'Added foreign key constraint on exetable.game_version';
        ELSE
            RAISE NOTICE 'Foreign key constraint already exists';
        END IF;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not add FK constraint: %', SQLERRM;
END $$;

-- ============================================================================
-- ADD UNIQUE CONSTRAINT ON NAME_EXEC
-- ============================================================================
-- Now that we're using plain executable names + version, we need uniqueness
-- on the combination of (name_exec, game_version) instead of just name_exec

DO $$
BEGIN
    -- Drop old name_exec only constraint if exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'exetable_name_exec_key'
    ) THEN
        ALTER TABLE exetable DROP CONSTRAINT exetable_name_exec_key;
        RAISE NOTICE 'Dropped old exetable_name_exec_key constraint';
    END IF;
    
    -- Add new composite unique constraint
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'exetable_name_version_key'
    ) THEN
        ALTER TABLE exetable ADD CONSTRAINT exetable_name_version_key 
        UNIQUE (name_exec, game_version);
        RAISE NOTICE 'Added unique constraint on (name_exec, game_version)';
    END IF;
END $$;

-- ============================================================================
-- HELPER FUNCTION: Get version code from string
-- ============================================================================

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

-- ============================================================================
-- HELPER FUNCTION: Validate executable name
-- ============================================================================

CREATE OR REPLACE FUNCTION is_valid_executable(exe_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM valid_executables WHERE name = exe_name
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_game_versions_family ON game_versions(version_family);
CREATE INDEX IF NOT EXISTS idx_valid_executables_name ON valid_executables(name);
CREATE INDEX IF NOT EXISTS idx_exetable_sha256 ON exetable(sha256);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'Game versions loaded:' as info, COUNT(*) as count FROM game_versions;
SELECT 'Valid executables loaded:' as info, COUNT(*) as count FROM valid_executables;
