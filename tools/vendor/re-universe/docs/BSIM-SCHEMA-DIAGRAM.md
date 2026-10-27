# BSim Database Schema Diagrams

**Last Updated**: January 14, 2026  
**Schema Version**: 1.0 (large_32 template)  
**Purpose**: Visual documentation of BSim database table relationships

---

## Overview

This document provides entity-relationship diagrams and visual representations of the BSim database schema, distinguishing between:
1. **Official Ghidra BSim Tables** - Core BSim functionality
2. **Compatibility Tables** - Backwards compatibility layer
3. **Planned Extensions** - Future documentation propagation features

---

## Official Ghidra BSim Schema

### Core Tables Entity-Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        OFFICIAL GHIDRA BSIM SCHEMA                      │
│                              (Implemented)                               │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│   keyvaluetable      │
│──────────────────────│
│ key (PK)             │◄────────── Configuration Storage
│ value                │            (k=19, L=232, template=large_32)
│ val                  │
└──────────────────────┘


┌──────────────────────┐
│     exetable         │            Executable Metadata
│──────────────────────│
│ id (PK)              │
│ md5 (UNIQUE)         │◄────────── Identifies executables uniquely
│ name_exec            │
│ arch / architecture  │
│ name_compiler        │
│ date_create          │
│ repo / repository    │
│ path                 │
└──────────────────────┘
           │
           │ 1
           │
           │ N
           ▼
┌──────────────────────┐
│     desctable        │            Function Descriptions
│──────────────────────│
│ id (PK)              │
│ name_func            │
│ id_exe (FK)          │────────────► exetable.id
│ id_signature (FK)    │────┐
│ addr                 │    │
│ flags                │    │
└──────────────────────┘    │
           │                │
           │ 1              │
           │                │
           │ N              │
           ▼                │
┌──────────────────────┐    │
│  callgraphtable      │    │        Call Graph Relationships
│──────────────────────│    │
│ src (FK, PK)         │────┼───────► desctable.id (caller)
│ dest (FK, PK)        │────┘
└──────────────────────┘


           ┌─────────────────┐
           │                 │ 1
           │                 │
           │ N               ▼
           │       ┌──────────────────────┐
           │       │      vectable        │  LSH Vector Storage (Deduplicated)
           │       │──────────────────────│
           └──────►│ id (UNIQUE)          │◄── Hash of LSH vector
                   │ count                │    (reference count)
                   │ vec (LSHVECTOR)      │    Custom PostgreSQL type
                   └──────────────────────┘


┌──────────────────────┐
│    archtable         │            Architecture Definitions
│──────────────────────│
│ id (PK)              │
│ name (UNIQUE)        │            (x86-32, x86-64, ARM, MIPS)
│ description          │
└──────────────────────┘


┌──────────────────────┐
│    comptable         │            Compiler Definitions
│──────────────────────│
│ id (PK)              │
│ name                 │            (gcc, clang, msvc)
│ version              │
│ description          │
└──────────────────────┘


┌──────────────────────┐
│    repotable         │            Repository Definitions
│──────────────────────│
│ id (PK)              │
│ name                 │            (local, ghidra, unknown)
│ url                  │
│ description          │
└──────────────────────┘


