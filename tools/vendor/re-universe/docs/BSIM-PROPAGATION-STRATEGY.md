# BSim Documentation Propagation Strategy

## Overview

This document describes a comprehensive strategy for using BSim (Binary Similarity) to identify similar functions across different versions/builds of binaries and propagate documentation (names, comments, types, tags) from well-documented "reference" programs to undocumented "target" programs.

## Goals

1. **Identify Similar Functions**: Use BSim's locality-sensitive hashing to find functions with matching code patterns across binaries
2. **Propagate Full Documentation**: Transfer not just names, but complete documentation including:
   - Function names
   - Plate comments (function header documentation)
   - Repeatable comments
   - Function signatures (return type, parameter names/types, calling convention)
   - Custom data types and structures
   - Function tags
3. **Track Propagation Quality**: Mark propagated functions with confidence levels and review flags
4. **Enable Cross-Version Analysis**: Map functions across multiple versions for patch analysis

## Architecture

### Database Setup

```
┌─────────────────────────────────────────────────────────────────┐
│                    PostgreSQL BSim Database                      │
├─────────────────────────────────────────────────────────────────┤
│  Function Tags:                                                  │
│    • DOCUMENTED - Source functions with documentation            │
│    • PROPAGATED - Functions that received documentation          │
│    • NEEDS_REVIEW - Low-confidence matches needing manual review │
│    • LIBRARY - Known library/CRT functions                       │
│    • VERIFIED - Human-verified after propagation                 │
├─────────────────────────────────────────────────────────────────┤
│  Executable Categories:                                          │
│    • Version - Game/software version (1.09d, 1.10, 1.13c)       │
│    • ReferenceLibrary - Well-documented source programs          │
│    • Target - Programs receiving propagated documentation        │
│    • Platform - Platform identifier (LoD, Classic, PD2)          │
└─────────────────────────────────────────────────────────────────┘
```

### Workflow Diagram

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Reference      │     │   BSim Database   │     │   Target         │
│   Program        │     │                   │     │   Programs       │
│   (Documented)   │     │   PostgreSQL      │     │   (Undocumented) │
└────────┬─────────┘     └────────┬──────────┘     └────────┬─────────┘
         │                        │                          │
         │  1. Ingest             │                          │
         ├───────────────────────►│                          │
         │  (ReferenceLibrary)    │                          │
         │  (Tag: DOCUMENTED)     │                          │
         │                        │                          │
         │                        │  2. Ingest               │
         │                        │◄─────────────────────────┤
         │                        │  (Target category)       │
         │                        │                          │
         │  3. Query Similar      │                          │
         ├───────────────────────►│                          │
         │                        │                          │
         │  4. Get Matches        │                          │
         │◄───────────────────────┤                          │
         │                        │                          │
         │  5. Propagate Full Documentation                  │
         ├───────────────────────────────────────────────────►
         │  • Names                                          │
         │  • Plate Comments                                 │
         │  • Signatures                                     │
         │  • Data Types                                     │
         │  • Tags (+ PROPAGATED)                            │
         │                        │                          │
         └────────────────────────┴──────────────────────────┘
