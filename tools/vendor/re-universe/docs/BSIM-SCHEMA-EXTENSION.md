# BSim Schema Extension for Documentation Propagation

**Last Updated**: January 14, 2026  
**Status**: 📋 **PLANNED (NOT IMPLEMENTED)**  
**Purpose**: Extend BSim database schema to store function documentation for cross-version propagation

---

## ⚠️ Implementation Status

**THIS SCHEMA EXTENSION IS NOT YET IMPLEMENTED.** This document is a specification for planned features.

**Current State**: The base BSim schema ([BSIM-BASE-SCHEMA.md](BSIM-BASE-SCHEMA.md)) is available but must be manually applied. The extensions described in this document are design specifications awaiting implementation.

**To check what is currently deployed**, see:
- [BSIM-CURRENT-SCHEMA.md](BSIM-CURRENT-SCHEMA.md) - Actual deployed state
- [BSIM-BASE-SCHEMA.md](BSIM-BASE-SCHEMA.md) - Available base schema reference
- [bsim-init/bsim-schema-extension.sql](../bsim-init/bsim-schema-extension.sql) - Unimplemented extension SQL

---

## Overview

This document describes the schema extensions needed to store Ghidra function documentation in the BSim database, enabling automatic propagation of documentation (plate comments, signatures, parameters, types) across similar functions in different Diablo II versions.

### Design Principles

1. **Maximize existing tables** - Extend `desctable` and `exetable` rather than create parallel structures
2. **Mirror Ghidra's format** - Store data exactly as Ghidra exports it for seamless round-trip via MCP tools
3. **Support version mapping** - Enable tracking equivalent functions across all 24 D2 versions
4. **Audit trail** - Log all similarity matches and propagation actions

---

## Current BSim Schema (Reference)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `exetable` | Executable metadata | id, md5, name_exec, architecture, name_compiler, ingest_date, repository, path |
| `desctable` | Function descriptions | id, name_func, id_exe, id_signature, flags, addr |
| `signature` | LSH vectors (similarity) | id, sig (lshvector type) |
| `vectable` | Deduplicated vectors | id, count, vec |
| `callgraphtable` | Call relationships | src, dest |

**Note**: BSim's `signature` table stores LSH vectors for similarity matching, NOT function signatures (return types, parameters, etc.).

---

## Schema Extensions

### Step 1: Extend `desctable` with Documentation Columns

Add columns directly to the existing function description table:

```sql
-- Documentation content
ALTER TABLE desctable ADD COLUMN return_type VARCHAR(256);
ALTER TABLE desctable ADD COLUMN calling_convention VARCHAR(64);
ALTER TABLE desctable ADD COLUMN namespace VARCHAR(256);

-- Plate comment sections (parsed from Ghidra's plate comment format)
ALTER TABLE desctable ADD COLUMN plate_summary TEXT;
ALTER TABLE desctable ADD COLUMN plate_algorithm TEXT;
ALTER TABLE desctable ADD COLUMN plate_parameters TEXT;
ALTER TABLE desctable ADD COLUMN plate_returns TEXT;

-- Metadata
ALTER TABLE desctable ADD COLUMN completeness_score FLOAT;
ALTER TABLE desctable ADD COLUMN doc_source VARCHAR(32);
ALTER TABLE desctable ADD COLUMN propagated_from BIGINT REFERENCES desctable(id);
ALTER TABLE desctable ADD COLUMN documented_at TIMESTAMP;
ALTER TABLE desctable ADD COLUMN id_equivalence BIGINT;
```

| Column | Type | Description |
|--------|------|-------------|
| `return_type` | VARCHAR(256) | Function return type, e.g., `void`, `UnitAny *` |
| `calling_convention` | VARCHAR(64) | e.g., `__fastcall`, `__stdcall`, `__thiscall` |
| `namespace` | VARCHAR(256) | Ghidra namespace path |
| `plate_summary` | TEXT | One-line function purpose |
| `plate_algorithm` | TEXT | Algorithm section from plate comment |
| `plate_parameters` | TEXT | Parameters section (formatted text) |
| `plate_returns` | TEXT | Returns section |
| `completeness_score` | FLOAT | 0-100 score from `analyze_function_completeness()` |
| `doc_source` | VARCHAR(32) | `'manual'`, `'propagated'`, `'ai-assisted'` |
| `propagated_from` | BIGINT | FK to source function if documentation was propagated |
| `documented_at` | TIMESTAMP | When documentation was added/updated |
| `id_equivalence` | BIGINT | FK to `version_equivalence` table |

