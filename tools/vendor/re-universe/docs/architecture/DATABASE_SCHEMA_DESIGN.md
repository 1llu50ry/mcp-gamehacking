# D2Docs Database Schema Design
## PostgreSQL + pgvector Enhanced Architecture

---

## 🎯 **Overview**

The database architecture extends the existing BSim PostgreSQL database with pgvector capabilities, hierarchical knowledge organization, and community mining integration. This design maintains backward compatibility while adding powerful semantic search and AI-driven knowledge management.

## 🗄️ **Core Architecture Principles**

### **1. Backward Compatibility**
- All existing BSim tables preserved without modification
- Existing queries continue to work unchanged
- New functionality added through extensions and additional tables

### **2. Hierarchical Knowledge Organization**
- Systems → Subsystems → Modules → Functions hierarchy
- Vector embeddings at each level for semantic search
- Cross-references between community knowledge and binary analysis

### **3. Provenance & Trust Management**
- Complete source attribution for all community knowledge
- Trust scoring and validation tracking
- Quality assurance and verification workflows

## 📊 **Extended Database Schema**

### **Core BSim Tables (Existing - Preserved)**
```sql
-- These tables remain unchanged for backward compatibility

-- Executable information
CREATE TABLE exetable (
    id SERIAL PRIMARY KEY,
    md5 VARCHAR(32),
    name_exec VARCHAR(255),
    architecture VARCHAR(50),
    ingest_date TIMESTAMP
);

-- Function descriptions and metadata
CREATE TABLE desctable (
    id SERIAL PRIMARY KEY,
    id_exe INTEGER REFERENCES exetable(id),
    name_func VARCHAR(255),
    address VARCHAR(20),
    flags INTEGER
);

-- Vector signatures for BSim similarity
CREATE TABLE vectable (
    id SERIAL PRIMARY KEY,
    id_desc INTEGER REFERENCES desctable(id),
    rowid INTEGER,
    vec BYTEA
);

-- Key-value configuration
CREATE TABLE keyvaluetable (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT
);
```

### **Enhanced Vector Search Extensions**
```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add semantic embeddings to existing function table
ALTER TABLE desctable
ADD COLUMN function_embedding vector(1536),
ADD COLUMN documentation_quality FLOAT DEFAULT 0.0,
ADD COLUMN ai_analysis_metadata JSONB,
ADD COLUMN last_analysis_date TIMESTAMP;

-- Create indexes for vector similarity search
CREATE INDEX idx_desctable_embedding ON desctable
USING hnsw (function_embedding vector_cosine_ops);

-- Performance indexes
CREATE INDEX idx_desctable_quality ON desctable (documentation_quality);
CREATE INDEX idx_desctable_analysis_date ON desctable (last_analysis_date);
```

