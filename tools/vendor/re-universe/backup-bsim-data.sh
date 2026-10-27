#!/bin/bash
#
# BSim Data Backup Script
# Backs up tables written by Step1_AddProgramToBSimDatabase.java
#
# Usage: ./backup-bsim-data.sh [backup_name]
#
# This script backs up the core BSim ingestion tables:
# - exetable: Executable metadata
# - desctable: Function descriptions and signatures
# - function_analysis: Function analysis data
# - enhanced_signatures: LSH signatures and vectors
#
# The backup includes both schema and data, allowing complete restoration.

set -e  # Exit on any error

# Configuration
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="bsim"
DB_USER="${BSIM_DB_USER:-bsim_user}"
export PGPASSWORD="${BSIM_DB_PASSWORD:?BSIM_DB_PASSWORD must be set}"

# Get backup name from argument or generate timestamp-based name
BACKUP_NAME="${1:-bsim-post-step1-$(date +%Y%m%d_%H%M%S)}"
BACKUP_DIR="${BACKUP_BASE_DIR:-./backups}"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.sql"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "=========================================="
echo "BSim Data Backup Script"
echo "=========================================="
echo "Backup name: $BACKUP_NAME"
echo "Backup file: $BACKUP_FILE"
echo "Database: $DB_NAME@$DB_HOST:$DB_PORT"
echo ""

# Check database connection
echo "Testing database connection..."
if ! docker exec bsim-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 'Connection successful' as status;" > /dev/null 2>&1; then
    echo "ERROR: Cannot connect to database"
    exit 1
fi
echo "✓ Database connection successful"

# Get row counts before backup
echo ""
echo "Current table statistics:"
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

echo ""
echo "Creating backup..."

# Create comprehensive backup with schema and data
docker exec bsim-postgres pg_dump -U "$DB_USER" -d "$DB_NAME" \
    --no-password \
    --verbose \
    --clean \
    --if-exists \
    --create \
    --format=plain \
    --encoding=UTF-8 \
    --schema=public \
    --table=exetable \
    --table=desctable \
    --table=function_analysis \
    --table=enhanced_signatures \
    --table=keyvaluetable \
    --table=game_versions \
    --table=archtable \
    --table=compilertable \
    --table=repositorytable \
    --table=pathtable > "$BACKUP_FILE" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✓ Backup created successfully"
    echo ""
    echo "Backup details:"
    echo "  File: $BACKUP_FILE"
    echo "  Size: $(du -h "$BACKUP_FILE" | cut -f1)"
    echo "  Lines: $(wc -l < "$BACKUP_FILE")"

    # Verify backup contains expected tables
    echo ""
    echo "Backup verification:"
    for table in exetable desctable function_analysis enhanced_signatures; do
        if grep -q "CREATE TABLE.*$table" "$BACKUP_FILE"; then
            echo "  ✓ $table schema included"
        else
            echo "  ✗ $table schema missing"
        fi

        if grep -q "COPY.*$table" "$BACKUP_FILE"; then
            echo "  ✓ $table data included"
        else
            echo "  ✗ $table data missing"
        fi
    done

    echo ""
    echo "=========================================="
    echo "Backup completed successfully!"
    echo "=========================================="
    echo "To restore this backup, run:"
    echo "  ./restore-bsim-data.sh $BACKUP_NAME"
    echo ""

else
    echo "✗ Backup failed"
    exit 1
fi