---

### Step 2: Extend `exetable` with Version Metadata

```sql
ALTER TABLE exetable ADD COLUMN game_version VARCHAR(16);
ALTER TABLE exetable ADD COLUMN version_family VARCHAR(16);
ALTER TABLE exetable ADD COLUMN is_reference BOOLEAN DEFAULT FALSE;
```

| Column | Type | Description |
|--------|------|-------------|
| `game_version` | VARCHAR(16) | D2 version, e.g., `'1.09d'`, `'1.13c'`, `'1.14a'` |
| `version_family` | VARCHAR(16) | `'classic'`, `'lod'`, `'merged'` (for 1.14.x) |
| `is_reference` | BOOLEAN | TRUE if this is the canonical documented version |

---

### Step 3: Create `func_parameters` Table

Stores each parameter separately, mirroring Ghidra's `get_function_documentation()` output:

```sql
CREATE TABLE func_parameters (
    id BIGSERIAL PRIMARY KEY,
    id_desc BIGINT NOT NULL REFERENCES desctable(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    param_name VARCHAR(128),
    param_type VARCHAR(256),
    storage VARCHAR(64),
    comment TEXT,
    UNIQUE(id_desc, ordinal)
);

CREATE INDEX idx_func_params_desc ON func_parameters(id_desc);
```

| Column | Type | Description |
|--------|------|-------------|
| `ordinal` | INTEGER | Parameter position (0-based) |
| `param_name` | VARCHAR(128) | e.g., `'pUnit'`, `'dwUnknownId'` |
| `param_type` | VARCHAR(256) | e.g., `'UnitAny *'`, `'uint'` |
| `storage` | VARCHAR(64) | e.g., `'ECX'`, `'EDX'`, `'Stack[0x4]'` |
| `comment` | TEXT | Parameter description |

**Example data:**
```
ordinal=0, param_name='pUnit', param_type='UnitAny *', storage='ECX'
ordinal=1, param_name='dwUnknownId', param_type='uint', storage='EDX'
```

---

### Step 4: Create `func_local_variables` Table

Stores local variables for "best effort" propagation:

```sql
CREATE TABLE func_local_variables (
    id BIGSERIAL PRIMARY KEY,
    id_desc BIGINT NOT NULL REFERENCES desctable(id) ON DELETE CASCADE,
    var_name VARCHAR(128),
    var_type VARCHAR(256),
    storage VARCHAR(64),
    is_parameter BOOLEAN DEFAULT FALSE,
    propagation_confidence VARCHAR(16)
);

CREATE INDEX idx_func_locals_desc ON func_local_variables(id_desc);
```

| Column | Type | Description |
|--------|------|-------------|
| `var_name` | VARCHAR(128) | e.g., `'dwPathLength'`, `'pTableEntry'` |
| `var_type` | VARCHAR(256) | e.g., `'uint'`, `'void *'` |
| `storage` | VARCHAR(64) | e.g., `'(register, 0x0, 4)'`, `'Stack[-0x10]'` |
| `is_parameter` | BOOLEAN | TRUE if this is a parameter (for filtering) |
| `propagation_confidence` | VARCHAR(16) | `'high'`, `'medium'`, `'low'` based on storage match |

**Note**: Local variable propagation is "best effort" because stack layouts can change between versions.

---

### Step 5: Create `func_comments` Table

Stores inline comments with relative offsets for relocation:

