#!/bin/bash
#
# BSim Data Restore Script
# Restores tables from backup created by backup-bsim-data.sh
#
# Usage: ./restore-bsim-data.sh <backup_name>
#
# This script restores the core BSim ingestion tables from backup,
# allowing quick restoration to a specific state without re-running
# the lengthy Step1_AddProgramToBSimDatabase.java process.
#
# WARNING: This will DROP and recreate existing tables!

set -e  # Exit on any error

# Configuration
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="bsim"
DB_USER="${BSIM_DB_USER:-bsim_user}"
export PGPASSWORD="${BSIM_DB_PASSWORD:?BSIM_DB_PASSWORD must be set}"

# Check for backup name argument
if [ -z "$1" ]; then
    echo "ERROR: Backup name required"
    echo ""
    echo "Usage: $0 <backup_name>"
    echo ""
    echo "Available backups:"
    ls -la ${BACKUP_BASE_DIR:-./backups}/*.sql 2>/dev/null | awk '{print "  " $9}' | sed 's|.*/||' | sed 's|\.sql||' || echo "  No backups found"
    exit 1
fi

BACKUP_NAME="$1"
BACKUP_DIR="${BACKUP_BASE_DIR:-./backups}"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.sql"

echo "=========================================="
echo "BSim Data Restore Script"
echo "=========================================="
echo "Backup name: $BACKUP_NAME"
echo "Backup file: $BACKUP_FILE"
echo "Database: $DB_NAME@$DB_HOST:$DB_PORT"
echo ""

# Check backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: Backup file not found: $BACKUP_FILE"
    echo ""
    echo "Available backups:"
    ls -la "$BACKUP_DIR"/*.sql 2>/dev/null | awk '{print "  " $9}' | sed 's|.*/||' | sed 's|\.sql||' || echo "  No backups found"
    exit 1
fi

echo "Backup file found: $(du -h "$BACKUP_FILE" | cut -f1)"

# Check database connection
echo ""
echo "Testing database connection..."
if ! docker exec bsim-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 'Connection successful' as status;" > /dev/null 2>&1; then
    echo "ERROR: Cannot connect to database"
    exit 1
fi
echo "✓ Database connection successful"

# Get current table statistics
echo ""
echo "Current table statistics (before restore):"
docker exec bsim-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "
    SELECT 'exetable' as table_name, COUNT(*) as row_count FROM exetable
    UNION ALL
    SELECT 'desctable' as table_name, COUNT(*) as row_count FROM desctable
    UNION ALL
    SELECT 'function_analysis' as table_name, COUNT(*) as row_count FROM function_analysis
    UNION ALL
    SELECT 'enhanced_signatures' as table_name, COUNT(*) as row_count FROM enhanced_signatures
    ORDER BY table_name;
" 2>/dev/null || echo "Some tables may not exist yet"

# Confirmation prompt
echo ""
echo "⚠️  WARNING: This will DROP existing BSim data tables!"
echo "⚠️  All current ingestion data will be permanently lost!"
echo ""
read -p "Are you sure you want to restore from backup? (y/N): " -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Restore cancelled"
    exit 0
fi

echo ""
echo "Restoring from backup..."

# Restore the backup
if docker exec -i bsim-postgres psql -U "$DB_USER" -d "$DB_NAME" < "$BACKUP_FILE" > /dev/null 2>&1; then
    echo "✓ Restore completed successfully"

    # Get table statistics after restore
    echo ""
    echo "Table statistics after restore:"
    docker exec bsim-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "
        SELECT 'exetable' as table_name, COUNT(*) as row_count FROM exetable
        UNION ALL
        SELECT 'desctable' as table_name, COUNT(*) as row_count FROM desctable
        UNION ALL
        SELECT 'function_analysis' as table_name, COUNT(*) as row_count FROM function_analysis
        UNION ALL
        SELECT 'enhanced_signatures' as table_name, COUNT(*) as row_count FROM enhanced_signatures
        ORDER BY table_name;
    "

    # Update the denormalized view to ensure consistency
    echo ""
    echo "Recreating denormalized view..."
    docker exec bsim-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "
        DROP VIEW IF EXISTS exetable_denormalized CASCADE;
        CREATE OR REPLACE VIEW exetable_denormalized AS
        SELECT
            e.id,
            e.md5,
            e.sha256,
            e.name_exec,
            a.val AS architecture,
            e.ingest_date,
            e.game_version,
            gv.version_string,
            gv.version_family,
            gv.description AS version_description
        FROM exetable e
        LEFT JOIN archtable a ON (e.architecture = a.id)
        LEFT JOIN game_versions gv ON (e.game_version = gv.id)
        ORDER BY e.id;
    " > /dev/null 2>&1

    echo "✓ Denormalized view recreated"

    echo ""
    echo "=========================================="
    echo "Restore completed successfully!"
    echo "=========================================="
    echo "BSim database has been restored to the state from:"
    echo "  Backup: $BACKUP_NAME"
    echo "  Created: $(stat -c %y "$BACKUP_FILE" | cut -d. -f1)"
    echo ""
    echo "You can now use the restored data without re-running"
    echo "the lengthy ingestion process."
    echo ""

else
    echo "✗ Restore failed"
    echo "Check the backup file integrity and try again"
    exit 1
fi