### **Hierarchical Knowledge Architecture**
```sql
-- Top-level game systems (Player, Combat, World, etc.)
CREATE TABLE d2_systems (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,           -- "Player System"
    description TEXT,                            -- High-level system purpose
    system_embedding vector(1536),              -- Semantic search vector
    parent_system_id INTEGER REFERENCES d2_systems(id), -- For nested systems
    level INTEGER DEFAULT 0,                    -- 0=System, 1=Subsystem, 2=Module
    created_date TIMESTAMP DEFAULT NOW(),
    updated_date TIMESTAMP DEFAULT NOW()
);

-- Subsystems within game systems
CREATE TABLE d2_subsystems (
    id SERIAL PRIMARY KEY,
    system_id INTEGER NOT NULL REFERENCES d2_systems(id),
    name VARCHAR(255) NOT NULL,                  -- "Character Progression"
    description TEXT,                            -- Detailed subsystem responsibilities
    binary_files TEXT[],                         -- ["D2Game.dll", "D2Common.dll"]
    subsystem_embedding vector(1536),           -- Semantic search vector
    created_date TIMESTAMP DEFAULT NOW()
);

-- Implementation modules within subsystems
CREATE TABLE d2_modules (
    id SERIAL PRIMARY KEY,
    subsystem_id INTEGER NOT NULL REFERENCES d2_subsystems(id),
    name VARCHAR(255) NOT NULL,                  -- "Experience/Leveling Module"
    description TEXT,                            -- Module-level functionality
    primary_binary VARCHAR(100),                -- Main implementing DLL
    module_embedding vector(1536),              -- Semantic search vector
    created_date TIMESTAMP DEFAULT NOW()
);

-- Performance indexes for hierarchical queries
CREATE INDEX idx_systems_parent ON d2_systems (parent_system_id);
CREATE INDEX idx_systems_level ON d2_systems (level);
CREATE INDEX idx_subsystems_system ON d2_subsystems (system_id);
CREATE INDEX idx_modules_subsystem ON d2_modules (subsystem_id);

-- Vector similarity indexes
CREATE INDEX idx_systems_embedding ON d2_systems
USING hnsw (system_embedding vector_cosine_ops);
CREATE INDEX idx_subsystems_embedding ON d2_subsystems
USING hnsw (subsystem_embedding vector_cosine_ops);
CREATE INDEX idx_modules_embedding ON d2_modules
USING hnsw (module_embedding vector_cosine_ops);
```

### **Community Knowledge Management**
```sql
-- Community sources with trust tracking
CREATE TABLE community_sources (
    id SERIAL PRIMARY KEY,
    source_type VARCHAR(50) NOT NULL,            -- 'github', 'forum', 'blog', 'paper'
    source_url TEXT NOT NULL UNIQUE,            -- Original backlink (REQUIRED)
    source_title TEXT,
    author VARCHAR(255),
    discovery_date TIMESTAMP DEFAULT NOW(),
    last_verified TIMESTAMP,
    trust_score FLOAT DEFAULT 0.5,              -- Reliability (0.0-1.0)
    trust_factors JSONB,                         -- Detailed trust calculation
    is_active BOOLEAN DEFAULT true,
    verification_history JSONB                   -- Historical accuracy tracking
);

-- Community function knowledge with full provenance
CREATE TABLE community_function_knowledge (
    id SERIAL PRIMARY KEY,
    function_name VARCHAR(255) NOT NULL,
    binary_name VARCHAR(255),
    version_info VARCHAR(50),

    -- Hierarchy linking
    module_id INTEGER REFERENCES d2_modules(id),
    system_context TEXT,                         -- Auto-generated context description

    -- Community-sourced information
    community_prototype TEXT,
    community_description TEXT,
    community_parameters JSONB,                 -- Structured parameter information
    community_return_info JSONB,               -- Return value details
    community_notes TEXT,
    community_usage_examples TEXT[],            -- Code examples from community

    -- Verification against binary analysis
    ghidra_function_address VARCHAR(20),
    bsim_function_hash VARCHAR(64),
    desctable_id INTEGER REFERENCES desctable(id), -- Link to existing BSim data
    verification_status VARCHAR(20) DEFAULT 'unverified', -- 'verified', 'partial', 'conflicted'
    verification_confidence FLOAT DEFAULT 0.0,
    verification_notes TEXT,
    last_verification TIMESTAMP,

    -- AI analysis integration
    ai_analysis_metadata JSONB,                 -- AI insights and processing history
    documentation_completeness FLOAT DEFAULT 0.0, -- Based on your 10-step workflow
    quality_score FLOAT DEFAULT 0.0,           -- Overall quality assessment

    -- Vector search and semantic analysis
    knowledge_embedding vector(1536),          -- Function knowledge embedding
    description_embedding vector(1536),        -- Description-specific embedding

    -- Complete provenance tracking
    source_id INTEGER NOT NULL REFERENCES community_sources(id),
    original_context TEXT,                      -- Surrounding context from source
    extraction_metadata JSONB,                 -- How this knowledge was extracted
    discovered_date TIMESTAMP DEFAULT NOW(),
    last_updated TIMESTAMP DEFAULT NOW()
);

-- Link community knowledge to BSim functions
CREATE TABLE function_community_mapping (
    id SERIAL PRIMARY KEY,
    desctable_id INTEGER REFERENCES desctable(id),
    community_knowledge_id INTEGER REFERENCES community_function_knowledge(id),
    mapping_confidence FLOAT,                   -- Confidence in this mapping
    mapping_method VARCHAR(50),                 -- 'address_match', 'signature_match', 'name_match'
    verified_by VARCHAR(50) DEFAULT 'auto',    -- 'auto', 'human', 'ai'
    verification_date TIMESTAMP DEFAULT NOW(),
    mapping_notes TEXT
);

-- Performance indexes for community knowledge
CREATE INDEX idx_community_function_name ON community_function_knowledge (function_name);
CREATE INDEX idx_community_binary_name ON community_function_knowledge (binary_name);
CREATE INDEX idx_community_verification_status ON community_function_knowledge (verification_status);
CREATE INDEX idx_community_quality_score ON community_function_knowledge (quality_score DESC);
CREATE INDEX idx_community_source ON community_function_knowledge (source_id);

-- Vector similarity indexes for community knowledge
CREATE INDEX idx_community_knowledge_embedding ON community_function_knowledge
USING hnsw (knowledge_embedding vector_cosine_ops);
CREATE INDEX idx_community_description_embedding ON community_function_knowledge
USING hnsw (description_embedding vector_cosine_ops);

-- Mapping table indexes
CREATE INDEX idx_mapping_desctable ON function_community_mapping (desctable_id);
CREATE INDEX idx_mapping_community ON function_community_mapping (community_knowledge_id);
CREATE INDEX idx_mapping_confidence ON function_community_mapping (mapping_confidence DESC);
```

