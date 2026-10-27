#!/bin/bash
# RE-Universe Database Restore Script
# Use when: Container recreated, data lost, or recovery needed
# Run from: ~/re-universe directory

set -e
cd "$(dirname "$0")/.."

BACKUP_FILE="backups/backups/complete-system-backup-20260203_142107/bsim-database-complete.sql"

echo "🔄 RE-Universe Database Restore"
echo "================================"

# Check backup exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Backup not found: $BACKUP_FILE"
    exit 1
fi

echo "📋 Stopping dependent services..."
docker compose stop ai-orchestration chat-interface github-mining knowledge-integration monitoring-dashboard vector-search ghidra-api ghidra-web ghidra-mcp

echo "🗑️ Recreating database..."
docker exec bsim-postgres psql -U ben -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'bsim' AND pid <> pg_backend_pid();" 2>/dev/null || true
docker exec bsim-postgres dropdb -U ben --if-exists bsim
docker exec bsim-postgres createdb -U ben bsim

echo "📦 Adding pgvector extension..."
docker exec bsim-postgres psql -U ben -d bsim -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "🔄 Restoring from backup (this takes ~2-3 minutes)..."
tail -n +2 "$BACKUP_FILE" | docker exec -i bsim-postgres psql -U ben -d bsim 2>&1 | tail -5

echo "🚀 Starting all services..."
docker compose up -d
sleep 30

echo "✅ Verifying restore..."
COUNT=$(docker exec bsim-postgres psql -U ben -d bsim -t -c "SELECT COUNT(*) FROM desctable;")
echo "Functions restored: $COUNT"

if [ "$COUNT" -gt 0 ]; then
    echo "🎉 Database restore successful!"
    ./health-check.sh | tail -15
else
    echo "❌ Restore failed - no data"
    exit 1
fi