┌──────────────────────┐
│    pathtable         │            Path Hierarchy
│──────────────────────│
│ id (PK)              │
│ path                 │
│ parent_id (FK)       │────────────► pathtable.id (self-reference)
│ description          │
└──────────────────────┘
```

---

## Compatibility Schema (Backwards Compatibility)

### Extended Tables for Legacy Support

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      COMPATIBILITY SCHEMA LAYER                         │
│                          (Backwards Compatibility)                       │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│    executable        │            Enhanced Executable Table
│──────────────────────│
│ id (PK)              │
│ md5 (UNIQUE)         │
│ name_exec            │
│ arch / architecture  │
│ compiler_name        │
│ function_count       │◄────────── Extra: Statistics
│ signature_count      │◄────────── Extra: Statistics
│ ingest_date          │
└──────────────────────┘
           │
           │ 1
           │
           │ N
           ▼
┌──────────────────────┐
│     function         │            Function Metadata
│──────────────────────│
│ id (PK)              │
│ name_func            │
│ name_namespace       │◄────────── Extra: Namespace path
│ addr                 │
│ executable_id (FK)   │────────────► executable.id
│ signature_count      │
│ create_date          │
└──────────────────────┘
           │
           │ 1
           │
           │ N
           ▼
┌──────────────────────┐
│    signature         │            LSH Signatures
│──────────────────────│
│ id (PK)              │
│ function_id (FK)     │────────────► function.id
│ feature_vector       │◄────────── LSHVECTOR type
│ hash_code            │
│ significance         │
│ create_date          │
└──────────────────────┘
           │
           │ 1
           │
           │ L (e.g., 232 vectors per signature)
           ▼
┌──────────────────────┐
│      vector          │            Individual LSH Hash Values
│──────────────────────│
│ id (PK)              │
│ signature_id (FK)    │────────────► signature.id
│ feature_id (FK)      │────┐
│ hash_value           │    │
│ weight               │    │
│ significance         │    │
└──────────────────────┘    │
                            │
                            │
                            ▼
                   ┌──────────────────────┐
                   │      feature         │  Feature Definitions
                   │──────────────────────│
                   │ id (PK)              │
                   │ name (UNIQUE)        │  (basic_blocks, function_calls, etc.)
                   │ description          │
                   │ weight               │
                   └──────────────────────┘


┌──────────────────────┐
│     callgraph        │            Call Graph (Enhanced)
│──────────────────────│
│ id (PK)              │
│ caller_id (FK)       │────────────► function.id
│ callee_id (FK)       │────────────► function.id
│ executable_id (FK)   │────────────► executable.id
│ call_count           │◄────────── Extra: Call frequency
└──────────────────────┘
```

---

## Schema Layer Comparison

### Table Purpose Matrix

| Purpose | Official Ghidra Table | Compatibility Table | Relationship |
|---------|----------------------|---------------------|--------------|
| **Executable Metadata** | `exetable` | `executable` | Parallel structures, different column names |
| **Function Descriptions** | `desctable` | `function` | `desctable` stores LSH signature hash; `function` links to `signature` table |
| **LSH Vectors** | `vectable` | `signature` + `vector` | `vectable` stores deduplicated vectors; `signature`/`vector` stores per-function vectors |
| **Call Graph** | `callgraphtable` | `callgraph` | `callgraphtable` is (src, dest); `callgraph` adds `call_count` |
| **Configuration** | `keyvaluetable` | *(none)* | Only in official schema |

---

## Data Flow Diagrams

### Ingesting an Executable

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         EXECUTABLE INGESTION FLOW                        │
└─────────────────────────────────────────────────────────────────────────┘

  Binary File                          Ghidra Analysis
       │                                      │
       │ 1. Load                              │ 2. Analyze
       ▼                                      ▼
┌────────────┐                      ┌──────────────────┐
│  Ghidra    │                      │ Function Graph   │
│  Project   │                      │ - Functions      │
└────────────┘                      │ - Call Graph     │
                                    │ - LSH Signatures │
                                    └──────────────────┘
                                              │
                                              │ 3. Export to BSim
                                              ▼
                            ┌────────────────────────────────┐
                            │      BSim Database Insert      │
                            └────────────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
            ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
            │  exetable    │        │  desctable   │        │  vectable    │
            │──────────────│        │──────────────│        │──────────────│
            │ INSERT       │        │ INSERT N     │        │ INSERT_VEC() │
            │ - md5        │        │ - name_func  │        │ (dedup)      │
            │ - arch       │        │ - id_exe     │        │              │
            │ - compiler   │        │ - id_sig     │        │              │
            └──────────────┘        └──────────────┘        └──────────────┘
                                              │
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │ callgraphtable   │
                                    │──────────────────│
                                    │ INSERT call edges│
                                    │ (src, dest)      │
                                    └──────────────────┘