### **System Interaction & Relationship Tracking**
```sql
-- Cross-system relationships and interactions
CREATE TABLE system_interactions (
    id SERIAL PRIMARY KEY,
    system_a_id INTEGER REFERENCES d2_systems(id),
    system_b_id INTEGER REFERENCES d2_systems(id),
    interaction_type VARCHAR(50),                -- 'calls', 'depends_on', 'modifies', 'listens_to'
    description TEXT,                            -- Human-readable description
    confidence FLOAT DEFAULT 0.5,               -- Confidence in this relationship
    discovered_method VARCHAR(50),               -- 'static_analysis', 'community', 'live_analysis'
    evidence JSONB,                              -- Supporting evidence
    function_examples TEXT[],                    -- Example functions demonstrating interaction
    created_date TIMESTAMP DEFAULT NOW(),
    last_verified TIMESTAMP DEFAULT NOW()
);

-- Function call relationships for cross-system analysis
CREATE TABLE function_call_relationships (
    id SERIAL PRIMARY KEY,
    caller_function_id INTEGER REFERENCES desctable(id),
    callee_function_id INTEGER REFERENCES desctable(id),
    call_frequency INTEGER DEFAULT 1,           -- How often this call occurs
    call_context VARCHAR(100),                  -- 'direct', 'conditional', 'loop', 'error_handler'
    discovered_method VARCHAR(50),               -- 'static_analysis', 'live_analysis'
    confidence FLOAT DEFAULT 0.8,
    last_observed TIMESTAMP DEFAULT NOW()
);

-- Indexes for relationship analysis
CREATE INDEX idx_system_interactions_a ON system_interactions (system_a_id);
CREATE INDEX idx_system_interactions_b ON system_interactions (system_b_id);
CREATE INDEX idx_system_interactions_type ON system_interactions (interaction_type);
CREATE INDEX idx_function_calls_caller ON function_call_relationships (caller_function_id);
CREATE INDEX idx_function_calls_callee ON function_call_relationships (callee_function_id);
```