```sql
CREATE TABLE func_comments (
    id BIGSERIAL PRIMARY KEY,
    id_desc BIGINT NOT NULL REFERENCES desctable(id) ON DELETE CASCADE,
    relative_offset INTEGER NOT NULL,
    comment_type VARCHAR(16) NOT NULL,
    comment_text TEXT NOT NULL,
    instruction_bytes BYTEA,
    is_relocatable BOOLEAN DEFAULT TRUE,
    UNIQUE(id_desc, relative_offset, comment_type)
);

CREATE INDEX idx_func_comments_desc ON func_comments(id_desc);
```

| Column | Type | Description |
|--------|------|-------------|
| `relative_offset` | INTEGER | Bytes from function start address |
| `comment_type` | VARCHAR(16) | `'eol'`, `'pre'`, `'post'` |
| `comment_text` | TEXT | The comment content |
| `instruction_bytes` | BYTEA | Optional: instruction bytes for pattern matching |
| `is_relocatable` | BOOLEAN | FALSE if comment is tied to specific address |

**Example from `get_function_documentation()`:**
```json
{"relative_offset": 6, "eol_comment": "Save dwUnknownId to EAX"}
{"relative_offset": 36, "pre_comment": "Algorithm Step 3: Get velocity value from unit field"}
```

---

### Step 6: Create `func_tags` Junction Table

```sql
CREATE TABLE func_tags (
    id_desc BIGINT NOT NULL REFERENCES desctable(id) ON DELETE CASCADE,
    tag_name VARCHAR(128) NOT NULL,
    added_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (id_desc, tag_name)
);

CREATE INDEX idx_func_tags_name ON func_tags(tag_name);
```

**Common tags:**
- `DOCUMENTED` - Function is fully documented
- `NEEDS_REVIEW` - Documentation needs verification
- `GAME_LOOP` - Part of main game loop
- `NETWORK` - Network-related function
- `AI` - AI/pathfinding function
- `RENDERING` - Graphics/rendering function

---

### Step 7: Create `version_equivalence` Table

Maps equivalent functions across all D2 versions:

```sql
CREATE TABLE version_equivalence (
    id BIGSERIAL PRIMARY KEY,
    canonical_name VARCHAR(256) NOT NULL,
    binary_name VARCHAR(128) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- One column per D2 version (nullable FK to desctable)
    v1_00 BIGINT REFERENCES desctable(id),
    v1_01 BIGINT REFERENCES desctable(id),
    v1_02 BIGINT REFERENCES desctable(id),
    v1_03 BIGINT REFERENCES desctable(id),
    v1_04b BIGINT REFERENCES desctable(id),
    v1_04c BIGINT REFERENCES desctable(id),
    v1_05 BIGINT REFERENCES desctable(id),
    v1_05b BIGINT REFERENCES desctable(id),
    v1_06 BIGINT REFERENCES desctable(id),
    v1_06b BIGINT REFERENCES desctable(id),
    v1_07 BIGINT REFERENCES desctable(id),
    v1_08 BIGINT REFERENCES desctable(id),
    v1_09 BIGINT REFERENCES desctable(id),
    v1_09b BIGINT REFERENCES desctable(id),
    v1_09d BIGINT REFERENCES desctable(id),
    v1_10 BIGINT REFERENCES desctable(id),
    v1_11 BIGINT REFERENCES desctable(id),
    v1_11b BIGINT REFERENCES desctable(id),
    v1_12a BIGINT REFERENCES desctable(id),
    v1_13c BIGINT REFERENCES desctable(id),
    v1_13d BIGINT REFERENCES desctable(id),
    v1_14a BIGINT REFERENCES desctable(id),
    v1_14b BIGINT REFERENCES desctable(id),
    v1_14c BIGINT REFERENCES desctable(id),
    v1_14d BIGINT REFERENCES desctable(id),
    
    UNIQUE(canonical_name, binary_name)
);

-- Add FK constraint back to desctable
ALTER TABLE desctable ADD CONSTRAINT fk_desc_equivalence 
    FOREIGN KEY (id_equivalence) REFERENCES version_equivalence(id);

CREATE INDEX idx_version_equiv_name ON version_equivalence(canonical_name);
CREATE INDEX idx_version_equiv_binary ON version_equivalence(binary_name);
```

