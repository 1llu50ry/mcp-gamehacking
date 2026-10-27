#!/bin/bash

# Ghidra LSH Extension Installation Script
# This script installs the Ghidra LSH extension into PostgreSQL for BSim functionality

set -e

echo "=== Ghidra LSH Extension Installation ==="

# Check if LSH extension files exist
LSH_DIR="./postgres-lsh"
if [[ ! -d "$LSH_DIR" ]]; then
    echo "ERROR: LSH extension directory not found: $LSH_DIR"
    echo "Please copy the Ghidra LSH extension files to this directory:"
    echo "  - lsh.control"
    echo "  - lsh--1.0.sql (or similar version)"
    echo "  - lsh.so (Linux) or lsh.dll (Windows)"
    echo ""
    echo "These files are typically found in:"
    echo "  GHIDRA_INSTALL/Extensions/BSim/data/postgresql_lsh/"
    echo "  GHIDRA_INSTALL/Ghidra/Features/BSim/data/postgresql_lsh/"
    exit 1
fi

echo "Found LSH extension directory: $LSH_DIR"
echo "Contents:"
ls -la "$LSH_DIR"

# Copy extension files to PostgreSQL container
echo "Installing LSH extension files to PostgreSQL..."

# Copy control file
if [[ -f "$LSH_DIR/lsh.control" ]]; then
    docker cp "$LSH_DIR/lsh.control" bsim-postgres:/usr/share/postgresql/15/extension/
    echo "✓ Installed lsh.control"
else
    echo "⚠ WARNING: lsh.control not found"
fi

# Copy SQL files
for sql_file in "$LSH_DIR"/lsh--*.sql; do
    if [[ -f "$sql_file" ]]; then
        docker cp "$sql_file" bsim-postgres:/usr/share/postgresql/15/extension/
        echo "✓ Installed $(basename "$sql_file")"
    fi
done

# Copy shared library
if [[ -f "$LSH_DIR/lsh.so" ]]; then
    docker cp "$LSH_DIR/lsh.so" bsim-postgres:/usr/lib/postgresql/15/lib/
    echo "✓ Installed lsh.so"
elif [[ -f "$LSH_DIR/lsh.dll" ]]; then
    docker cp "$LSH_DIR/lsh.dll" bsim-postgres:/usr/lib/postgresql/15/lib/
    echo "✓ Installed lsh.dll"
else
    echo "⚠ WARNING: No LSH shared library found (.so or .dll)"
fi

# Set proper permissions
echo "Setting permissions..."
docker exec bsim-postgres chown postgres:postgres /usr/share/postgresql/15/extension/lsh*
docker exec bsim-postgres chown postgres:postgres /usr/lib/postgresql/15/lib/lsh* 2>/dev/null || true
docker exec bsim-postgres chmod 644 /usr/share/postgresql/15/extension/lsh*
docker exec bsim-postgres chmod 755 /usr/lib/postgresql/15/lib/lsh* 2>/dev/null || true

echo "LSH extension files installed successfully!"

# Create extension in database
echo "Creating LSH extension in BSim database..."
if docker exec bsim-postgres psql -U ben -d bsim -c "CREATE EXTENSION IF NOT EXISTS lsh;"; then
    echo "✓ LSH extension created successfully!"

    # Test LSH functions
    echo "Testing LSH functionality..."
    if docker exec bsim-postgres psql -U ben -d bsim -c "SELECT lsh_load();" 2>/dev/null; then
        echo "✓ LSH extension is working!"
        echo "🎉 BSim database is now fully functional!"
    else
        echo "⚠ LSH extension installed but lsh_load() test failed"
        echo "This may be normal - Ghidra will initialize LSH on first use"
    fi
else
    echo "❌ Failed to create LSH extension"
    echo "Check the PostgreSQL logs for errors:"
    echo "  docker logs bsim-postgres"
fi

echo "=== LSH Installation Complete ==="