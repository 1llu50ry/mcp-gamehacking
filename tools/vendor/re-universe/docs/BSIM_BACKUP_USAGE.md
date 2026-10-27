# BSim Backup and Restore System

This system allows you to backup and restore BSim database tables after running the lengthy `Step1_AddProgramToBSimDatabase.java` ingestion process.

## Purpose

The BSim ingestion process can take many hours to analyze hundreds of executables and extract function signatures. These backup scripts allow you to:
- Save the complete state after ingestion completes
- Quickly restore to that state without re-running analysis
- Test different configurations without losing work

## Scripts

### `backup-bsim-data.sh`
Creates a backup of core BSim ingestion tables:
- `exetable` - Executable metadata (415 files)
- `desctable` - Function signatures (536,427 functions)
- `function_analysis` - Function analysis data
- `enhanced_signatures` - LSH vectors and enhanced signatures
- Supporting lookup tables (archtable, game_versions, etc.)

**Usage:**
```bash
# Create backup with custom name (will use clear Step1 naming)
./backup-bsim-data.sh my-custom-step1-backup

# Create backup with automatic timestamp naming
./backup-bsim-data.sh
# Creates: bsim-post-step1-20260119_154500.sql

# Example after ingestion completes
./backup-bsim-data.sh step1-production-complete
```

### `restore-bsim-data.sh`
Restores database from a previous backup.

⚠️ **WARNING**: This completely replaces existing data!

**Usage:**
```bash
# List available backups
./restore-bsim-data.sh

# Restore specific backup
./restore-bsim-data.sh my-custom-step1-backup

# Example restoration
./restore-bsim-data.sh bsim-post-step1-ingestion-20260119_154500
```

### `backup-after-ingestion.sh`
Convenience script to create a timestamped backup immediately after ingestion completes.

**Usage:**
```bash
# Run after Step1_AddProgramToBSimDatabase.java finishes
./backup-after-ingestion.sh
```

## Typical Workflow

1. **Run Initial Ingestion:**
   ```bash
   # This takes hours...
   java -cp "..." Step1_AddProgramToBSimDatabase.java
   ```

2. **Create Backup:**
   ```bash
   ./backup-after-ingestion.sh
   ```

3. **Later, Quick Restore:**
   ```bash
   ./restore-bsim-data.sh bsim-post-step1-ingestion-20260119_143000
   ```

## Backup Details

- **Storage Location:** `/opt/re-universe/backups/`
- **File Format:** Plain SQL dump with schema and data
- **Typical Size:** ~258MB for current dataset
- **Contents:** Complete table schemas and all data
- **Compression:** None (plain text for compatibility)

## Database Tables Included

| Table | Purpose | Typical Rows |
|-------|---------|--------------|
| `exetable` | Executable metadata | ~415 |
| `desctable` | Function descriptions | ~536,427 |
| `function_analysis` | Function metrics | ~536,427 |
| `enhanced_signatures` | LSH signatures | Variable |
| `keyvaluetable` | Configuration | ~10 |
| `game_versions` | Version metadata | ~30 |
| `archtable` | Architecture types | ~5 |

## Verification

Each backup includes verification:
- Schema presence check
- Data presence check
- Row count validation
- File integrity

## Recovery Scenarios

### After Failed Ingestion
```bash
# If ingestion fails partway through
./restore-bsim-data.sh last-good-backup
```

### Testing New Configurations
```bash
# Before testing
./backup-bsim-data.sh before-experiment

# After testing (if unsuccessful)
./restore-bsim-data.sh before-experiment
```

### Clean Development Reset
```bash
# Restore to clean post-ingestion state
./restore-bsim-data.sh post-step1-complete
```

## Notes

- Backups include the denormalized view used by the web API
- Restore process automatically recreates dependent views
- Scripts handle database connections via Docker container
- All passwords and connection details are embedded in scripts
- Backup process is non-blocking and can run while database is in use