| Column | Type | Description |
|--------|------|-------------|
| `canonical_name` | VARCHAR(256) | Function name, e.g., `'CalculateAndSetPathVelocity'` |
| `binary_name` | VARCHAR(128) | DLL name, e.g., `'D2Client.dll'` |
| `v1_00` ... `v1_14d` | BIGINT | FK to `desctable.id` for that version's function |

**Special handling for 1.14.x**: The `binary_name` column stores the original DLL name (e.g., `D2Client.dll`), but the matching script looks in `Game.exe` for 1.14.x versions since all DLLs were merged.

---

### Step 8: Create `ordinal_mappings` Table

Resolves ordinal imports (e.g., `Ordinal_10398`) to human-readable names:

```sql
CREATE TABLE ordinal_mappings (
    id SERIAL PRIMARY KEY,
    dll_name VARCHAR(64) NOT NULL,
    ordinal_number INTEGER NOT NULL,
    resolved_name VARCHAR(256),
    signature TEXT,
    description TEXT,
    min_version VARCHAR(16),
    max_version VARCHAR(16),
    
    UNIQUE(dll_name, ordinal_number, min_version)
);

CREATE INDEX idx_ordinal_dll ON ordinal_mappings(dll_name, ordinal_number);
```

| Column | Type | Description |
|--------|------|-------------|
| `dll_name` | VARCHAR(64) | e.g., `'Fog.dll'`, `'Storm.dll'` |
| `ordinal_number` | INTEGER | e.g., `10398` |
| `resolved_name` | VARCHAR(256) | e.g., `'Fog_GetApproxDistanceToCoords'` |
| `signature` | TEXT | Full signature if known |
| `description` | TEXT | What the function does |
| `min_version` | VARCHAR(16) | First version with this ordinal |
| `max_version` | VARCHAR(16) | Last version (NULL = still valid) |

**Example data:**
```
dll_name='Fog.dll', ordinal_number=10398, resolved_name='Fog_GetApproxDistanceToCoords'
dll_name='Storm.dll', ordinal_number=501, resolved_name='SMemAlloc'
```

---

### Step 9: Create `data_types` Table

Stores serialized struct/enum definitions for cross-binary propagation:

```sql
CREATE TABLE data_types (
    id BIGSERIAL PRIMARY KEY,
    type_name VARCHAR(256) NOT NULL,
    category_path VARCHAR(512),
    type_kind VARCHAR(32) NOT NULL,
    size_bytes INTEGER,
    alignment INTEGER,
    definition_json JSONB,
    definition_gdt TEXT,
    source_program VARCHAR(128),
    source_version VARCHAR(16),
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(type_name, source_version)
);

CREATE INDEX idx_data_types_name ON data_types(type_name);
```

| Column | Type | Description |
|--------|------|-------------|
| `type_name` | VARCHAR(256) | e.g., `'UnitAny'`, `'D2ItemData'` |
| `category_path` | VARCHAR(512) | e.g., `'/D2Structs'` |
| `type_kind` | VARCHAR(32) | `'struct'`, `'enum'`, `'typedef'`, `'union'` |
| `size_bytes` | INTEGER | Total struct size |
| `alignment` | INTEGER | Alignment requirement |
| `definition_json` | JSONB | Structured field definitions (see below) |
| `definition_gdt` | TEXT | Ghidra GDT export format (alternative) |
| `source_program` | VARCHAR(128) | Which binary this came from |
| `source_version` | VARCHAR(16) | Which D2 version |

**Example `definition_json` for `UnitAny`:**
```json
{
  "fields": [
    {"offset": 0, "name": "dwUnitType", "type": "uint", "size": 4, "comment": "Unit type enum"},
    {"offset": 4, "name": "dwClassId", "type": "uint", "size": 4, "comment": "Class/monster ID"},
    {"offset": 8, "name": "pMemoryPool", "type": "void *", "size": 4, "comment": "Memory pool pointer"},
    {"offset": 12, "name": "dwUnitId", "type": "uint", "size": 4, "comment": "Unique unit identifier"},
    {"offset": 16, "name": "dwMode", "type": "uint", "size": 4, "comment": "Current animation mode"},
    {"offset": 20, "name": "pUnitData", "type": "UnitAnyData *", "size": 4, "comment": "Union of type-specific data"}
  ]
}
```

