-- D2Docs Enhanced Database Schema Extensions
-- Adds pgvector support, system hierarchy, and AI orchestration tables
-- Based on: docs/architecture/DATABASE_SCHEMA_DESIGN.md
-- Auto-executed after BSim core schema initialization
--
-- Prerequisites: BSim schema from 04-create-bsim-schema.sql
-- Extensions: Requires pgvector extension
--
-- Last Updated: February 20, 2026

\echo '========================================='
\echo 'D2Docs Enhanced Schema Extensions'
\echo 'Adding: pgvector, hierarchy, AI features'
\echo 'Building on: Authentic BSim foundation'
\echo '========================================='
\echo ''

-- Set search path
SET search_path TO public;

-- =========================================================================
-- IDEMPOTENCY CHECK: Skip if extensions already exist
-- =========================================================================

DO $$
BEGIN
    -- Check if function_embeddings exists (main new table)
    IF EXISTS (
        SELECT FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename = 'function_embeddings'
    ) THEN
        RAISE NOTICE 'D2Docs enhanced schema already exists, skipping creation...';
        -- Exit by raising a handled exception
        RAISE EXCEPTION 'SKIP_ENHANCED_SCHEMA_CREATION' USING ERRCODE = 'P0001';
    END IF;
END $$;

-- =========================================================================
-- PGVECTOR EXTENSION SETUP
-- =========================================================================

\echo 'Setting up pgvector extension...'

-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify pgvector is available
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_available_extensions
        WHERE name = 'vector' AND installed_version IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'pgvector extension is not available. Please install pgvector.';
    END IF;
    RAISE NOTICE 'pgvector extension verified and enabled.';
END $$;

-- =========================================================================
-- CUSTOM DATA TYPES
-- =========================================================================

\echo 'Creating custom data types...'

-- Knowledge source types (for community mining)
CREATE TYPE knowledge_source_type AS ENUM (
    'github_repository',
    'github_issue',
    'github_discussion',
    'community_forum',
    'technical_blog',
    'wiki',
    'academic_paper',
    'documentation',
    'code_comment',
    'manual_entry'
);

-- Insight types (for community knowledge)
CREATE TYPE insight_type AS ENUM (
    'function_purpose',
    'algorithm_description',
    'parameter_explanation',
    'return_value_meaning',
    'side_effects',
    'optimization_note',
    'bug_report',
    'usage_example',
    'related_functions',
    'version_changes'
);

-- Validation statuses
CREATE TYPE validation_status AS ENUM (
    'pending',
    'validated',
    'rejected',
    'needs_review',
    'cross_validated'
);

-- Validation methods
CREATE TYPE validation_method AS ENUM (
    'automated_binary_check',
    'cross_reference_validation',
    'human_verification',
    'ai_consistency_check',
    'community_consensus'
);

-- =========================================================================
-- VECTOR SEARCH EXTENSIONS
-- =========================================================================

\echo 'Creating vector search tables...'

-- Function embeddings for semantic search
CREATE TABLE function_embeddings (
    function_id BIGINT PRIMARY KEY,
    embedding VECTOR(1536) NOT NULL,
    model_version VARCHAR(50) NOT NULL DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Foreign key to existing BSim desctable
    CONSTRAINT fk_function_embeddings_function
        FOREIGN KEY (function_id)
        REFERENCES desctable(id)
        ON DELETE CASCADE
);

