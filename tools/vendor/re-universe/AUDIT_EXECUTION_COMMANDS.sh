#!/bin/bash
# Emergency Ghidra Repository Audit - Execution Script
# Execute with admin privileges: sudo bash AUDIT_EXECUTION_COMMANDS.sh

echo "🚨 EMERGENCY AUDIT: Starting pd2 repository analysis..."
echo "Audit started: $(date)"

# Create audit workspace
mkdir -p /tmp/ghidra-audit/{critical,high-priority,analysis-logs}
cd /tmp/ghidra-audit

echo ""
echo "=== PHASE 1: REPOSITORY SURVEY ==="

echo "Total projects in pd2 repository:"
ls repo-data/pd2/ | wc -l

echo ""
echo "First 20 project names:"
ls repo-data/pd2/ | head -20

echo ""
echo "🔍 CRITICAL SEARCH: D2Server projects"
ls repo-data/pd2/ | grep -i "server\|d2server" | tee analysis-logs/d2server-projects.txt

echo ""
echo "🔍 Diablo-related projects:"
ls repo-data/pd2/ | grep -i "d2\|diablo" | head -20 | tee analysis-logs/diablo-projects.txt

echo ""
echo "🔍 Version-specific projects:"
ls repo-data/pd2/ | grep -E "1\.0[0-9]|1\.1[0-9]|1\.14" | tee analysis-logs/version-projects.txt

echo ""
echo "=== PHASE 2: PROJECT SIZE ANALYSIS ==="

echo "Top 20 largest projects (most likely analyzed):"
du -sh repo-data/pd2/* | sort -hr | head -20 | tee analysis-logs/largest-projects.txt

echo ""
echo "Recently modified projects (active analysis):"
find repo-data/pd2/ -type d -mtime -30 | head -20 | tee analysis-logs/recent-projects.txt

echo ""
echo "=== PHASE 3: CRITICAL BINARY SEARCH ==="

echo "🚨 SEARCHING for D2Server.dll analysis (HIGHEST PRIORITY):"
find repo-data/pd2/ -name "*d2server*" -o -name "*D2Server*" 2>/dev/null | tee analysis-logs/d2server-files.txt

echo ""
echo "Searching for D2Game.dll analysis:"
find repo-data/pd2/ -name "*d2game*" -o -name "*D2Game*" 2>/dev/null | tee analysis-logs/d2game-files.txt

echo ""
echo "Searching for networking/protocol analysis:"
find repo-data/pd2/ -name "*d2net*" -o -name "*network*" -o -name "*protocol*" 2>/dev/null | tee analysis-logs/network-files.txt

echo ""
echo "=== PHASE 4: PROJECT METADATA COLLECTION ==="

echo "Creating project metadata summary..."
echo "Project_Name,Size_MB,Modified_Date,Type" > analysis-logs/project-metadata.csv

for project in repo-data/pd2/*; do
    if [ -d "$project" ]; then
        name=$(basename "$project")
        size=$(du -sm "$project" 2>/dev/null | cut -f1)
        modified=$(stat -c %y "$project" 2>/dev/null | cut -d' ' -f1)
        echo "$name,$size,$modified,ghidra_project" >> analysis-logs/project-metadata.csv
    fi
done

echo ""
echo "=== AUDIT SUMMARY ==="
echo "Total projects audited: $(ls repo-data/pd2/ | wc -l)"
echo "D2Server references found: $(cat analysis-logs/d2server-*.txt | wc -l)"
echo "Diablo-related projects: $(cat analysis-logs/diablo-projects.txt | wc -l)"
echo "Version-specific projects: $(cat analysis-logs/version-projects.txt | wc -l)"

echo ""
echo "🎯 CRITICAL FINDINGS:"
if [ -s analysis-logs/d2server-files.txt ]; then
    echo "⚠️  D2Server analysis found! IMMEDIATE preservation required:"
    cat analysis-logs/d2server-files.txt
else
    echo "✓ No existing D2Server analysis found"
fi

echo ""
echo "📊 NEXT ACTIONS REQUIRED:"
echo "1. Review analysis-logs/ for critical projects"
echo "2. Execute emergency preservation of high-priority projects"
echo "3. Develop integration strategy for existing analysis"
echo "4. Revise migration plan to preserve valuable work"

echo ""
echo "Audit completed: $(date)"
echo "Results saved to: /tmp/ghidra-audit/analysis-logs/"

# Make audit results accessible
chmod -R 755 /tmp/ghidra-audit/
chown -R ben:ben /tmp/ghidra-audit/

echo ""
echo "🚨 MIGRATION STATUS: PAUSED until preservation strategy complete"