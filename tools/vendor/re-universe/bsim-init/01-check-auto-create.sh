#!/bin/bash
# Conditional BSim Schema Auto-Creation Script
# This script checks if AUTO_CREATE_BSIM_SCHEMA is enabled before proceeding
# Runs first in /docker-entrypoint-initdb.d/ sequence

set -e

echo "========================================="
echo "BSim Auto-Creation Configuration Check"
echo "========================================="
echo ""

# Check if AUTO_CREATE_BSIM_SCHEMA environment variable is set
AUTO_CREATE="${AUTO_CREATE_BSIM_SCHEMA:-true}"

if [[ "${AUTO_CREATE}" == "true" ]]; then
    echo "✓ AUTO_CREATE_BSIM_SCHEMA=true - BSim schema will be auto-created"
    echo "  Schema files to be executed:"
    echo "    - 04-create-bsim-schema.sql (base BSim tables)"
    echo "    - 05-bsim-schema-extension.sql (documentation propagation tables)"
    echo ""
else
    echo "✗ AUTO_CREATE_BSIM_SCHEMA=false - Skipping BSim schema auto-creation"
    echo "  You will need to manually create the schema using:"
    echo "    1. Ghidra: ./bsim createdatabase postgresql://\$BSIM_DB_USER:\$BSIM_DB_PASSWORD@localhost:5432/\$BSIM_DB_NAME medium_32"
    echo "    2. Manual: psql -U \$BSIM_DB_USER -d \$BSIM_DB_NAME < bsim-init/04-create-bsim-schema.sql"
    echo ""

    # Remove schema creation scripts to prevent execution
    # (05-extension depends on 04-base, so both must be skipped)
    for sql_file in /docker-entrypoint-initdb.d/04-*.sql /docker-entrypoint-initdb.d/05-*.sql; do
        if [[ -f "$sql_file" ]]; then
            rm -f "$sql_file"
            echo "  Removed $(basename "$sql_file") from initialization sequence"
        fi
    done
fi

echo "========================================="