```

### Querying Similar Functions

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      SIMILARITY QUERY FLOW                               │
└─────────────────────────────────────────────────────────────────────────┘

  Query Function                      Query Processing
  (from Ghidra)                              │
       │                                     │
       │ 1. Extract LSH signature            │
       ▼                                     ▼
┌────────────────┐              ┌──────────────────────────┐
│ LSH Signature  │              │  For each vector in      │
│ (L vectors)    │──────────────► signature (L iterations) │
│                │              └──────────────────────────┘
│ vec[0]         │                           │
│ vec[1]         │                           │ 2. Lookup in vectable
│ ...            │                           ▼
│ vec[L-1]       │              ┌──────────────────────────┐
└────────────────┘              │     SELECT FROM vectable │
                                │     WHERE id = hash(vec) │
                                └──────────────────────────┘
                                            │
                                            │ 3. Find matching functions
                                            ▼
                                ┌──────────────────────────┐
                                │  SELECT FROM desctable   │
                                │  WHERE id_signature = id │
                                └──────────────────────────┘
                                            │
                                            │ 4. Aggregate results
                                            ▼
                            ┌───────────────────────────────────┐
                            │   Similarity Score Calculation    │
                            │───────────────────────────────────│
                            │ similarity = (matching_vectors / L)│
                            │                                   │
                            │ ≥ 90% → Identity match            │
                            │ ≥ 70% → Similar function          │
                            │ ≥ 50% → Weak match                │
                            └───────────────────────────────────┘
                                            │
                                            │ 5. Return ranked results
                                            ▼
                                    ┌──────────────┐
                                    │ Result Set   │
                                    │──────────────│
                                    │ Function A   │ 98% similar
                                    │ Function B   │ 87% similar
                                    │ Function C   │ 73% similar
                                    └──────────────┘
```

---

## Planned Schema Extensions (Not Implemented)

### Documentation Propagation Extensions

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      PLANNED EXTENSION SCHEMA                           │
│                         (NOT YET IMPLEMENTED)                            │
│                                                                          │
│  See BSIM-SCHEMA-EXTENSION.md for full specification                    │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    desctable (EXTENDED)                       │
│───────────────────────────────────────────────────────────────│
│ Existing columns:                                            │
│   id, name_func, id_exe, id_signature, addr, flags           │
│                                                              │
│ NEW COLUMNS (Planned):                                       │
│   return_type VARCHAR(256)        ◄─── Function signature   │
│   calling_convention VARCHAR(64)   ◄─── __fastcall, etc.    │
│   namespace VARCHAR(256)           ◄─── Namespace path      │
│   plate_summary TEXT               ◄─── One-line purpose    │
│   plate_algorithm TEXT             ◄─── Algorithm section   │
│   plate_parameters TEXT            ◄─── Parameters section  │
│   plate_returns TEXT               ◄─── Returns section     │
│   completeness_score FLOAT         ◄─── 0-100 score         │
│   doc_source VARCHAR(32)           ◄─── 'manual', 'propagated' │
│   propagated_from BIGINT           ◄─── Source function ID  │
│   documented_at TIMESTAMP          ◄─── Documentation date  │
│   id_equivalence BIGINT            ◄─── Version mapping FK  │
└──────────────────────────────────────────────────────────────┘
                │
                │ 1
                │
                │ N
                ▼
┌─────────────────────────────────────────────────────────────────┐
│              func_parameters (NEW TABLE - Planned)              │
│─────────────────────────────────────────────────────────────────│
│ id (PK)                                                         │
│ id_desc (FK) ──────────────────────────► desctable.id          │
│ ordinal                 ◄─── Parameter position (0, 1, 2, ...)  │
│ param_name              ◄─── 'pUnit', 'dwUnknownId', etc.       │
│ param_type              ◄─── 'UnitAny *', 'uint', etc.          │
│ storage                 ◄─── 'ECX', 'EDX', 'Stack[0x4]'         │
│ comment                 ◄─── Parameter description              │
└─────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────┐
│          func_local_variables (NEW TABLE - Planned)             │
│─────────────────────────────────────────────────────────────────│
│ id (PK)                                                         │
│ id_desc (FK) ──────────────────────────► desctable.id          │
│ var_name                ◄─── Local variable name                │
│ var_type                ◄─── Type                               │
│ storage                 ◄─── Storage location                   │
│ is_parameter            ◄─── TRUE if parameter                  │
│ propagation_confidence  ◄─── 'high', 'medium', 'low'            │
└─────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────┐
│              func_comments (NEW TABLE - Planned)                │
│─────────────────────────────────────────────────────────────────│
│ id (PK)                                                         │
│ id_desc (FK) ──────────────────────────► desctable.id          │
│ relative_offset         ◄─── Bytes from function start          │
│ comment_type            ◄─── 'eol', 'pre', 'post'               │
│ comment_text            ◄─── The comment content                │
│ instruction_bytes       ◄─── Optional: for pattern matching     │
│ is_relocatable          ◄─── Can comment move to similar code? │
└─────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────┐
│          version_equivalence (NEW TABLE - Planned)              │
│─────────────────────────────────────────────────────────────────│
│ Maps equivalent functions across Diablo II versions             │
│─────────────────────────────────────────────────────────────────│
│ id (PK)                                                         │
│ canonical_name          ◄─── Function name                      │
│ binary_name             ◄─── DLL name (D2Client.dll, etc.)      │
│ created_at              ◄─── Creation timestamp                 │
│                                                                 │
│ Version columns (24 total):                                     │
│   v1_00 ────────────────────────► desctable.id (1.00 version)  │
│   v1_01 ────────────────────────► desctable.id (1.01 version)  │
│   ...                                                           │
│   v1_14d ───────────────────────► desctable.id (1.14d version) │
│                                                                 │
│ Special handling: 1.14.x uses Game.exe instead of separate DLLs│
└─────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────┐
│        similarity_match_log (NEW TABLE - Planned)               │
│─────────────────────────────────────────────────────────────────│
│ Audit trail for similarity matching and propagation            │
│─────────────────────────────────────────────────────────────────│
│ id (PK)                                                         │
│ source_id_desc (FK) ──────────────► desctable.id (source)      │
│ target_id_desc (FK) ──────────────► desctable.id (target)      │
│ similarity_score        ◄─── 0.0-1.0 BSim similarity            │
│ confidence_score        ◄─── BSim confidence value              │
│ matched_at              ◄─── Timestamp                          │
│ propagated_fields       ◄─── ['plate_comment', 'parameters']   │
│ match_type              ◄─── 'identity' (≥0.90) / 'similar'     │
│ verified                ◄─── Human verification flag            │
│ verification_notes      ◄─── Notes from reviewer                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Table Categories

