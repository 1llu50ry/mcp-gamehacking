#!/bin/bash
# Populate Fresh BSim Database - Complete Workflow
# This script runs all steps to populate a clean BSim database

set -e

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

GHIDRA_DIR="./ghidra"
SCRIPTS_DIR="./ghidra-scripts"
PROJECT_DIR="./ghidra-projects"
BINARIES_DIR="./binaries"  # You'll need to specify where your binaries are

# BSim configuration
BSIM_URL="postgresql://${BSIM_DB_USER:-bsim_user}:${BSIM_DB_PASSWORD}@${BSIM_DB_HOST:-localhost}:${BSIM_DB_PORT:-5432}/${BSIM_DB_NAME:-bsim}"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}BSim Database Population Workflow${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Check prerequisites
echo -e "${CYAN}🔍 Checking prerequisites...${NC}"

if [ ! -d "$GHIDRA_DIR" ]; then
    echo -e "${RED}❌ Ghidra directory not found: $GHIDRA_DIR${NC}"
    exit 1
fi

if [ ! -d "$SCRIPTS_DIR" ]; then
    echo -e "${RED}❌ Scripts directory not found: $SCRIPTS_DIR${NC}"
    exit 1
fi

if [ ! -f "$GHIDRA_DIR/Ghidra/RuntimeScripts/Linux/support/analyzeHeadless" ]; then
    echo -e "${RED}❌ Ghidra analyzeHeadless not found${NC}"
    exit 1
fi

# Check database connectivity
if ! docker exec bsim-postgres psql -U ben -d bsim -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${RED}❌ Cannot connect to BSim database${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}"
echo ""

# Function to run Ghidra headless with a script
run_ghidra_script() {
    local script_name="$1"
    local description="$2"
    local binary_pattern="$3"

    echo -e "${CYAN}🔧 $description${NC}"
    echo "Script: $script_name"

    # Find binaries to process
    if [ -z "$binary_pattern" ]; then
        echo -e "${YELLOW}⚠️  No binary pattern specified, using all *.dll and *.exe files${NC}"
        binary_pattern="*.dll *.exe"
    fi

    # Create project directory if it doesn't exist
    mkdir -p "$PROJECT_DIR"

    # Run the script for each binary found
    find "$BINARIES_DIR" -type f \( -name "*.dll" -o -name "*.exe" \) 2>/dev/null | while read binary_file; do
        if [ -f "$binary_file" ]; then
            echo "Processing: $(basename "$binary_file")"

            # Run Ghidra headless analysis
            "$GHIDRA_DIR/Ghidra/RuntimeScripts/Linux/support/analyzeHeadless" \
                "$PROJECT_DIR" "BSim_Project" \
                -import "$binary_file" \
                -postScript "$script_name" \
                -scriptPath "$SCRIPTS_DIR" \
                -deleteProject \
                -overwrite
        fi
    done

    echo -e "${GREEN}✅ $description completed${NC}"
    echo ""
}

# Step 1: Add Programs to BSim Database
run_ghidra_script "Step1_AddProgramToBSimDatabase.java" "Step 1: Adding programs to BSim database"

# Step 2: Generate BSim Signatures
run_ghidra_script "Step2_GenerateBSimSignatures.java" "Step 2: Generating BSim signatures"

# Step 3: Populate Comments (optional - for syncing analyst comments)
run_ghidra_script "Step3_PopulateCommentsIntoBSim.java" "Step 3: Populating comments into BSim"

# Step 4: Generate Function Similarity Matrix
run_ghidra_script "Step4_GenerateFunctionSimilarityMatrix.java" "Step 4: Generating function similarity matrix"

# Step 5: Complete Similarity Workflow
run_ghidra_script "Step5_CompleteSimilarityWorkflow.java" "Step 5: Completing similarity workflow"

echo -e "${CYAN}📊 Verifying database population...${NC}"

# Check database statistics
DB_STATS=$(docker exec bsim-postgres psql -U ben -d bsim -t -c "
SELECT
    COUNT(*) as total_functions,
    COUNT(DISTINCT name_func) as unique_functions,
    COUNT(DISTINCT id_exe) as total_executables
FROM desctable;" | xargs)

echo "Database Statistics:"
echo "  $DB_STATS"

# Test data quality
if [ -f "./scripts/testing/test-bsim-data-quality.sh" ]; then
    echo -e "${CYAN}🧪 Running data quality tests...${NC}"
    ./scripts/testing/test-bsim-data-quality.sh
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}BSim Database Population Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "1. Clear API cache: curl -X POST localhost:8081/api/cache/clear"
echo "2. Test website functionality: https://d2docs.xebyte.com/"
echo "3. Monitor performance: ./monitor-bsim.sh"