---

### Step 10: Create `similarity_match_log` Table

Audit trail for similarity matching and propagation:

```sql
CREATE TABLE similarity_match_log (
    id BIGSERIAL PRIMARY KEY,
    source_id_desc BIGINT REFERENCES desctable(id),
    target_id_desc BIGINT REFERENCES desctable(id),
    similarity_score FLOAT NOT NULL,
    confidence_score FLOAT,
    matched_at TIMESTAMP DEFAULT NOW(),
    propagated_fields TEXT[],
    match_type VARCHAR(32),
    verified BOOLEAN DEFAULT FALSE,
    verification_notes TEXT
);

CREATE INDEX idx_match_log_source ON similarity_match_log(source_id_desc);
CREATE INDEX idx_match_log_target ON similarity_match_log(target_id_desc);
```

| Column | Type | Description |
|--------|------|-------------|
| `source_id_desc` | BIGINT | FK to source (documented) function |
| `target_id_desc` | BIGINT | FK to target function |
| `similarity_score` | FLOAT | 0.0-1.0 BSim similarity |
| `confidence_score` | FLOAT | BSim confidence value |
| `matched_at` | TIMESTAMP | When match was found |
| `propagated_fields` | TEXT[] | e.g., `['plate_comment', 'parameters', 'return_type']` |
| `match_type` | VARCHAR(32) | `'identity'` (≥0.90), `'similar'` (≥0.70) |
| `verified` | BOOLEAN | Has a human verified this match? |
| `verification_notes` | TEXT | Notes from verification |

---

## Schema Summary

| Table | Type | Purpose |
|-------|------|---------|
| `desctable` | **Extended** | +12 columns for documentation, signature parts, provenance |
| `exetable` | **Extended** | +3 columns for version metadata |
| `func_parameters` | **New** | Multi-value: parameter names/types/comments |
| `func_local_variables` | **New** | Multi-value: local variable documentation |
| `func_comments` | **New** | Multi-value: inline comments with relative offsets |
| `func_tags` | **New** | Multi-value: function tags for workflow |
| `version_equivalence` | **New** | Cross-version function mapping (24 version columns) |
| `ordinal_mappings` | **New** | Ordinal→name resolution lookup |
| `data_types` | **New** | Serialized struct/enum definitions |
| `similarity_match_log` | **New** | Audit trail for matching/propagation |

---

## Version Equivalence Population Algorithm

```
INPUT: Reference version (e.g., 1.09d) with documented functions
OUTPUT: Populated version_equivalence table

For each binary_name in [D2Client.dll, D2Common.dll, D2Game.dll, D2Win.dll, ...]:
    For each documented function F in reference version:
        
        1. CREATE version_equivalence row:
           - canonical_name = F.name_func
           - binary_name = binary_name
           - Set reference version column = F.id
        
        2. For version in [1.00, 1.01, 1.02, ..., 1.14d] ordered oldest→newest:
           
           a. Determine target binary:
              IF version >= 1.14a:
                  target_binary = "Game.exe"
              ELSE:
                  target_binary = binary_name
           
           b. Query BSim for similar functions:
              - Filter by target_binary and version
              - Similarity threshold >= 0.90 (identity match)
           
           c. IF match found with similarity >= 0.90:
              - Set version column = matched function's desctable.id
              - UPDATE matched function: id_equivalence = version_equivalence.id
              - INSERT into similarity_match_log with match_type='identity'
           
           d. ELSE IF match found with similarity >= 0.70:
              - Log as 'similar' match for manual review
              - Do NOT auto-populate version column

3. After all versions processed:
   - Generate report of missing versions per function
   - Flag functions with gaps for manual investigation
```

---

## Similarity Thresholds

| Match Type | Threshold | Use Case |
|------------|-----------|----------|
| **Identity** | ≥ 0.90 | Populate `version_equivalence` - same function, different version |
| **Similar** | ≥ 0.70 | Documentation propagation - function may have minor changes |
| **Weak** | ≥ 0.50 | Suggestion only - needs manual verification |