### By Purpose

```
Configuration & Metadata:
├── keyvaluetable        (Config storage)
├── archtable            (Architectures)
├── comptable            (Compilers)
├── repotable            (Repositories)
├── pathtable            (Paths)
└── typetable            (Types)

Core Executable Analysis:
├── exetable             (Executable metadata - Official)
├── executable           (Executable metadata - Compatibility)
├── desctable            (Function descriptions - Official)
└── function             (Function metadata - Compatibility)

LSH Similarity Matching:
├── vectable             (Deduplicated LSH vectors - Official)
├── signature            (Per-function signatures - Compatibility)
└── vector               (Individual hash values - Compatibility)

Call Graph Analysis:
├── callgraphtable       (Call edges - Official)
└── callgraph            (Call edges with counts - Compatibility)

Feature Definitions:
└── feature              (Feature weights for LSH)

Documentation Extensions (Planned):
├── func_parameters      (Parameter documentation)
├── func_local_variables (Local variable documentation)
├── func_comments        (Inline comments)
├── func_tags            (Workflow tags)
├── version_equivalence  (Cross-version mapping)
├── ordinal_mappings     (Ordinal→name resolution)
├── data_types           (Struct/enum definitions)
└── similarity_match_log (Audit trail)
```

---

## Storage Size Estimates

### Official Schema Tables

| Table | Rows per Million Functions | Size per Million |
|-------|---------------------------|-----------------|
| `exetable` | ~1,000 executables | ~1 MB |
| `desctable` | 1,000,000 functions | ~100 MB |
| `vectable` | ~100,000 unique vectors (10% dedup) | ~50 MB |
| `callgraphtable` | ~5,000,000 call edges | ~80 MB |
| **Indexes** | N/A | ~200 MB |
| **Total** | **1M functions** | **~430 MB** |

### large_32 Template Capacity

| Metric | Value | Storage |
|--------|-------|---------|
| Maximum Functions | 100 million | ~43 GB |
| LSH Vectors (deduplicated) | ~10 million | ~5 GB |
| Call Graph Edges | ~500 million | ~8 GB |
| Indexes | N/A | ~20 GB |
| **Total Database Size** | **100M functions** | **~76 GB** |

---

## Related Documentation

- [BSIM-CURRENT-SCHEMA.md](BSIM-CURRENT-SCHEMA.md) - Current deployment state
- [BSIM-BASE-SCHEMA.md](BSIM-BASE-SCHEMA.md) - Complete schema reference
- [BSIM-SCHEMA-EXTENSION.md](BSIM-SCHEMA-EXTENSION.md) - Planned extensions
- [create-bsim-schema.sql](../create-bsim-schema.sql) - SQL schema definition
- [bsim-init/create-bsim-complete.sql](../bsim-init/create-bsim-complete.sql) - Consolidated schema

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-14 | 1.0 | Initial ER diagram documentation |

---

*These diagrams represent the BSim database schema as implemented in the large_32 template. For the latest schema changes, see the SQL files in the repository.*
