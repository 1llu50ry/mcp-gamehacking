#!/bin/bash
#
# Post-Ingestion Backup Script
# Creates a backup immediately after Step1_AddProgramToBSimDatabase.java completes
#
# This script creates a comprehensive backup of all BSim data after the
# lengthy ingestion process, allowing quick restoration without re-running
# the entire analysis pipeline.
#

set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="bsim-post-step1-ingestion-${TIMESTAMP}"

echo "=========================================="
echo "Post-Ingestion BSim Backup"
echo "=========================================="
echo "Creating backup after ingestion completion..."
echo ""

# Run the backup
./backup-bsim-data.sh "$BACKUP_NAME"

echo ""
echo "✅ Post-ingestion backup completed!"
echo ""
echo "This backup captures:"
echo "  • All executable metadata (exetable)"
echo "  • All function signatures (desctable)"
echo "  • All function analysis data (function_analysis)"
echo "  • All enhanced signatures (enhanced_signatures)"
echo "  • Configuration and lookup tables"
echo ""
echo "To restore to this point in the future:"
echo "  ./restore-bsim-data.sh $BACKUP_NAME"
echo ""
echo "This allows you to skip the lengthy ingestion process"
echo "and restore directly to the completed analysis state."