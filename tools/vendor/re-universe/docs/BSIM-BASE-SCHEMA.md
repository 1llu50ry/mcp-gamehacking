# BSim Base Schema Reference

**Last Updated**: January 14, 2026  
**Status**: ✅ **IMPLEMENTED** (Not Auto-Applied)  
**Source**: [create-bsim-schema.sql](../create-bsim-schema.sql), [create-bsim-functions.sql](../create-bsim-functions.sql)  
**Template**: large_32 (optimized for 100M functions, 32-bit executables)

---

## Overview

This document describes the **official Ghidra BSim schema** as implemented in [create-bsim-schema.sql](../create-bsim-schema.sql). This schema provides binary similarity analysis capabilities using Locality-Sensitive Hashing (LSH) for function matching across executables.

The schema consists of three layers:
1. **Official Ghidra BSim Tables** - Core BSim functionality (12 tables)
2. **Compatibility Tables** - Alternative table structures for backwards compatibility (6 tables)
3. **Helper Functions** - PostgreSQL PL/pgSQL functions for LSH vector management

---

## Configuration (large_32 Template)

```sql
-- BSim LSH Parameters
k = 19                    -- Number of hash functions per vector
L = 232                   -- Number of hash tables (vectors per signature)
weightsfile = lshweights_32.xml
template = large_32
schema_version = 1.0
```

**Capacity**: ~100 million functions  
**Optimization**: 32-bit x86 executables  
**Storage**: ~5-10 GB per million functions (with indexes)

---

## Official Ghidra BSim Tables

### 1. keyvaluetable - BSim Configuration

Stores BSim database configuration and metadata.

```sql
CREATE TABLE keyvaluetable (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    val TEXT  -- Alternative column name for compatibility
);
```

| Column | Type | Description |
|--------|------|-------------|
| `key` | TEXT (PK) | Configuration key |
| `value` | TEXT | Configuration value |
| `val` | TEXT | Alternative column (may be used by Ghidra) |

**Default Configuration**:
```sql
key: 'BSimConfigInfo'
key: 'k' → value: '19'
key: 'L' → value: '232'
key: 'weightsfile' → value: 'lshweights_32.xml'
key: 'template' → value: 'large_32'
key: 'schema_version' → value: '1.0'
key: 'created_timestamp' → value: <unix_timestamp>
```

---

### 2. exetable - Executable Metadata

Stores metadata about analyzed executables.

```sql
CREATE TABLE exetable (
    id BIGSERIAL PRIMARY KEY,
    md5 VARCHAR(32) UNIQUE NOT NULL,
    name_exec VARCHAR(1024),
    arch VARCHAR(64),
    name_compiler VARCHAR(128),
    version_compiler VARCHAR(128),
    name_category VARCHAR(256),
    date_create TIMESTAMP,
    repo VARCHAR(512),
    repository VARCHAR(512),       -- Alternative column name
    path VARCHAR(2048),
    description TEXT,
    ingest_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    architecture VARCHAR(64),      -- Alternative column name
    compiler_name VARCHAR(128),    -- Alternative column name
    compiler_version VARCHAR(128), -- Alternative column name
    executable_name VARCHAR(1024)  -- Alternative column name
);
```

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL (PK) | Unique executable identifier |
| `md5` | VARCHAR(32) UNIQUE | MD5 hash of executable |
| `name_exec` | VARCHAR(1024) | Executable filename |
| `arch` / `architecture` | VARCHAR(64) | CPU architecture (x86-32, x86-64, ARM, etc.) |
| `name_compiler` / `compiler_name` | VARCHAR(128) | Compiler name |
| `version_compiler` / `compiler_version` | VARCHAR(128) | Compiler version |
| `name_category` | VARCHAR(256) | Category (EXECUTABLE, LIBRARY, DRIVER, etc.) |
| `date_create` | TIMESTAMP | Executable creation date |
| `repo` / `repository` | VARCHAR(512) | Source repository |
| `path` | VARCHAR(2048) | File path |
| `description` | TEXT | Free-form description |
| `ingest_date` | TIMESTAMP | When ingested into BSim database |

