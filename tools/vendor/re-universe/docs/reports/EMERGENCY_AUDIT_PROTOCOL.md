# Emergency Ghidra Repository Audit Protocol

## 🚨 **IMMEDIATE AUDIT REQUIRED**

**Status**: Migration PAUSED until analysis preservation complete
**Priority**: Emergency audit of 5,082 existing projects
**Goal**: Preserve valuable analysis work before restructuring

## **Audit Phase 1: Repository Survey**

### **Commands to Execute (Admin Access Required)**

#### **1.1 Project Inventory**
```bash
# List all projects with timestamps
sudo ls -la repo-data/pd2/ | head -50

# Count total projects
sudo ls repo-data/pd2/ | wc -l

# Look for project naming patterns
sudo ls repo-data/pd2/ | grep -i "d2\|diablo" | head -20

# Check for any D2Server projects
sudo ls repo-data/pd2/ | grep -i "server\|d2server"

# Look for version-specific projects
sudo ls repo-data/pd2/ | grep -E "1\.0[0-9]|1\.1[0-9]|1\.14"
```

#### **1.2 Project Size Analysis**
```bash
# Find largest projects (likely most analyzed)
sudo du -sh repo-data/pd2/* | sort -hr | head -20

# Find projects modified recently (active analysis)
sudo find repo-data/pd2/ -type d -mtime -30 | head -20

# Look for projects with specific binary names
sudo find repo-data/pd2/ -name "*d2server*" -o -name "*d2game*" -o -name "*d2net*" 2>/dev/null
```

#### **1.3 Critical Binary Search**
```bash
# Search for D2Server.dll analysis (HIGHEST PRIORITY)
sudo find repo-data/pd2/ -type f -name "*.gpr" | xargs sudo grep -l -i "d2server" 2>/dev/null | head -10

# Search for D2Game.dll analysis
sudo find repo-data/pd2/ -type f -name "*.gpr" | xargs sudo grep -l -i "d2game" 2>/dev/null | head -10

# Search for networking analysis
sudo find repo-data/pd2/ -type f -name "*.gpr" | xargs sudo grep -l -i "d2net\|network\|protocol" 2>/dev/null | head -10
```

## **Audit Phase 2: Analysis Quality Assessment**

### **For Each High-Priority Project:**

#### **2.1 Function Analysis Count**
```bash
# Count analyzed functions (look for custom names vs auto-generated)
sudo grep -c "FUN_\|SUB_\|func_" [project_file]
sudo grep -c -v "FUN_\|SUB_\|func_" [project_file] | grep -c "function"
```

#### **2.2 Documentation Quality**
```bash
# Look for comments and documentation
sudo grep -c "comment\|description\|note" [project_file]

# Check for custom data types
sudo grep -c "struct\|enum\|typedef" [project_file]

# Look for string references and analysis
sudo grep -c "string\|text\|message" [project_file]
```

#### **2.3 Research Value Indicators**
```bash
# Look for research-specific content
sudo grep -i "protocol\|packet\|network\|server\|client\|battle\.net" [project_file]

# Check for reverse engineering notes
sudo grep -i "analysis\|research\|reverse\|findings" [project_file]
```

## **Priority Preservation Matrix**

### **🚨 CRITICAL (Preserve Immediately)**
1. **Any D2Server.dll analysis** - Only server binary, irreplaceable
2. **Comprehensive D2Game.dll analysis** - Core engine insights
3. **Network protocol documentation** - Battle.net analysis
4. **Projects with >100 custom function names** - Significant research investment

### **📊 HIGH PRIORITY (Preserve Soon)**
1. **Version-specific analysis** - Maps to our 25-version collection
2. **Projects with custom structs/enums** - Reverse engineering work
3. **Recently modified projects** - Active research
4. **Large projects** - Significant analysis investment

### **📋 MEDIUM PRIORITY (Archive & Review)**
1. **Partial analysis projects** - Some research value
2. **Standard DLL analysis** - Basic function mapping
3. **Duplicate projects** - May have unique insights

### **📁 LOW PRIORITY (Archive Only)**
1. **Empty projects** - No analysis work
2. **Auto-generated analysis only** - No custom insights
3. **Corrupted projects** - Cannot be recovered

## **Preservation Workflow**

### **Step 1: Emergency Backup**
```bash
# Create emergency backup of critical projects
sudo cp -r repo-data/pd2/[critical_project] /tmp/emergency-preservation/

# Document project metadata
echo "Project: [name], Size: [size], Modified: [date], Analysis: [quality]" >> audit-log.txt
```

### **Step 2: Analysis Extraction**
```bash
# Export analysis data for preservation
# Extract function names, comments, structures
# Document research findings and notes
```

### **Step 3: Integration Planning**
```bash
# Map preserved analysis to our binary collection
# Plan merging strategy for duplicate binaries
# Design integration workflow
```

## **Audit Deliverables**

### **Expected Outputs:**
1. **Project inventory** - Complete list with metadata
2. **Critical project list** - Highest value analysis work
3. **Binary overlap matrix** - Which projects analyze our target files
4. **Preservation priority queue** - Order for analysis extraction
5. **Integration strategy** - How to merge with new structure

## **Next Steps After Audit**

1. **Emergency preservation** of critical analysis
2. **Revised migration plan** incorporating existing work
3. **Analysis merging methodology** design
4. **Integrated repository structure** creation

## **Audit Execution Requirements**

**Prerequisites:**
- Admin access to `repo-data/pd2/`
- Ghidra knowledge for project analysis
- Script execution permissions

**Estimated Time:**
- Phase 1 (Survey): 2-4 hours
- Phase 2 (Assessment): 4-8 hours per critical project
- Total: 1-2 days for comprehensive audit

**Status**: Ready to execute immediately upon admin access

Generated: February 21, 2026