---

## Ghidra MCP Integration

The schema is designed to mirror Ghidra's MCP tool outputs:

| MCP Tool | Corresponding Storage |
|----------|----------------------|
| `get_function_documentation()` → `plate_comment` | `desctable.plate_*` columns |
| `get_function_documentation()` → `parameters[]` | `func_parameters` table |
| `get_function_documentation()` → `local_variables[]` | `func_local_variables` table |
| `get_function_documentation()` → `comments[]` | `func_comments` table |
| `analyze_function_completeness()` → `completeness_score` | `desctable.completeness_score` |
| `apply_function_documentation()` | Reads from all above tables |

---

## Migration Script

See [bsim-schema-extension.sql](../bsim-init/bsim-schema-extension.sql) for the complete extension SQL (not yet implemented).

---

## Implementation Plan

### Prerequisites

1. **Base Schema Applied**: Ensure base BSim schema is installed (see [BSIM-BASE-SCHEMA.md](BSIM-BASE-SCHEMA.md))
2. **Ghidra MCP Tools**: Verify Ghidra MCP server is accessible and functional
3. **Database Backup**: Create backup before applying extensions

### Migration Procedure (When Ready to Implement)

```bash
# Step 1: Verify base schema exists
docker exec -it bsim-postgres psql -U ben -d bsim -c "SELECT COUNT(*) FROM keyvaluetable;"

# Step 2: Create backup
./backup.sh -BackupName "pre-extension-$(date +%Y%m%d)"

# Step 3: Apply schema extensions
docker exec -i bsim-postgres psql -U ben -d bsim < bsim-init/bsim-schema-extension.sql

# Step 4: Verify extension tables created
docker exec -it bsim-postgres psql -U ben -d bsim -c "\dt func_*"
docker exec -it bsim-postgres psql -U ben -d bsim -c "\dt version_equivalence"

# Step 5: Test Ghidra integration
# Run test documentation export/import cycle
```

### Rollback Procedure

If issues occur after applying extensions:

```bash
# Step 1: Stop Ghidra connections
# Close all Ghidra instances accessing the database

# Step 2: Restore from backup
./restore.sh -BackupFile "./backups/pre-extension-YYYYMMDD.zip" --force

# Step 3: Restart database
docker-compose restart bsim-postgres
```

### Verification Checklist

After applying extensions, verify:

- [ ] All extension tables created (`func_parameters`, `func_local_variables`, etc.)
- [ ] All extension columns added to `desctable` and `exetable`
- [ ] Foreign key constraints working
- [ ] No errors in PostgreSQL logs
- [ ] Ghidra MCP tools can query extended schema
- [ ] `get_function_documentation()` returns expected JSON structure
- [ ] `apply_function_documentation()` can write to extension tables

---

## Future Considerations

1. **Labels Table**: Store function labels (jump targets) with relative offsets for propagation
2. **Call Pattern Matching**: Use `callgraphtable` to strengthen similarity matching
3. **Batch Import/Export**: Scripts to bulk load documentation from Ghidra GDT files
4. **Version Diffing**: Store structural differences between versions for documentation notes
5. **Conflict Resolution**: Handle cases where propagated documentation conflicts with existing

---

## Related Documentation

- [BSIM-CURRENT-SCHEMA.md](BSIM-CURRENT-SCHEMA.md) - Current deployment state (what's actually installed)
- [BSIM-BASE-SCHEMA.md](BSIM-BASE-SCHEMA.md) - Base BSim schema reference
- [BSIM-SCHEMA-DIAGRAM.md](BSIM-SCHEMA-DIAGRAM.md) - Entity-relationship diagrams
- [BSIM-SETUP.md](../BSIM-SETUP.md) - BSim server setup
- [BSIM-SSL-SETUP.md](BSIM-SSL-SETUP.md) - SSL configuration
- [D2_DEDUP_ANALYSIS.md](D2_DEDUP_ANALYSIS.md) - Version deduplication strategy

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-14 | 1.1 | Clarified implementation status - PLANNED (not implemented) |
| 2025-XX-XX | 1.0 | Initial specification |