**Indexes**:
```sql
CREATE INDEX idx_exetable_md5_hash ON exetable USING hash (md5);
CREATE INDEX idx_exetable_architecture ON exetable(architecture);
CREATE INDEX idx_exetable_compiler_name ON exetable(compiler_name);
```

---

### 3. desctable - Function Descriptions

Stores function metadata and links functions to executables and LSH signatures.

```sql
CREATE TABLE desctable (
    id BIGSERIAL PRIMARY KEY,
    name_func TEXT,
    id_exe INTEGER,           -- FK to exetable(id)
    id_signature BIGINT,      -- FK to vectable(id) - LSH signature hash
    flags INTEGER,
    addr BIGINT,              -- Function address in executable
    val TEXT                  -- Alternative column
);
```

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL (PK) | Unique function identifier |
| `name_func` | TEXT | Function name |
| `id_exe` | INTEGER | Foreign key to `exetable(id)` |
| `id_signature` | BIGINT | Foreign key to `vectable(id)` (LSH signature hash) |
| `flags` | INTEGER | Function flags (bit field) |
| `addr` | BIGINT | Function entry address |
| `val` | TEXT | Alternative column for compatibility |

**Indexes**:
```sql
CREATE INDEX exefuncindex ON desctable(id_exe, name_func, addr);
CREATE INDEX sigindex ON desctable(id_signature);
```

**Flag Bits**:
- Bit 0: Has custom name (not auto-generated)
- Bit 1: Has return type
- Bit 2: Has parameter types
- Bit 3: Has calling convention
- Bit 4-31: Reserved

---

### 4. vectable - LSH Vectors (Deduplicated)

Stores deduplicated LSH vectors for function similarity matching.

```sql
CREATE TABLE vectable (
    id BIGINT,                -- Hash of LSH vector
    count INTEGER,            -- Reference count
    vec LSHVECTOR,            -- LSH vector data (custom type)
    val TEXT,
    CONSTRAINT vectable_id_key UNIQUE (id)
);
```

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGINT (UNIQUE) | Hash of LSH vector (computed by `lshvector_hash()`) |
| `count` | INTEGER | Number of functions using this vector |
| `vec` | LSHVECTOR | LSH vector data (custom PostgreSQL type) |
| `val` | TEXT | Alternative column |

**Note**: The `id` is the hash of the `vec` column, not an auto-increment. This enables deduplication: identical LSH vectors across different functions share a single row.

**LSHVECTOR Type**:
- Custom PostgreSQL type from LSH extension
- Binary storage of LSH feature vectors
- Size: Variable (depends on L parameter)
- Operations: `lshvector_hash()`, `lshvector_compare()`

---

### 5. callgraphtable - Function Call Relationships

Stores function call relationships (call graph edges).

```sql
CREATE TABLE callgraphtable (
    src BIGINT NOT NULL,      -- FK to desctable(id) - caller
    dest BIGINT NOT NULL,     -- FK to desctable(id) - callee
    PRIMARY KEY (src, dest)
);
```

| Column | Type | Description |
|--------|------|-------------|
| `src` | BIGINT | Caller function ID (FK to `desctable(id)`) |
| `dest` | BIGINT | Callee function ID (FK to `desctable(id)`) |

**Example**:
```
src=100, dest=200 → Function 100 calls function 200
src=100, dest=300 → Function 100 also calls function 300
```

---

### 6. execattable - Executable Attributes

Stores additional attributes for executables (tags, categories, metadata).

```sql
CREATE TABLE execattable (
    id_exe INTEGER,           -- FK to exetable(id)
    id_type INTEGER,          -- FK to typetable(id)
    id_category INTEGER,      -- FK to categorytable(id)
    val TEXT
);
```

| Column | Type | Description |
|--------|------|-------------|
| `id_exe` | INTEGER | Foreign key to `exetable(id)` |
| `id_type` | INTEGER | Foreign key to `typetable(id)` |
| `id_category` | INTEGER | Foreign key to `categorytable(id)` |
| `val` | TEXT | Attribute value |

---

### 7. archtable - Architecture Definitions

Stores CPU architecture definitions.

```sql
CREATE TABLE archtable (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) UNIQUE,
    description TEXT,
    val TEXT
);
```

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL (PK) | Architecture ID |
| `name` | VARCHAR(128) UNIQUE | Architecture name (x86-32, x86-64, ARM, MIPS, etc.) |
| `description` | TEXT | Human-readable description |
| `val` | TEXT | Additional metadata |