### **AI Model Performance & Cost Tracking**
```sql
-- AI model usage and performance tracking
CREATE TABLE ai_model_usage (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT NOW(),
    model_name VARCHAR(50),                      -- 'opus', 'sonnet', 'haiku'
    task_type VARCHAR(100),                      -- 'function_analysis', 'batch_renaming', etc.
    request_tokens INTEGER,
    response_tokens INTEGER,
    cost DECIMAL(10,6),                          -- Cost in USD
    execution_time_ms INTEGER,
    quality_score FLOAT,                         -- User feedback or validation score
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    user_session_id VARCHAR(100),
    request_context JSONB                        -- Additional context for analysis
);

-- Daily cost summaries for budget tracking
CREATE TABLE daily_cost_summary (
    date DATE PRIMARY KEY,
    total_cost DECIMAL(10,2),
    opus_cost DECIMAL(10,2),
    sonnet_cost DECIMAL(10,2),
    haiku_cost DECIMAL(10,2),
    request_count INTEGER,
    avg_quality_score FLOAT,
    budget_utilization FLOAT                    -- Percentage of daily budget used
);

-- Performance indexes
CREATE INDEX idx_ai_usage_timestamp ON ai_model_usage (timestamp);
CREATE INDEX idx_ai_usage_model ON ai_model_usage (model_name);
CREATE INDEX idx_ai_usage_task_type ON ai_model_usage (task_type);
CREATE INDEX idx_ai_usage_cost ON ai_model_usage (cost DESC);
CREATE INDEX idx_daily_cost_date ON daily_cost_summary (date DESC);
```

### **Chat Interface & User Interaction**
```sql
-- Chat conversations and user interactions
CREATE TABLE chat_sessions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(100) UNIQUE NOT NULL,
    user_ip VARCHAR(45),                         -- IPv4/IPv6 support
    user_agent TEXT,
    started_at TIMESTAMP DEFAULT NOW(),
    last_activity TIMESTAMP DEFAULT NOW(),
    total_queries INTEGER DEFAULT 0,
    context_data JSONB,                          -- Current page, function, etc.
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE chat_messages (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(100) REFERENCES chat_sessions(session_id),
    message_type VARCHAR(20),                    -- 'user', 'assistant', 'system'
    content TEXT,
    context_at_time JSONB,                      -- Page context when message sent
    model_used VARCHAR(50),                     -- Which AI model generated response
    response_time_ms INTEGER,
    cost DECIMAL(8,6),
    timestamp TIMESTAMP DEFAULT NOW()
);

-- User feedback for response quality
CREATE TABLE chat_feedback (
    id SERIAL PRIMARY KEY,
    message_id INTEGER REFERENCES chat_messages(id),
    feedback_type VARCHAR(20),                   -- 'thumbs_up', 'thumbs_down', 'rating'
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    feedback_text TEXT,
    timestamp TIMESTAMP DEFAULT NOW()
);

-- Chat performance indexes
CREATE INDEX idx_chat_sessions_active ON chat_sessions (is_active, last_activity);
CREATE INDEX idx_chat_messages_session ON chat_messages (session_id, timestamp);
CREATE INDEX idx_chat_feedback_message ON chat_feedback (message_id);
```

## 🔍 **Advanced Query Patterns**

### **Hierarchical Knowledge Queries**
```sql
-- Find all functions in a specific system
WITH RECURSIVE system_hierarchy AS (
    -- Base case: direct functions in modules
    SELECT
        s.name as system_name,
        ss.name as subsystem_name,
        m.name as module_name,
        cfk.function_name,
        cfk.id as knowledge_id
    FROM d2_systems s
    JOIN d2_subsystems ss ON s.id = ss.system_id
    JOIN d2_modules m ON ss.id = m.subsystem_id
    JOIN community_function_knowledge cfk ON m.id = cfk.module_id
    WHERE s.name = 'Player System'

    UNION ALL

    -- Recursive case: nested systems
    SELECT
        sh.system_name,
        sh.subsystem_name,
        sh.module_name,
        sh.function_name,
        sh.knowledge_id
    FROM system_hierarchy sh
    JOIN d2_systems nested ON nested.parent_system_id = (
        SELECT id FROM d2_systems WHERE name = sh.system_name
    )
)
SELECT * FROM system_hierarchy;
```