```

## Scripts Overview

### 1. CreateProjectBSimDatabaseScript.java

**Purpose**: Create a preconfigured BSim database optimized for documentation propagation.

**Features**:
- Pre-defines function tags (DOCUMENTED, PROPAGATED, NEEDS_REVIEW, etc.)
- Pre-defines executable categories (Version, ReferenceLibrary, Target)
- Uses `medium_32` template for 32-bit x86 binaries (recommended for game reversing)
- Enables call graph tracking for relationship analysis

**Usage**:
```
Tools → BSim → Create Project BSim Database
```

**Configuration**:
| Parameter | Default | Description |
|-----------|---------|-------------|
| Host | localhost | PostgreSQL server |
| Port | 5432 | PostgreSQL port |
| Database Name | bsim_project | Name for the new database |
| Template | medium_32 | LSH template (medium_32 for 32-bit, medium_64 for 64-bit) |
| Track Call Graph | true | Enable call relationship tracking |

---

### 2. IngestReferenceProgramScript.java

**Purpose**: Add a well-documented reference program to the BSim database.

**Features**:
- Marks program with "ReferenceLibrary" category
- Auto-detects version from folder path (e.g., `/LoD/1.09d/D2Client.dll` → version "1.09d")
- Tags documented functions with "DOCUMENTED" tag
- Reports documentation coverage statistics before ingestion

**Usage**:
1. Open your most thoroughly documented program version
2. Run: `Tools → BSim → Ingest Reference Program`
3. Verify version and platform detection
4. Click OK to ingest

**Best Practices**:
- Ingest your best-documented version first as the reference
- Ensure functions have meaningful names (not `FUN_*`)
- Add plate comments describing function purpose
- Define parameter names and types in function signatures

---

### 3. AddProgramToPostgresBSimDatabaseScript.java (Existing)

**Purpose**: Add target programs (undocumented) to the BSim database.

**Usage**:
1. Open target program(s)
2. Run the script
3. Enable "Process All Programs in Project" for batch ingestion
4. Enable "Use Parent Folder as Version" for automatic version tagging

---

### 4. PropagateFullDocumentationScript.java

**Purpose**: Propagate complete documentation from reference to matching functions.

**Features**:
- **Names**: Renames `FUN_*` functions to match reference
- **Plate Comments**: Copies function header documentation
- **Repeatable Comments**: Copies inline documentation
- **Signatures**: Applies return type, parameter types/names, calling convention
- **Data Types**: Resolves and copies custom structures used in signatures
- **Tags**: Copies function tags, adds PROPAGATED tag

**Similarity Thresholds**:
| Range | Action |
|-------|--------|
| ≥ 85% | Auto-apply (high confidence) |
| 70-85% | Apply + add NEEDS_REVIEW tag |
| < 70% | Skip (too low confidence) |

**Usage**:
1. Open the reference program (source of documentation)
2. Run: `Tools → BSim → Propagate Full Documentation`
3. Configure thresholds and options
4. Review the generated reports

**Output Reports**:
- `bsim_propagation_YYYYMMDD_HHMMSS_summary.txt` - Overview statistics
- `bsim_propagation_YYYYMMDD_HHMMSS_detailed.csv` - Per-function details

---

## Complete Workflow

### Phase 1: Database Setup

```bash
# 1. Start BSim PostgreSQL database
docker-compose up -d bsim-postgres

# 2. Wait for database to be ready
./test-connectivity.sh
```

In Ghidra:
1. Run `CreateProjectBSimDatabaseScript.java`
2. Configure connection (default: localhost:5432)
3. Choose template (`medium_32` for 32-bit binaries)

### Phase 2: Ingest Reference Program

1. Open your best-documented program version
2. Run `IngestReferenceProgramScript.java`
3. Verify:
   - Version detected correctly
   - Platform detected correctly
   - Documentation coverage is reasonable (>10% named functions)

### Phase 3: Ingest Target Programs

1. Open target programs or enable batch mode
2. Run `AddProgramToPostgresBSimDatabaseScript.java`
3. Ensure "Use Parent Folder as Version" is enabled

### Phase 4: Propagate Documentation

1. Open the reference program again
2. Run `PropagateFullDocumentationScript.java`
3. Configure:
   - Auto-apply threshold (default: 85%)
   - Review threshold (default: 70%)
   - Select what to propagate (names, comments, signatures, types, tags)
4. Optionally enable "Dry Run" first to preview changes
5. Review generated reports

### Phase 5: Review & Verification

1. Filter for functions with `NEEDS_REVIEW` tag
2. Manually verify low-confidence matches
3. Change tag to `VERIFIED` after confirmation
4. Re-run propagation as you add more documentation

---

## Similarity Matching Details

### How BSim Works

BSim uses **Locality-Sensitive Hashing (LSH)** to create fingerprints of function behavior:

1. **Feature Extraction**: Analyzes control flow, data flow, and operations
2. **Vector Generation**: Creates high-dimensional feature vectors
3. **LSH Indexing**: Maps similar vectors to same hash buckets
4. **Similarity Scoring**: Measures cosine similarity between vectors

### Template Selection

| Template | Use Case |
|----------|----------|
| `medium_32` | 32-bit x86 binaries (games, legacy software) |
| `medium_64` | 64-bit x86-64 binaries |
| `medium_nosize` | Cross-architecture matching (ignores operand sizes) |
| `medium_cpool` | Java/JVM binaries with constant pool analysis |

### Similarity Thresholds

| Similarity | Interpretation |
|------------|----------------|
| 99-100% | Identical functions (compiler variations only) |
| 90-99% | Near-identical (minor code changes) |
| 80-90% | High similarity (same algorithm, different implementation details) |
| 70-80% | Moderate similarity (same structure, different logic) |
| < 70% | Low confidence (may be different functions) |

---

## Data Types & Structures

### What Gets Propagated

When propagating signatures, the script handles:

1. **Primitive Types**: `int`, `char`, `void*`, etc. (built-in, no copying needed)
2. **Structures**: Custom `struct` types used in parameters/returns
3. **Typedefs**: Type aliases like `DWORD`, `HANDLE`
4. **Enums**: Enumeration types
5. **Pointers**: Pointer types referencing custom types
6. **Arrays**: Array types
7. **Function Pointers**: Callback signatures

### Conflict Resolution

When a type already exists in the target:
- **REPLACE_HANDLER**: Overwrites with source type (default)
- **KEEP_HANDLER**: Preserves existing type
- **RENAME_HANDLER**: Creates new type with suffix

---

## Function Tags

### Predefined Tags

| Tag | Purpose |
|-----|---------|
| `DOCUMENTED` | Source function with complete documentation |
| `PROPAGATED` | Function received documentation via BSim |
| `NEEDS_REVIEW` | Low-confidence match requiring manual verification |
| `LIBRARY` | Known library/CRT function |
| `VERIFIED` | Human-verified after propagation |
| `THUNK` | Thunk/stub function |
| `CUSTOM_CALLING` | Function with non-standard calling convention |

### Tag Workflow

```
Source Function (DOCUMENTED)
         │
         ▼ BSim Match