**Default Values**:
```sql
('x86-32', '32-bit x86 architecture')
('x86-64', '64-bit x86 architecture')
('ARM', 'ARM architecture')
('MIPS', 'MIPS architecture')
('unknown', 'Unknown architecture')
```

---

### 8. typetable - Type Definitions

Stores type definitions for attributes.

```sql
CREATE TABLE typetable (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128),
    val TEXT
);
```

---

### 9. categorytable - Category Definitions

Stores category definitions for executables.

```sql
CREATE TABLE categorytable (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128),
    val TEXT
);
```

---

### 10. comptable - Compiler Definitions

Stores compiler definitions.

```sql
CREATE TABLE comptable (
    id SERIAL PRIMARY KEY,
    name VARCHAR(256),
    version VARCHAR(256),
    val TEXT,
    description TEXT
);
```

**Default Values**:
```sql
('gcc', '13.0', 'gcc-13.0', 'GNU Compiler Collection 13.0')
('clang', '15.0', 'clang-15.0', 'LLVM Clang 15.0')
('msvc', '19.0', 'msvc-19.0', 'Microsoft Visual C++ 19.0')
('unknown', '', 'unknown', 'Unknown compiler')
```

---

### 11. repotable - Repository Definitions

Stores repository definitions for tracking executable sources.

```sql
CREATE TABLE repotable (
    id SERIAL PRIMARY KEY,
    name VARCHAR(512),
    url VARCHAR(1024),
    val TEXT,
    description TEXT
);
```

**Default Values**:
```sql
('local', 'file:///', 'local', 'Local file system')
('ghidra', 'ghidra://localhost/', 'ghidra-local', 'Local Ghidra project')
('unknown', '', 'unknown', 'Unknown repository')
```

---

### 12. pathtable - Path Definitions

Stores path definitions for executable locations.

```sql
CREATE TABLE pathtable (
    id SERIAL PRIMARY KEY,
    path VARCHAR(2048),
    parent_id INTEGER,        -- FK to pathtable(id) - hierarchical paths
    val TEXT,
    description TEXT
);
```

**Default Values**:
```sql
('/', NULL, 'root', 'Root directory')
('/bin', 1, 'bin', 'Binary directory')
('/lib', 1, 'lib', 'Library directory')
('/tmp', 1, 'tmp', 'Temporary directory')
('unknown', NULL, 'unknown', 'Unknown path')
```

---

## Compatibility Tables

These tables provide alternative structures for backwards compatibility with older Ghidra versions or custom BSim implementations.

### executable - Extended Executable Table

```sql
CREATE TABLE executable (
    id BIGSERIAL PRIMARY KEY,
    md5 VARCHAR(32) UNIQUE NOT NULL,
    name_exec VARCHAR(1024),
    arch VARCHAR(64),
    architecture VARCHAR(64),
    name_compiler VARCHAR(128),
    compiler_name VARCHAR(128),
    version_compiler VARCHAR(128),
    compiler_version VARCHAR(128),
    executable_name VARCHAR(1024),
    name_category VARCHAR(256),
    date_create TIMESTAMP,
    repo VARCHAR(512),
    path VARCHAR(2048),
    description TEXT,
    ingest_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    function_count INTEGER DEFAULT 0,      -- Extra: total functions
    signature_count INTEGER DEFAULT 0      -- Extra: total signatures
);
```

**Indexes**:
```sql
CREATE INDEX idx_executable_md5_hash ON executable USING hash (md5);
CREATE INDEX idx_executable_category ON executable(name_category);
CREATE INDEX idx_executable_arch ON executable(arch);
CREATE INDEX idx_executable_architecture ON executable(architecture);
CREATE INDEX idx_executable_compiler_name ON executable(compiler_name);
CREATE INDEX idx_executable_ingest_date ON executable(ingest_date);
```

---

### function - Function Table