### **Semantic Similarity Search**
```sql
-- Find functions semantically similar to a query
SELECT
    cfk.function_name,
    cfk.community_description,
    cfk.verification_status,
    cs.source_url,
    cs.trust_score,
    (cfk.knowledge_embedding <=> $1::vector) as similarity_distance
FROM community_function_knowledge cfk
JOIN community_sources cs ON cfk.source_id = cs.id
WHERE cfk.verification_status IN ('verified', 'partial')
  AND cs.trust_score > 0.6
ORDER BY cfk.knowledge_embedding <=> $1::vector
LIMIT 20;
```

### **Cross-System Interaction Analysis**
```sql
-- Analyze how systems interact with each other
SELECT
    sa.name as from_system,
    sb.name as to_system,
    si.interaction_type,
    si.confidence,
    COUNT(*) as interaction_count,
    ARRAY_AGG(si.function_examples[1:3]) as example_functions
FROM system_interactions si
JOIN d2_systems sa ON si.system_a_id = sa.id
JOIN d2_systems sb ON si.system_b_id = sb.id
WHERE si.confidence > 0.7
GROUP BY sa.name, sb.name, si.interaction_type, si.confidence
ORDER BY interaction_count DESC;
```

### **Quality and Trust Analysis**
```sql
-- Analyze community knowledge quality by source type
SELECT
    cs.source_type,
    COUNT(*) as total_contributions,
    AVG(cfk.quality_score) as avg_quality,
    AVG(cs.trust_score) as avg_trust,
    COUNT(CASE WHEN cfk.verification_status = 'verified' THEN 1 END) as verified_count,
    COUNT(CASE WHEN cfk.verification_status = 'conflicted' THEN 1 END) as conflicted_count
FROM community_sources cs
JOIN community_function_knowledge cfk ON cs.id = cfk.source_id
WHERE cs.is_active = true
GROUP BY cs.source_type
ORDER BY avg_quality DESC;
```

## 📊 **Performance Optimization**

### **Materialized Views for Performance**
```sql
-- Pre-computed cross-version function analysis
CREATE MATERIALIZED VIEW cross_version_function_analysis AS
SELECT
    cfk.function_name,
    cfk.binary_name,
    COUNT(*) as version_count,
    ARRAY_AGG(DISTINCT cfk.version_info ORDER BY cfk.version_info) as versions,
    AVG(cfk.quality_score) as avg_quality,
    MAX(cfk.last_updated) as last_analysis_date,
    STRING_AGG(DISTINCT m.name, ', ') as modules
FROM community_function_knowledge cfk
LEFT JOIN d2_modules m ON cfk.module_id = m.id
WHERE cfk.verification_status IN ('verified', 'partial')
GROUP BY cfk.function_name, cfk.binary_name;

-- Index the materialized view
CREATE INDEX idx_cross_version_function_name ON cross_version_function_analysis (function_name);
CREATE INDEX idx_cross_version_binary ON cross_version_function_analysis (binary_name);

-- Refresh strategy (run daily)
CREATE OR REPLACE FUNCTION refresh_cross_version_analysis()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY cross_version_function_analysis;
END;
$$ LANGUAGE plpgsql;
```