-- Semantic search result cache
CREATE TABLE semantic_search_cache (
    query_hash VARCHAR(64) PRIMARY KEY,
    query_text TEXT NOT NULL,
    results JSONB NOT NULL,
    similarity_threshold FLOAT NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    result_count INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- =========================================================================
-- SYSTEM HIERARCHY TABLES
-- =========================================================================

\echo 'Creating D2 system hierarchy tables...'

-- D2 Systems (top level: Game Mechanics, UI, Network, etc.)
CREATE TABLE d2_systems (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    category VARCHAR(50),
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- D2 Subsystems (mid level: Inventory Management, Skill Trees, etc.)
CREATE TABLE d2_subsystems (
    id SERIAL PRIMARY KEY,
    system_id INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    version_introduced VARCHAR(10),
    complexity_score FLOAT DEFAULT 0.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Foreign key to systems
    CONSTRAINT fk_d2_subsystems_system
        FOREIGN KEY (system_id)
        REFERENCES d2_systems(id)
        ON DELETE CASCADE,
    -- Unique constraint within system
    UNIQUE(system_id, name)
);

-- D2 Modules (implementation level: specific functionality groups)
CREATE TABLE d2_modules (
    id SERIAL PRIMARY KEY,
    subsystem_id INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    file_pattern TEXT,
    responsibility TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Foreign key to subsystems
    CONSTRAINT fk_d2_modules_subsystem
        FOREIGN KEY (subsystem_id)
        REFERENCES d2_subsystems(id)
        ON DELETE CASCADE,
    -- Unique constraint within subsystem
    UNIQUE(subsystem_id, name)
);

-- Function hierarchy classification (links BSim functions to D2 modules)
CREATE TABLE d2_function_hierarchy (
    function_id BIGINT PRIMARY KEY,
    module_id INTEGER NOT NULL,
    classification_confidence FLOAT DEFAULT 0.0,
    auto_classified BOOLEAN DEFAULT FALSE,
    verified_by_human BOOLEAN DEFAULT FALSE,
    classification_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Foreign keys
    CONSTRAINT fk_d2_function_hierarchy_function
        FOREIGN KEY (function_id)
        REFERENCES desctable(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_d2_function_hierarchy_module
        FOREIGN KEY (module_id)
        REFERENCES d2_modules(id)
        ON DELETE CASCADE
);

-- =========================================================================
-- COMMUNITY KNOWLEDGE TABLES
-- =========================================================================

\echo 'Creating community knowledge tables...'

-- Knowledge sources (GitHub repos, forums, etc.)
CREATE TABLE knowledge_sources (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT UNIQUE,
    source_type knowledge_source_type NOT NULL,
    trust_score FLOAT DEFAULT 0.5 CHECK (trust_score >= 0.0 AND trust_score <= 1.0),
    quality_score FLOAT DEFAULT 0.5 CHECK (quality_score >= 0.0 AND quality_score <= 1.0),
    last_scanned TIMESTAMP WITH TIME ZONE,
    scan_frequency INTEGER DEFAULT 86400, -- seconds between scans
    metadata JSONB DEFAULT '{}',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Community insights about functions
CREATE TABLE community_insights (
    id SERIAL PRIMARY KEY,
    source_id INTEGER NOT NULL,
    function_id BIGINT NOT NULL,
    insight_type insight_type NOT NULL,
    content TEXT NOT NULL,
    confidence_score FLOAT DEFAULT 0.5 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
    validation_status validation_status DEFAULT 'pending',
    cross_references JSONB DEFAULT '[]',
    embedding VECTOR(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    validated_at TIMESTAMP WITH TIME ZONE,
    -- Foreign keys
    CONSTRAINT fk_community_insights_source
        FOREIGN KEY (source_id)
        REFERENCES knowledge_sources(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_community_insights_function
        FOREIGN KEY (function_id)
        REFERENCES desctable(id)
        ON DELETE CASCADE
);

-- Insight validation records
CREATE TABLE insight_validations (
    id SERIAL PRIMARY KEY,
    insight_id INTEGER NOT NULL,
    validation_method validation_method NOT NULL,
    validator_source TEXT, -- AI model, human ID, or validation system
    validation_score FLOAT CHECK (validation_score >= 0.0 AND validation_score <= 1.0),
    validation_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Foreign key
    CONSTRAINT fk_insight_validations_insight
        FOREIGN KEY (insight_id)
        REFERENCES community_insights(id)
        ON DELETE CASCADE
);

-- =========================================================================
-- AI ORCHESTRATION TABLES
-- =========================================================================

\echo 'Creating AI orchestration tables...'

-- AI request tracking
CREATE TABLE ai_requests (
    id SERIAL PRIMARY KEY,
    request_hash VARCHAR(64) UNIQUE,
    request_type VARCHAR(50) NOT NULL,
    model_used TEXT NOT NULL,
    cost_estimate DECIMAL(10,4),
    actual_cost DECIMAL(10,4),
    response_time INTEGER, -- milliseconds
    success BOOLEAN DEFAULT FALSE,
    cached BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Daily cost tracking
CREATE TABLE cost_tracking (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    model TEXT NOT NULL,
    total_requests INTEGER DEFAULT 0,
    total_cost DECIMAL(10,4) DEFAULT 0.0,
    budget_remaining DECIMAL(10,4),
    alert_triggered BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Unique constraint for daily model tracking
    UNIQUE(date, model)
);

-- =========================================================================
-- PERFORMANCE INDEXES
-- =========================================================================

\echo 'Creating performance indexes...'

-- Vector search indexes (HNSW for approximate nearest neighbor)
CREATE INDEX idx_function_embeddings_vector
ON function_embeddings USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200);

CREATE INDEX idx_community_insights_embedding
ON community_insights USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200)
WHERE embedding IS NOT NULL;

-- Semantic search cache indexes
CREATE INDEX idx_semantic_search_cache_expires
ON semantic_search_cache(expires_at);

CREATE INDEX idx_semantic_search_cache_query_hash
ON semantic_search_cache(query_hash);

-- Hierarchy navigation indexes
CREATE INDEX idx_d2_subsystems_system_id ON d2_subsystems(system_id);
CREATE INDEX idx_d2_modules_subsystem_id ON d2_modules(subsystem_id);
CREATE INDEX idx_d2_function_hierarchy_module_id ON d2_function_hierarchy(module_id);
CREATE INDEX idx_d2_function_hierarchy_confidence
ON d2_function_hierarchy(module_id, classification_confidence DESC);

-- Community knowledge indexes
CREATE INDEX idx_knowledge_sources_type_active
ON knowledge_sources(source_type, active)
WHERE active = TRUE;

CREATE INDEX idx_community_insights_function_confidence
ON community_insights(function_id, confidence_score DESC);

CREATE INDEX idx_community_insights_validation_status
ON community_insights(validation_status);

CREATE INDEX idx_insight_validations_insight_score
ON insight_validations(insight_id, validation_score DESC);

-- AI orchestration indexes
CREATE INDEX idx_ai_requests_created_model
ON ai_requests(created_at, model_used);

CREATE INDEX idx_cost_tracking_date_model
ON cost_tracking(date DESC, model);

-- Time-based indexes for monitoring
CREATE INDEX idx_function_embeddings_created
ON function_embeddings(created_at);

CREATE INDEX idx_community_insights_created
ON community_insights(created_at);

-- =========================================================================
-- HELPER FUNCTIONS AND TRIGGERS
-- =========================================================================

\echo 'Creating helper functions and triggers...'

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at maintenance
CREATE TRIGGER trigger_d2_systems_updated_at
    BEFORE UPDATE ON d2_systems
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_d2_subsystems_updated_at
    BEFORE UPDATE ON d2_subsystems
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_d2_modules_updated_at
    BEFORE UPDATE ON d2_modules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_d2_function_hierarchy_updated_at
    BEFORE UPDATE ON d2_function_hierarchy
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_function_embeddings_updated_at
    BEFORE UPDATE ON function_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate system hierarchy path
CREATE OR REPLACE FUNCTION get_function_hierarchy_path(func_id BIGINT)
RETURNS TEXT AS $$
DECLARE
    path_result TEXT;
BEGIN
    SELECT CONCAT(s.display_name, ' → ', sub.display_name, ' → ', m.display_name)
    INTO path_result
    FROM d2_function_hierarchy fh
    JOIN d2_modules m ON fh.module_id = m.id
    JOIN d2_subsystems sub ON m.subsystem_id = sub.id
    JOIN d2_systems s ON sub.system_id = s.id
    WHERE fh.function_id = func_id;

    RETURN COALESCE(path_result, 'Unclassified');
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- SEED DATA FOR HIERARCHY
-- =========================================================================

\echo 'Inserting D2 system hierarchy seed data...'

-- Insert D2 core systems
INSERT INTO d2_systems (name, display_name, description, category, priority) VALUES
    ('game_mechanics', 'Game Mechanics', 'Core game logic, calculations, and rules', 'core', 1),
    ('ui_interface', 'User Interface', 'Game UI, menus, and player interaction', 'frontend', 2),
    ('network_multiplayer', 'Network & Multiplayer', 'Network communication and multiplayer features', 'network', 3),
    ('graphics_rendering', 'Graphics & Rendering', 'Visual rendering, effects, and graphics pipeline', 'graphics', 4),
    ('audio_system', 'Audio System', 'Sound effects, music, and audio processing', 'audio', 5),
    ('file_io', 'File I/O & Data', 'File operations, save/load, data management', 'io', 6),
    ('memory_management', 'Memory Management', 'Memory allocation, garbage collection, optimization', 'system', 7);

-- Insert sample subsystems
INSERT INTO d2_subsystems (system_id, name, display_name, description, version_introduced) VALUES
    -- Game Mechanics subsystems
    ((SELECT id FROM d2_systems WHERE name = 'game_mechanics'), 'character_stats', 'Character Stats', 'Player attributes, levels, experience', '1.00'),
    ((SELECT id FROM d2_systems WHERE name = 'game_mechanics'), 'inventory', 'Inventory System', 'Item management, storage, equipment', '1.00'),
    ((SELECT id FROM d2_systems WHERE name = 'game_mechanics'), 'skills', 'Skills & Spells', 'Character abilities and magic system', '1.00'),
    ((SELECT id FROM d2_systems WHERE name = 'game_mechanics'), 'combat', 'Combat System', 'Damage calculation, hit detection, combat mechanics', '1.00'),
    -- UI subsystems
    ((SELECT id FROM d2_systems WHERE name = 'ui_interface'), 'panels', 'UI Panels', 'Inventory, character, skill panels', '1.00'),
    ((SELECT id FROM d2_systems WHERE name = 'ui_interface'), 'chat', 'Chat System', 'Text communication and commands', '1.00'),
    -- Graphics subsystems
    ((SELECT id FROM d2_systems WHERE name = 'graphics_rendering'), 'sprites', 'Sprite Management', '2D sprite rendering and animation', '1.00'),
    ((SELECT id FROM d2_systems WHERE name = 'graphics_rendering'), 'effects', 'Visual Effects', 'Particle effects, lighting, shadows', '1.07');

-- Insert sample modules
INSERT INTO d2_modules (subsystem_id, name, display_name, description) VALUES
    -- Character Stats modules
    ((SELECT id FROM d2_subsystems WHERE name = 'character_stats'), 'stat_calculation', 'Stat Calculation', 'Core attribute and derived stat calculations'),
    ((SELECT id FROM d2_subsystems WHERE name = 'character_stats'), 'experience', 'Experience System', 'XP gain, level progression, requirements'),
    -- Inventory modules
    ((SELECT id FROM d2_subsystems WHERE name = 'inventory'), 'item_management', 'Item Management', 'Item creation, modification, properties'),
    ((SELECT id FROM d2_subsystems WHERE name = 'inventory'), 'storage', 'Storage Operations', 'Inventory space, stash, cube operations'),
    -- Skills modules
    ((SELECT id FROM d2_subsystems WHERE name = 'skills'), 'skill_trees', 'Skill Trees', 'Skill prerequisites, point allocation'),
    ((SELECT id FROM d2_subsystems WHERE name = 'skills'), 'spell_casting', 'Spell Casting', 'Mana costs, casting mechanics, cooldowns');

-- =========================================================================
-- VIEWS FOR ENHANCED FUNCTIONALITY
-- =========================================================================

\echo 'Creating enhanced views...'

-- Enhanced function view with hierarchy and AI insights
CREATE VIEW functions_enhanced AS
SELECT
    d.id,
    d.name_func,
    d.addr,
    e.name_exec,
    e.md5 as executable_md5,
    get_function_hierarchy_path(d.id) as hierarchy_path,
    fh.classification_confidence,
    fh.auto_classified,
    fh.verified_by_human,
    fe.model_version as embedding_model,
    fe.created_at as embedding_created,
    (SELECT COUNT(*) FROM community_insights ci WHERE ci.function_id = d.id) as insight_count,
    (SELECT AVG(ci.confidence_score) FROM community_insights ci WHERE ci.function_id = d.id) as avg_insight_confidence
FROM desctable d
LEFT JOIN exetable e ON d.id_exe = e.id
LEFT JOIN d2_function_hierarchy fh ON d.id = fh.function_id
LEFT JOIN function_embeddings fe ON d.id = fe.function_id;

-- Community knowledge summary view
CREATE VIEW community_knowledge_summary AS
SELECT
    ks.name as source_name,
    ks.source_type,
    ks.trust_score,
    ks.quality_score,
    COUNT(ci.id) as insight_count,
    AVG(ci.confidence_score) as avg_confidence,
    MAX(ci.created_at) as latest_insight
FROM knowledge_sources ks
LEFT JOIN community_insights ci ON ks.id = ci.source_id
WHERE ks.active = TRUE
GROUP BY ks.id, ks.name, ks.source_type, ks.trust_score, ks.quality_score
ORDER BY insight_count DESC, ks.trust_score DESC;

-- =========================================================================
-- COMPLETION AND VERIFICATION
-- =========================================================================

\echo ''
\echo 'D2Docs enhanced schema extensions created successfully!'
\echo ''
\echo 'New Features Added:'
\echo '  ✓ pgvector extension for semantic search'
\echo '  ✓ Function embeddings and vector indexes'
\echo '  ✓ D2 system hierarchy (Systems → Subsystems → Modules)'
\echo '  ✓ Community knowledge mining support'
\echo '  ✓ AI orchestration and cost tracking'
\echo '  ✓ Performance indexes and helper functions'
\echo '  ✓ Enhanced views for complex queries'
\echo ''
\echo 'New Tables Created:'
\echo '  Vector Search: function_embeddings, semantic_search_cache'
\echo '  Hierarchy: d2_systems, d2_subsystems, d2_modules, d2_function_hierarchy'
\echo '  Community: knowledge_sources, community_insights, insight_validations'
\echo '  AI: ai_requests, cost_tracking'
\echo ''

-- Final verification of new tables
SELECT
    schemaname,
    tablename,
    tableowner
FROM pg_tables
WHERE schemaname = 'public'
    AND tablename IN (
        'function_embeddings', 'semantic_search_cache',
        'd2_systems', 'd2_subsystems', 'd2_modules', 'd2_function_hierarchy',
        'knowledge_sources', 'community_insights', 'insight_validations',
        'ai_requests', 'cost_tracking'
    )
ORDER BY tablename;

\echo ''
\echo 'Enhanced schema verification complete!'