```sql
CREATE TABLE function (
    id BIGSERIAL PRIMARY KEY,
    name_func VARCHAR(512),
    name_namespace VARCHAR(512),   -- Extra: namespace path
    addr BIGINT,
    flags INTEGER DEFAULT 0,
    executable_id BIGINT REFERENCES executable(id) ON DELETE CASCADE,
    signature_count INTEGER DEFAULT 0,
    create_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Indexes**:
```sql
CREATE INDEX idx_function_executable_id ON function(executable_id);
CREATE INDEX idx_function_addr ON function(addr);
CREATE INDEX idx_function_name_hash ON function USING hash (name_func);
CREATE INDEX idx_function_namespace ON function(name_namespace);
```

---

### signature - Signature Table

```sql
CREATE TABLE signature (
    id BIGSERIAL PRIMARY KEY,
    function_id BIGINT REFERENCES function(id) ON DELETE CASCADE,
    feature_vector LSHVECTOR,
    significance REAL DEFAULT 0.0,
    hash_code BIGINT,
    vector_count INTEGER DEFAULT 0,
    create_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Indexes**:
```sql
CREATE INDEX idx_signature_function_id ON signature(function_id);
CREATE INDEX idx_signature_hash_code ON signature(hash_code);
CREATE INDEX idx_signature_feature_vector ON signature USING gist (feature_vector);
CREATE INDEX idx_signature_significance ON signature(significance DESC);
```

---

### vector - Individual LSH Hash Values

```sql
CREATE TABLE vector (
    id BIGSERIAL PRIMARY KEY,
    signature_id BIGINT REFERENCES signature(id) ON DELETE CASCADE,
    feature_id INTEGER,
    hash_value BIGINT,
    weight REAL DEFAULT 1.0,
    significance REAL DEFAULT 0.0
);
```

**Indexes**:
```sql
CREATE INDEX idx_vector_signature_id ON vector(signature_id);
CREATE INDEX idx_vector_feature_id ON vector(feature_id);
CREATE INDEX idx_vector_hash_value ON vector(hash_value);
CREATE INDEX idx_vector_significance ON vector(significance DESC);
```

---

### callgraph - Call Graph Table

```sql
CREATE TABLE callgraph (
    id BIGSERIAL PRIMARY KEY,
    caller_id BIGINT REFERENCES function(id) ON DELETE CASCADE,
    callee_id BIGINT REFERENCES function(id) ON DELETE CASCADE,
    executable_id BIGINT REFERENCES executable(id) ON DELETE CASCADE,
    call_count INTEGER DEFAULT 1
);
```

**Indexes**:
```sql
CREATE INDEX idx_callgraph_caller ON callgraph(caller_id);
CREATE INDEX idx_callgraph_callee ON callgraph(callee_id);
CREATE INDEX idx_callgraph_executable ON callgraph(executable_id);
```

---

### feature - Feature Definitions

```sql
CREATE TABLE feature (
    id SERIAL PRIMARY KEY,
    name VARCHAR(512) UNIQUE NOT NULL,
    description TEXT,
    weight REAL DEFAULT 1.0
);
```

**Default Features**:
```sql
('basic_blocks', 'Basic block count feature', 1.0)
('function_calls', 'Function call patterns', 1.5)
('instruction_patterns', 'Instruction sequence patterns', 2.0)
('control_flow', 'Control flow graph features', 1.8)
('data_flow', 'Data flow analysis features', 1.2)
('string_references', 'String and constant references', 1.0)
('register_usage', 'CPU register usage patterns', 1.3)
('stack_operations', 'Stack frame operations', 1.1)
('arithmetic_ops', 'Arithmetic operation patterns', 1.0)
('memory_access', 'Memory access patterns', 1.4)
```

---

## Helper Functions

### insert_vec() - Insert or Update LSH Vector

**From**: [create-bsim-functions.sql](../create-bsim-functions.sql)

```sql
CREATE OR REPLACE FUNCTION insert_vec(newvec lshvector, OUT ourhash BIGINT)
AS $$
DECLARE
  curs1 CURSOR (key BIGINT) FOR SELECT count FROM vectable WHERE id = key FOR UPDATE;
  ourcount INTEGER;
BEGIN
  ourhash := lshvector_hash(newvec);
  OPEN curs1( ourhash );
  FETCH curs1 INTO ourcount;
  IF FOUND THEN
    UPDATE vectable SET count = ourcount + 1 WHERE CURRENT OF curs1;
  ELSE
    INSERT INTO vectable (id,count,vec) VALUES(ourhash,1,newvec);
  END IF;
  CLOSE curs1;
END;
$$ LANGUAGE plpgsql;
```

**Purpose**: Insert a new LSH vector or increment reference count if already exists.

**Parameters**:
- `newvec`: LSHVECTOR - The LSH vector to insert

**Returns**: BIGINT - Hash of the vector (used as `id` in `vectable`)

**Thread-Safety**: Uses `FOR UPDATE` cursor lock

---

### remove_vec() - Remove or Decrement LSH Vector

**From**: [create-bsim-functions.sql](../create-bsim-functions.sql)

```sql
CREATE OR REPLACE FUNCTION remove_vec(vecid BIGINT, countdiff INTEGER)
RETURNS INTEGER
AS $$
DECLARE
  curs1 CURSOR (key BIGINT) FOR SELECT count FROM vectable WHERE id = key FOR UPDATE;
  ourcount INTEGER;
  rescode INTEGER;
BEGIN
  rescode = -1;
  OPEN curs1( vecid );
  FETCH curs1 INTO ourcount;
  IF FOUND AND ourcount > countdiff THEN
    UPDATE vectable SET count = ourcount - countdiff WHERE CURRENT OF curs1;
    rescode = 0;
  ELSIF FOUND THEN
    DELETE FROM vectable WHERE CURRENT OF curs1;
    rescode = 1;
  END IF;
  CLOSE curs1;
  RETURN rescode;
END;
$$ LANGUAGE plpgsql;
```

**Purpose**: Decrement reference count or delete vector if no longer used.

**Parameters**:
- `vecid`: BIGINT - Vector ID (hash) in `vectable`
- `countdiff`: INTEGER - Amount to decrement

**Returns**:
- `0`: Count decremented, vector still exists
- `1`: Vector deleted (count reached 0)
- `-1`: Vector not found

**Thread-Safety**: Uses `FOR UPDATE` cursor lock

---

### bsim_database_info() - Query BSim Configuration

**From**: [create-bsim-schema.sql](../create-bsim-schema.sql)

```sql
CREATE OR REPLACE FUNCTION bsim_database_info()
RETURNS TABLE(property TEXT, value TEXT)
AS $$
BEGIN
    RETURN QUERY
    SELECT k.key::TEXT, k.value::TEXT
    FROM keyvaluetable k
    WHERE k.key IN ('BSimConfigInfo', 'k', 'L', 'template', 'created_timestamp', 'schema_version')
    ORDER BY k.key;
END;
$$ LANGUAGE plpgsql;
```

**Usage**:
```sql
SELECT * FROM bsim_database_info();
```

**Returns**:
```
    property     |      value
─────────────────┼────────────────
 BSimConfigInfo  | <info>...</info>
 k               | 19
 L               | 232
 template        | large_32
 created_timestamp | 1736883600
 schema_version  | 1.0
```

---

### bsim_capacity_stats() - Database Capacity Metrics

**From**: [create-bsim-schema.sql](../create-bsim-schema.sql)

```sql
CREATE OR REPLACE FUNCTION bsim_capacity_stats()
RETURNS TABLE(
    metric TEXT,
    current_count BIGINT,
    capacity_limit BIGINT,
    utilization_percent NUMERIC
)
AS $$
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
```

**Usage**:
```sql
SELECT * FROM bsim_capacity_stats();
```

**Returns**:
```
   metric    | current_count | capacity_limit | utilization_percent
─────────────┼───────────────┼────────────────┼─────────────────────
 Functions   |         52341 |      100000000 |                0.05
 Signatures  |         52341 |      100000000 |                0.05
```

---

## Views

### bsim_statistics - Database Size Metrics

```sql
CREATE OR REPLACE VIEW bsim_statistics AS
SELECT
    'Executables' as metric,
    COUNT(*) as count,
    pg_size_pretty(pg_total_relation_size('executable')) as table_size
FROM executable
UNION ALL
SELECT 'Functions' as metric, COUNT(*) as count,
    pg_size_pretty(pg_total_relation_size('function')) as table_size
FROM function
UNION ALL
SELECT 'Signatures' as metric, COUNT(*) as count,
    pg_size_pretty(pg_total_relation_size('signature')) as table_size
FROM signature
UNION ALL
SELECT 'Vectors' as metric, COUNT(*) as count,
    pg_size_pretty(pg_total_relation_size('vector')) as table_size
FROM vector;
```

**Usage**:
```sql
SELECT * FROM bsim_statistics;
```

---

## Data Flow

### Ingesting an Executable

```
1. Insert executable metadata → exetable (or executable)
   - Compute MD5 hash
   - Extract architecture, compiler, path
   - Generate unique id

2. For each function in executable:
   a. Compute LSH signature (L vectors of k hashes)
   b. Call insert_vec() for each vector → vectable
   c. Insert function description → desctable (or function)
      - Link to exetable via id_exe
      - Store LSH vector hash as id_signature

3. Extract call graph relationships:
   - Insert (caller, callee) pairs → callgraphtable

4. Optionally insert executable attributes → execattable
```

### Querying for Similar Functions

```
1. Given query function:
   - Extract LSH signature (L vectors)

2. For each vector in signature:
   - Lookup matching vectors in vectable
   - Aggregate desctable rows with matching id_signature

3. Compute similarity score:
   - Count matching LSH vectors
   - Similarity = (matching_vectors / L) * 100%

4. Rank results by similarity score
   - Threshold: ≥90% = identity match
   - Threshold: ≥70% = similar function

5. Optionally filter by:
   - Architecture (exetable.arch)
   - Compiler (exetable.compiler_name)
   - Executable category
```

---

## Storage Estimates

### Per-Executable

| Component | Size | Notes |
|-----------|------|-------|
| exetable row | ~1 KB | Metadata |
| desctable rows | ~100 bytes × function_count | Function descriptions |
| vectable rows | ~variable | Deduplicated LSH vectors |
| callgraphtable rows | ~16 bytes × call_edges | Call graph |
| **Total** | **~1-10 MB per executable** | Depends on function count |

### large_32 Template Capacity

| Metric | Capacity | Storage |
|--------|----------|---------|
| Functions | 100 million | ~10 GB (function descriptions) |
| LSH Vectors | ~10 million (deduplicated) | ~5 GB (vector data) |
| Call Graph Edges | ~500 million | ~8 GB (relationships) |
| Indexes | N/A | ~20 GB (for fast lookups) |
| **Total** | **100M functions** | **~50 GB database size** |

---

## Performance Tuning

### Critical Indexes

```sql
-- Most important for query performance
CREATE INDEX idx_signature_feature_vector ON signature USING gist (feature_vector);
CREATE INDEX idx_desctable_id_signature ON desctable(id_signature);
CREATE INDEX idx_vectable_hash ON vectable USING hash (id);
```

### PostgreSQL Configuration

```ini
# For large BSim databases
shared_buffers = 2GB              # 25% of RAM
work_mem = 64MB                   # For LSH operations
maintenance_work_mem = 512MB      # For index creation
effective_cache_size = 6GB        # 75% of RAM
random_page_cost = 1.1            # For SSD storage
```

### Partitioning Strategy (Future)

For databases exceeding 100M functions, consider partitioning:
- `desctable` by `id_exe` (partition by executable)
- `vectable` by hash range (partition by `id % num_partitions`)
- `callgraphtable` by `src` (partition by caller function)

---

## Related Documentation

- [BSIM-CURRENT-SCHEMA.md](BSIM-CURRENT-SCHEMA.md) - Current deployment state
- [BSIM-SCHEMA-EXTENSION.md](BSIM-SCHEMA-EXTENSION.md) - Planned documentation extensions
- [BSIM-SCHEMA-DIAGRAM.md](BSIM-SCHEMA-DIAGRAM.md) - Entity-relationship diagrams
- [create-bsim-schema.sql](../create-bsim-schema.sql) - Complete SQL schema
- [create-bsim-functions.sql](../create-bsim-functions.sql) - Helper functions

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-14 | 1.0 | Initial documentation from create-bsim-schema.sql |

---

*This schema is based on Ghidra's official BSim implementation with extensions for backwards compatibility and enhanced functionality.*