### **Partitioning for Large Tables**
```sql
-- Partition AI model usage by month for better performance
CREATE TABLE ai_model_usage_partitioned (
    LIKE ai_model_usage INCLUDING ALL
) PARTITION BY RANGE (timestamp);

-- Create monthly partitions (example for 2025)
CREATE TABLE ai_model_usage_2025_01 PARTITION OF ai_model_usage_partitioned
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE ai_model_usage_2025_02 PARTITION OF ai_model_usage_partitioned
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

-- Auto-create future partitions
CREATE OR REPLACE FUNCTION create_monthly_partition(table_name text, start_date date)
RETURNS void AS $$
DECLARE
    partition_name text;
    end_date date;
BEGIN
    partition_name := table_name || '_' || to_char(start_date, 'YYYY_MM');
    end_date := start_date + interval '1 month';

    EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                   partition_name, table_name, start_date, end_date);
END;
$$ LANGUAGE plpgsql;
```

## 🔒 **Security & Data Integrity**

### **Row Level Security**
```sql
-- Enable RLS on sensitive tables
ALTER TABLE community_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_model_usage ENABLE ROW LEVEL SECURITY;

-- Admin-only access to cost data
CREATE POLICY admin_cost_access ON ai_model_usage
    FOR ALL TO admin_role
    USING (true);

-- Public read access to verified community knowledge
CREATE POLICY public_verified_knowledge ON community_function_knowledge
    FOR SELECT TO public
    USING (verification_status = 'verified' AND quality_score > 0.7);
```

### **Data Validation Functions**
```sql
-- Validate trust scores are within valid range
CREATE OR REPLACE FUNCTION validate_trust_score()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.trust_score < 0.0 OR NEW.trust_score > 1.0 THEN
        RAISE EXCEPTION 'Trust score must be between 0.0 and 1.0';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_trust_score_trigger
    BEFORE INSERT OR UPDATE ON community_sources
    FOR EACH ROW EXECUTE FUNCTION validate_trust_score();

-- Ensure community knowledge has required provenance
CREATE OR REPLACE FUNCTION validate_community_provenance()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.source_id IS NULL THEN
        RAISE EXCEPTION 'Community knowledge must have source attribution';
    END IF;

    IF NEW.original_context IS NULL OR LENGTH(NEW.original_context) < 10 THEN
        RAISE EXCEPTION 'Community knowledge must include original context';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_provenance_trigger
    BEFORE INSERT OR UPDATE ON community_function_knowledge
    FOR EACH ROW EXECUTE FUNCTION validate_community_provenance();
```

## 📈 **Monitoring & Maintenance**

### **Database Health Monitoring**
```sql
-- Database statistics and health metrics
CREATE VIEW database_health AS
SELECT
    'Total Functions' as metric,
    COUNT(*)::text as value
FROM desctable
UNION ALL
SELECT
    'Community Knowledge Items',
    COUNT(*)::text
FROM community_function_knowledge
UNION ALL
SELECT
    'Verified Knowledge %',
    ROUND(
        100.0 * COUNT(CASE WHEN verification_status = 'verified' THEN 1 END) / COUNT(*),
        1
    )::text || '%'
FROM community_function_knowledge
UNION ALL
SELECT
    'Average Trust Score',
    ROUND(AVG(trust_score), 3)::text
FROM community_sources
WHERE is_active = true;
```

### **Automated Maintenance Tasks**
```sql
-- Clean up old chat sessions (run weekly)
CREATE OR REPLACE FUNCTION cleanup_old_sessions()
RETURNS void AS $$
BEGIN
    -- Delete inactive sessions older than 30 days
    DELETE FROM chat_sessions
    WHERE last_activity < NOW() - INTERVAL '30 days'
      AND is_active = false;

    -- Archive old AI usage data (keep last 90 days in main table)
    INSERT INTO ai_model_usage_archive
    SELECT * FROM ai_model_usage
    WHERE timestamp < NOW() - INTERVAL '90 days';

    DELETE FROM ai_model_usage
    WHERE timestamp < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;
```

This database schema provides a robust foundation for the enhanced D2Docs platform, supporting semantic search, community knowledge integration, AI orchestration tracking, and comprehensive performance monitoring while maintaining full backward compatibility with existing BSim functionality.