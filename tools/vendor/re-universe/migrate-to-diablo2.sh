#!/bin/bash
# Ghidra Migration Script: Import binaries into diablo2 repository
# Structure: diablo2/vanilla/{versions} + diablo2/mods/pd2

set -e

GHIDRA_SERVER="ghidra://${GHIDRA_SERVER_HOST:-localhost}:${GHIDRA_SERVER_PORT:-13100}"
REPO_NAME="diablo2"
BINARIES_DIR="/data"  # Mounted binaries folder
GHIDRA_HOME="/opt/ghidra"

# Versions to import
VERSIONS=(1.00 1.01 1.02 1.03 1.04b 1.04c 1.05 1.05b 1.06 1.06b 1.07 1.08 1.09 1.09b 1.09d 1.10 1.11 1.11b 1.12a 1.13c 1.13d 1.14a 1.14b 1.14c 1.14d)

echo "=== Ghidra Migration: binaries/ → diablo2 repository ==="
echo "Server: $GHIDRA_SERVER"
echo "Repository: $REPO_NAME"
echo ""

# Import vanilla versions
echo "=== Importing vanilla versions ==="
for VERSION in "${VERSIONS[@]}"; do
    VERSION_DIR="$BINARIES_DIR/$VERSION"
    if [ -d "$VERSION_DIR" ]; then
        echo "Importing $VERSION..."
        $GHIDRA_HOME/support/analyzeHeadless \
            "$GHIDRA_SERVER/$REPO_NAME/vanilla/$VERSION" \
            -import "$VERSION_DIR" \
            -recursive \
            -noanalysis \
            -overwrite \
            2>&1 | grep -E "(INFO|WARN|ERROR|Import)" || true
        echo "  Done: $VERSION"
    else
        echo "  SKIP: $VERSION (directory not found)"
    fi
done

# Import PD2 mod
echo ""
echo "=== Importing PD2 mod ==="
PD2_DIR="$BINARIES_DIR/pd2"
if [ -d "$PD2_DIR" ]; then
    echo "Importing PD2..."
    $GHIDRA_HOME/support/analyzeHeadless \
        "$GHIDRA_SERVER/$REPO_NAME/mods/pd2" \
        -import "$PD2_DIR" \
        -recursive \
        -noanalysis \
        -overwrite \
        2>&1 | grep -E "(INFO|WARN|ERROR|Import)" || true
    echo "  Done: PD2"
else
    echo "  SKIP: PD2 (directory not found)"
fi

echo ""
echo "=== Migration Complete ==="
echo "Repository: $GHIDRA_SERVER/$REPO_NAME"
echo "Structure:"
echo "  /vanilla/{1.00..1.14d}"
echo "  /mods/pd2"
