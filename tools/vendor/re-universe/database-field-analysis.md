# Database Field Analysis and Cleanup Plan

## ISSUE: Duplicate Fields in BSim Database

The original BSim schema created duplicate fields for "compatibility" but this is causing confusion and inconsistency. The website API only uses specific fields, so we should standardize on **BSim originals only**.

## Current Duplicates in `exetable`:

### ❌ **Architecture Fields** (2 duplicates):
- `arch VARCHAR(64)` - **BSim original**
- `architecture VARCHAR(64)` - **Added duplicate**

**API Usage**: Uses `architecture`
**Decision**: Keep `architecture`, drop `arch`

### ❌ **Compiler Fields** (4 duplicates):
- `name_compiler VARCHAR(128)` - **BSim original**
- `compiler_name VARCHAR(128)` - **Added duplicate**
- `version_compiler VARCHAR(128)` - **BSim original**
- `compiler_version VARCHAR(128)` - **Added duplicate**

**API Usage**: None used by website
**Decision**: Keep BSim originals (`name_compiler`, `version_compiler`), drop duplicates

### ❌ **Executable Name Fields** (2 duplicates):
- `name_exec VARCHAR(1024)` - **BSim original** ✅
- `executable_name VARCHAR(1024)` - **Added duplicate** ❌

**API Usage**: Uses `name_exec`
**Decision**: Keep `name_exec`, drop `executable_name`

### ❌ **Repository Fields** (2 duplicates):
- `repo VARCHAR(512)` - **BSim original**
- `repository VARCHAR(512)` - **Added duplicate**

**API Usage**: None used by website
**Decision**: Keep BSim original (`repo`), drop `repository`

## Additional Fields Added (Evaluate Purpose):

### Version Fields (Added by us):
- `game_version VARCHAR(16)` - **Purpose**: Support Diablo 2 version tracking
- `version_family VARCHAR(16)` - **Purpose**: Classic/LoD/D2R categorization
- `is_reference BOOLEAN` - **Purpose**: Mark reference binaries

**Decision**: **KEEP** - These support the website's core functionality (version grouping)

## Tables to Analyze:

1. ✅ `exetable` - **Primary focus, has many duplicates**
2. ❓ `desctable` - Check for duplicates
3. ❓ `function_analysis` - Our addition, validate necessity
4. ❓ `function_tags` - Our addition, validate necessity
5. ❓ All other enhanced tables

## Cleanup Plan:

### Phase 1: Remove Duplicate Fields
1. Drop `arch` (keep `architecture`)
2. Drop `compiler_name` and `compiler_version` (keep BSim originals)
3. Drop `executable_name` (keep `name_exec`)
4. Drop `repository` (keep `repo`)

### Phase 2: Validate Enhanced Tables
1. Verify each enhanced table supports website functionality
2. Remove unused enhanced tables
3. Simplify excessive tagging/analysis if not used by website

### Phase 3: Update Constraints
1. Update unique constraints to use correct field names
2. Update API queries if needed
3. Update Ghidra scripts if needed

## Website Requirements (from API analysis):

The website ONLY uses these `exetable` fields:
- `name_exec` - ✅ BSim original
- `md5` - ✅ BSim original
- `architecture` - ✅ But we added this as duplicate
- `ingest_date` - ✅ BSim original

**KEY INSIGHT**: Website doesn't use compiler fields, repository fields, or most enhanced fields!

## Questions for User:

1. **Enhanced Analysis Tables**: Do you want the detailed function analysis tables (`function_analysis`, `function_tags`) or should we focus on core BSim functionality only?

2. **Version Fields**: Keep the `game_version` and `version_family` fields since they support the website's version grouping?

3. **Ghidra Script Compatibility**: Some Ghidra scripts may expect duplicate fields - should we check script compatibility before removing fields?