Target Function
         │
         ├── High Confidence (≥85%) → Add PROPAGATED
         │
         └── Medium Confidence (70-85%) → Add PROPAGATED + NEEDS_REVIEW
                    │
                    ▼ Manual Review
              Add VERIFIED (if correct)
              or Remove PROPAGATED (if wrong)
```

---

## Automation with MCP

The Ghidra MCP plugin enables automated script execution:

```python
# Check connection
mcp_ghidra_check_connection()

# List available scripts
mcp_ghidra_list_ghidra_scripts()

# Run a script
mcp_ghidra_run_ghidra_script("CreateProjectBSimDatabaseScript")

# Note: Scripts with GUI dialogs may timeout
# Use headless mode for fully automated workflows
```

### Copying Scripts to Ghidra

Scripts in `ghidra-scripts/` must be added to Ghidra's Script Manager:
1. Open Script Manager (Window → Script Manager)
2. Click "Manage Script Directories"
3. Add the `ghidra-scripts/` directory path
4. Refresh script list

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| "Failed to connect to database" | Verify PostgreSQL is running: `docker-compose ps` |
| "No functions were scanned" | Check program has analyzable functions (not just thunks) |
| "Low documentation warning" | Reference program needs more documented functions |
| Scripts not appearing | Add `ghidra-scripts/` to Script Manager directories |
| Type conflicts | Try different DataTypeConflictHandler strategy |

### Verifying BSim Connection

```bash
# Test PostgreSQL connectivity
psql -h localhost -p 5432 -U ben -d bsim_project -c "SELECT 1"

# Check Docker container
docker logs bsim-postgres
```

---

## Best Practices

1. **Start with Best Documentation**: Ingest your most thoroughly documented version first
2. **Use Version Categories**: Enable folder-based version detection for consistent tagging
3. **Review Low-Confidence Matches**: Don't blindly trust 70-85% matches
4. **Iterative Propagation**: As you add more documentation, re-run propagation
5. **Backup Before Propagation**: Use Ghidra project versioning or file backups
6. **Dry Run First**: Use dry run mode to preview changes before applying

---

## Related Documentation

- [BSIM-SETUP.md](BSIM-SETUP.md) - BSim infrastructure setup
- [TESTING.md](TESTING.md) - Testing procedures
- [README.md](README.md) - Project overview

---

*Last Updated: January 12, 2026*
