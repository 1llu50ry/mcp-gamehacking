/* ###
 * IP: GHIDRA
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
//Ingests a well-documented REFERENCE program into BSim database.
//NO GUI - All configuration is preset. Supports headless execution.
//Marks the program with "ReferenceLibrary" category and tags documented functions.
//@category BSim
//@menupath Tools.BSim.Ingest Reference Program
import java.io.IOException;
import java.net.URL;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import generic.lsh.vector.LSHVectorFactory;
import ghidra.app.script.GhidraScript;
import ghidra.features.bsim.query.*;
import ghidra.features.bsim.query.BSimServerInfo.DBType;
import ghidra.features.bsim.query.FunctionDatabase.BSimError;
import ghidra.features.bsim.query.description.*;
import ghidra.features.bsim.query.protocol.*;
import ghidra.framework.model.DomainFile;
import ghidra.framework.model.DomainFolder;
import ghidra.framework.options.Options;
import ghidra.framework.protocol.ghidra.GhidraURL;
import ghidra.program.model.listing.*;
import ghidra.util.Msg;

/**
 * Ingests a well-documented reference program into the BSim database.
 * 
 * NO GUI DIALOGS - All configuration is preset below.
 * Fully supports headless execution via analyzeHeadless.
 * 
 * This script is designed for programs that will serve as the SOURCE of documentation
 * for BSim-based propagation to other versions/binaries.
 */
public class IngestReferenceProgramScript extends GhidraScript {

    // ========================================================================
    // CONNECTION CONFIGURATION - Edit these values before running
    // ========================================================================
    private static final String DB_HOST = System.getenv().getOrDefault("BSIM_DB_HOST", "localhost");
    private static final int DB_PORT = 5432;
    private static final String DB_NAME = "bsim";
    private static final String DB_USERNAME = "ben";
    
    // ========================================================================
    // INGESTION CONFIGURATION
    // ========================================================================
    // Tag documented functions with "DOCUMENTED" tag
    private static final boolean TAG_DOCUMENTED_FUNCTIONS = true;
    
    // Auto-detect version from folder path (e.g., /LoD/1.09d/D2Client.dll -> "1.09d")
    private static final boolean AUTO_DETECT_VERSION = true;
    
    // Fallback version if auto-detection fails (set to null to require detection)
    private static final String FALLBACK_VERSION = null;
    
    // Auto-detect platform from folder path (LoD, Classic, PD2)
    private static final boolean AUTO_DETECT_PLATFORM = true;
    
    // Auto-detect module from program name (D2Client, D2Game, D2Common, etc.)
    private static final boolean AUTO_DETECT_MODULE = true;
    
    // Analysis state for this ingestion (Initial, InProgress, Complete, Reviewed)
    private static final String ANALYSIS_STATE = "Complete";
    
    // Analyst name (optional - for team workflows)
    private static final String ANALYST = null;  // Set to "yourname" if desired
    
    // Detect and annotate source file paths from string references
    // Looks for patterns like "C:\Projects\D2*\*.cpp" in function string refs
    private static final boolean DETECT_SOURCE_FILES = true;
    
    // Add source file to plate comment if detected
    private static final boolean ANNOTATE_SOURCE_IN_COMMENT = true;
    
    // ========================================================================
    // DUPLICATE HANDLING STRATEGY
    // ========================================================================
    // Options:
    //   SKIP    - Skip if program already exists (safest, default)
    //   UPGRADE - Replace only if current program has BETTER documentation score
    //   FORCE   - Always replace existing entry (use with caution)
    //   FAIL    - Fail with error if duplicate exists
    private static final DuplicateStrategy DUPLICATE_STRATEGY = DuplicateStrategy.UPGRADE;
    
    // Minimum documentation score improvement required for UPGRADE strategy (0.0 = any improvement)
    private static final double MIN_SCORE_IMPROVEMENT = 0.05;  // 5% improvement required
    
    // ========================================================================
    // DATABASE CLEANUP OPTIONS
    // ========================================================================
    // If you get "duplicate key value violates unique constraint" errors, the database
    // has orphaned data from a failed previous insert. Options:
    //   1. Set WIPE_DATABASE_BEFORE_INSERT = true (clears ALL data in database!)
    //   2. Manually run SQL: DELETE FROM callgraphtable; DELETE FROM desctable; DELETE FROM exetable;
    //   3. Drop and recreate the database
    private static final boolean WIPE_DATABASE_BEFORE_INSERT = false;  // DANGEROUS - clears all data!
    
    // ========================================================================
    // CALLGRAPH TRACKING
    // ========================================================================
    // Disable callgraph tracking if you get "duplicate key violates callgraphtable_pkey" errors.
    // This happens when a function calls another function multiple times - BSim tries to insert
    // duplicate (src, dest) pairs. Set to false to work around this BSim bug.
    private static final boolean DISABLE_CALLGRAPH_TRACKING = true;  // Set to false if you need callgraph
    
    // ========================================================================
    // BATCH PROCESSING MODE
    // ========================================================================
    // Process multiple programs at once instead of just the current program.
    // 
    // Options:
    //   SINGLE           - Only process the currently open program (default)
    //   VERSION_FOLDER   - Process all binaries in the same version folder as current program
    //   ALL_VERSIONS     - Process all binaries across ALL version folders in the project
    //
    // Folder structure expected:
    //   /Project/Platform/Version/Binary.dll
    //   Example: /D2Project/LoD/1.09d/D2Client.dll
    //            /D2Project/LoD/1.10/D2Client.dll
    //            /D2Project/Classic/1.00/D2Client.dll
    private static final BatchMode BATCH_MODE = BatchMode.ALL_VERSIONS;
    
    // Filter which binaries to process (regex pattern, null = all)
    // Examples: "D2.*\\.dll" for all D2 DLLs, "D2Client\\.dll" for just D2Client
    private static final String BINARY_FILTER_PATTERN = null;  // null = process all
    
    // Skip binaries that already exist in the database (when batch processing)
    // NOTE: Set to false if skip detection is giving false positives
    private static final boolean BATCH_SKIP_EXISTING = false;
    
    // Continue processing remaining binaries if one fails
    private static final boolean BATCH_CONTINUE_ON_ERROR = true;
    
    private enum BatchMode { SINGLE, VERSION_FOLDER, ALL_VERSIONS }
    
    private enum DuplicateStrategy { SKIP, UPGRADE, FORCE, FAIL }

    // Statistics (per-program, reset for each program in batch mode)
    private int totalFunctions = 0;
    private int documentedFunctions = 0;
    private int namedFunctions = 0;
    private int functionsWithPlateComments = 0;
    private int functionsWithSignatures = 0;
    private int functionsWithParamNames = 0;
    private int functionsWithLocalVarNames = 0;
    private int functionsWithInlineComments = 0;
    
    // Computed documentation score (0.0 - 1.0)
    private double documentationScore = 0.0;
    
    // Source file tracking
    private Set<String> detectedSourceFiles = new HashSet<>();
    private Map<Function, String> functionSourceFiles = new HashMap<>();
    private int functionsWithSourceFiles = 0;
    
    // Batch processing statistics
    private int batchTotalPrograms = 0;
    private int batchSuccessCount = 0;
    private int batchSkippedCount = 0;
    private int batchFailedCount = 0;
    private List<String> batchSuccessList = new ArrayList<>();
    private List<String> batchSkippedList = new ArrayList<>();
    private List<String> batchFailedList = new ArrayList<>();

    @Override
    protected void run() throws Exception {
        if (currentProgram == null) {
            printerr("ERROR: No program is open. Open a reference program first.");
            return;
        }

        // Handle batch mode
        if (BATCH_MODE != BatchMode.SINGLE) {
            runBatchMode();
            return;
        }
        
        // Single program mode - process just the current program
        processSingleProgram(currentProgram);
    }
    
    /**
     * Batch processing mode - process multiple programs based on BATCH_MODE setting.
     */
    private void runBatchMode() throws Exception {
        println("=".repeat(70));
        println("BATCH INGEST REFERENCE PROGRAMS TO BSIM");
        println("=".repeat(70));
        println("");
        println("Mode: " + BATCH_MODE);
        println("Database: " + DB_HOST + ":" + DB_PORT + "/" + DB_NAME);
        println("");
        
        // Reset batch statistics
        batchTotalPrograms = 0;
        batchSuccessCount = 0;
        batchSkippedCount = 0;
        batchFailedCount = 0;
        batchSuccessList.clear();
        batchSkippedList.clear();
        batchFailedList.clear();
        
        // Get the list of programs to process
        List<DomainFile> programsToProcess = collectProgramsForBatch();
        
        if (programsToProcess.isEmpty()) {
            printerr("ERROR: No programs found to process.");
            return;
        }
        
        batchTotalPrograms = programsToProcess.size();
        println("Found " + batchTotalPrograms + " program(s) to process.");
        if (BINARY_FILTER_PATTERN != null) {
            println("Filter: " + BINARY_FILTER_PATTERN);
        }
        println("");
        
        // Process each program
        int current = 0;
        for (DomainFile domainFile : programsToProcess) {
            current++;
            println("-".repeat(70));
            println("Processing [" + current + "/" + batchTotalPrograms + "]: " + domainFile.getPathname());
            
            try {
                // Open the program
                Program program = (Program) domainFile.getDomainObject(this, false, false, monitor);
                
                try {
                    // Process it
                    boolean success = processSingleProgramForBatch(program);
                    
                    if (success) {
                        batchSuccessCount++;
                        batchSuccessList.add(domainFile.getPathname());
                    }
                } finally {
                    // Always release the program
                    program.release(this);
                }
                
            } catch (Exception e) {
                String errorMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                
                // Check if this was a skip (already exists)
                if (errorMsg.contains("SKIPPED") || errorMsg.contains("already exists")) {
                    batchSkippedCount++;
                    batchSkippedList.add(domainFile.getPathname() + " - " + errorMsg);
                    println("  SKIPPED: " + errorMsg);
                } else {
                    batchFailedCount++;
                    batchFailedList.add(domainFile.getPathname() + " - " + errorMsg);
                    printerr("  FAILED: " + errorMsg);
                    
                    if (!BATCH_CONTINUE_ON_ERROR) {
                        printerr("Batch processing stopped due to error (BATCH_CONTINUE_ON_ERROR=false)");
                        break;
                    }
                }
            }
            
            // Check for user cancellation
            if (monitor.isCancelled()) {
                println("Batch processing cancelled by user.");
                break;
            }
        }
        
        // Print batch summary
        printBatchSummary();
    }
    
    /**
     * Collect the list of programs to process based on BATCH_MODE.
     */
    private List<DomainFile> collectProgramsForBatch() throws Exception {
        List<DomainFile> programs = new ArrayList<>();
        
        DomainFile currentDomainFile = currentProgram.getDomainFile();
        DomainFolder currentFolder = currentDomainFile.getParent();
        
        if (BATCH_MODE == BatchMode.VERSION_FOLDER) {
            // Process all programs in the same folder as current program
            println("Scanning version folder: " + currentFolder.getPathname());
            collectProgramsFromFolder(currentFolder, programs, false);
            
        } else if (BATCH_MODE == BatchMode.ALL_VERSIONS) {
            // Find the PROJECT ROOT and scan everything recursively
            // Walk up to the root folder
            DomainFolder rootFolder = currentFolder;
            while (rootFolder.getParent() != null) {
                rootFolder = rootFolder.getParent();
            }
            
            println("Scanning entire project from root: " + rootFolder.getPathname());
            println("  (Starting folder: " + currentFolder.getPathname() + ")");
            collectProgramsFromFolder(rootFolder, programs, true);
        }
        
        // Apply binary filter if specified
        if (BINARY_FILTER_PATTERN != null && !BINARY_FILTER_PATTERN.isEmpty()) {
            java.util.regex.Pattern pattern = java.util.regex.Pattern.compile(
                BINARY_FILTER_PATTERN, java.util.regex.Pattern.CASE_INSENSITIVE);
            programs.removeIf(df -> !pattern.matcher(df.getName()).matches());
        }
        
        return programs;
    }
    
    /**
     * Recursively collect programs from a folder.
     */
    private void collectProgramsFromFolder(DomainFolder folder, List<DomainFile> programs, 
                                           boolean recurse) throws Exception {
        // Get all files in this folder
        for (DomainFile file : folder.getFiles()) {
            // Check if it's a Program (not a data type archive, etc.)
            if (Program.class.isAssignableFrom(file.getDomainObjectClass())) {
                programs.add(file);
            }
        }
        
        // Recurse into subfolders if requested
        if (recurse) {
            for (DomainFolder subfolder : folder.getFolders()) {
                collectProgramsFromFolder(subfolder, programs, true);
            }
        }
    }
    
    /**
     * Process a single program for batch mode. Returns true on success.
     * Throws exception with "SKIPPED" in message if program was skipped.
     */
    private boolean processSingleProgramForBatch(Program program) throws Exception {
        // Reset per-program statistics
        resetStatistics();
        
        String programName = program.getName();
        String path = program.getDomainFile().getPathname();
        
        // Auto-detect version, platform, and module from the program's path
        String version = detectVersionFromPath(path);
        String platform = detectPlatformFromPath(path);
        String module = detectModuleFromName(programName);
        
        if (version == null && FALLBACK_VERSION != null) {
            version = FALLBACK_VERSION;
        }
        
        if (version == null) {
            throw new Exception("Could not detect version from path: " + path);
        }
        
        println("  Version: " + version + ", Platform: " + platform + ", Module: " + module);
        
        // Connect to BSim and process
        BSimServerInfo serverInfo = new BSimServerInfo(DBType.postgres, DB_USERNAME, DB_HOST, DB_PORT, DB_NAME);
        
        try (FunctionDatabase pgDatabase = BSimClientFactory.buildClient(serverInfo, false)) {
            if (!pgDatabase.initialize()) {
                throw new IOException("Failed to connect to BSim database");
            }
            
            DatabaseInformation dbInfo = pgDatabase.getInfo();
            LSHVectorFactory vectorFactory = pgDatabase.getLSHVectorFactory();
            
            // Check if program already exists
            if (BATCH_SKIP_EXISTING) {
                // Query for existing executable with same name
                QueryExeInfo query = new QueryExeInfo();
                query.filterMd5 = program.getExecutableMD5();
                ResponseExe response = query.execute(pgDatabase);
                if (response != null && response.recordCount > 0) {
                    throw new Exception("SKIPPED - already exists in database");
                }
                // Also check by name
                query = new QueryExeInfo();
                query.filterExeName = programName;
                response = query.execute(pgDatabase);
                if (response != null && response.recordCount > 0) {
                    throw new Exception("SKIPPED - program with same name already exists");
                }
            }
            
            // Calculate documentation score for this program
            documentationScore = calculateDocumentationScoreForProgram(program);
            
            // Set executable categories on program (like single mode does)
            // These are stored as program properties that BSim reads during openProgram()
            int transactionId = program.startTransaction("Set BSim Categories for Batch");
            boolean txSuccess = false;
            try {
                Options programInfo = program.getOptions(Program.PROGRAM_INFO);
                
                if (version != null) {
                    programInfo.setString("Version", version);
                }
                if (platform != null) {
                    programInfo.setString("Platform", platform);
                }
                if (module != null) {
                    programInfo.setString("Module", module);
                }
                programInfo.setString("AnalysisState", ANALYSIS_STATE);
                programInfo.setString("ReferenceLibrary", "true");
                programInfo.setString("DocScore", String.format("%.3f", documentationScore));
                
                txSuccess = true;
            } finally {
                program.endTransaction(transactionId, txSuccess);
            }
            
            // Generate and insert signatures (same logic as single mode)
            println("  Generating BSim signatures...");
            
            boolean trackCallgraph = dbInfo.trackcallgraph && !DISABLE_CALLGRAPH_TRACKING;
            GenSignatures gensig = new GenSignatures(trackCallgraph);
            gensig.setVectorFactory(vectorFactory);
            
            List<String> allCategories = buildCategoryList(dbInfo);
            gensig.addExecutableCategories(allCategories);
            gensig.addFunctionTags(dbInfo.functionTags);
            
            // CRITICAL: Create version-qualified executable name to avoid BSim deduplication
            // BSim uses executable name as unique identifier, so D2Client.dll from all versions
            // would be treated as the same executable. We prefix with version to differentiate.
            // Format: "1.00_D2Client.dll" or "LoD_1.00_D2Client.dll"
            String versionQualifiedName;
            if (platform != null && !platform.isEmpty()) {
                versionQualifiedName = platform + "_" + version + "_" + programName;
            } else {
                versionQualifiedName = version + "_" + programName;
            }
            println("  BSim executable name: " + versionQualifiedName);
            gensig.openProgram(program, versionQualifiedName, null, null, null, null);
            
            // Generate signatures for all functions
            FunctionIterator funcIter = program.getFunctionManager().getFunctions(true);
            int funcCount = 0;
            while (funcIter.hasNext() && !monitor.isCancelled()) {
                Function func = funcIter.next();
                if (func.isExternal()) continue;
                try {
                    gensig.scanFunction(func);
                    funcCount++;
                } catch (Exception e) {
                    // Skip functions that fail to scan
                }
            }
            
            // Insert into database using InsertRequest (like single mode)
            DescriptionManager descMgr = gensig.getDescriptionManager();
            if (descMgr == null || descMgr.numFunctions() == 0) {
                gensig.dispose();
                throw new Exception("No functions to insert");
            }
            
            // SAFETY: Delete any existing entry before insert to handle re-ingestion
            // This is needed because BSim refuses to insert if an executable with same name exists
            String executableMd5 = program.getExecutableMD5();
            println("  Cleaning up any existing entries...");
            try {
                safetyDeleteBeforeInsert(pgDatabase, executableMd5, versionQualifiedName);
            } catch (Exception e) {
                println("    Cleanup note: " + e.getMessage());
                // Continue anyway
            }
            
            InsertRequest insertReq = new InsertRequest();
            insertReq.repo_override = null;
            insertReq.manage = descMgr;
            
            ResponseInsert insertResponse = insertReq.execute(pgDatabase);
            if (insertResponse == null) {
                BSimError lastError = pgDatabase.getLastError();
                String errorMsg = lastError != null ? lastError.message : "Unknown error";
                gensig.dispose();
                throw new IOException("Insert failed: " + errorMsg);
            }
            
            gensig.dispose();
            println("  SUCCESS: Ingested " + funcCount + " functions from " + programName);
            return true;
        }
    }
    
    /**
     * Calculate documentation score for a specific program (for batch mode).
     */
    private double calculateDocumentationScoreForProgram(Program program) {
        int total = 0;
        int named = 0;
        int withPlate = 0;
        int withParams = 0;
        
        FunctionIterator funcIter = program.getFunctionManager().getFunctions(true);
        while (funcIter.hasNext()) {
            Function func = funcIter.next();
            if (func.isExternal() || func.isThunk()) continue;
            total++;
            
            String funcName = func.getName();
            if (!funcName.startsWith("FUN_") && !funcName.startsWith("sub_")) {
                named++;
            }
            if (func.getComment() != null && !func.getComment().isEmpty()) {
                withPlate++;
            }
            for (Parameter param : func.getParameters()) {
                if (!param.getName().matches("param_\\d+")) {
                    withParams++;
                    break;
                }
            }
        }
        
        if (total == 0) return 0.0;
        
        // Simple scoring: 50% for naming, 25% for comments, 25% for parameters
        double score = 0.0;
        score += 0.50 * ((double) named / total);
        score += 0.25 * ((double) withPlate / total);
        score += 0.25 * ((double) withParams / total);
        
        return Math.min(1.0, score);
    }
    
    /**
     * Build the category list for BSim signatures.
     */
    private List<String> buildCategoryList(DatabaseInformation dbInfo) {
        List<String> allCategories = new ArrayList<>();
        if (dbInfo.execats != null) {
            allCategories.addAll(dbInfo.execats);
        }
        String[] required = {"Version", "Platform", "ReferenceLibrary", "DocScore", "Module", "AnalysisState"};
        for (String cat : required) {
            if (!allCategories.contains(cat)) {
                allCategories.add(cat);
            }
        }
        return allCategories;
    }
    
    /**
     * Reset per-program statistics for batch processing.
     */
    private void resetStatistics() {
        totalFunctions = 0;
        documentedFunctions = 0;
        namedFunctions = 0;
        functionsWithPlateComments = 0;
        functionsWithSignatures = 0;
        functionsWithParamNames = 0;
        functionsWithLocalVarNames = 0;
        functionsWithInlineComments = 0;
        documentationScore = 0.0;
        detectedSourceFiles.clear();
        functionSourceFiles.clear();
        functionsWithSourceFiles = 0;
    }
    
    /**
     * Print batch processing summary.
     */
    private void printBatchSummary() {
        println("");
        println("=".repeat(70));
        println("BATCH PROCESSING COMPLETE");
        println("=".repeat(70));
        println("");
        println("Total Programs: " + batchTotalPrograms);
        println("  Successful:   " + batchSuccessCount);
        println("  Skipped:      " + batchSkippedCount);
        println("  Failed:       " + batchFailedCount);
        println("");
        
        if (!batchSuccessList.isEmpty()) {
            println("Successfully Ingested:");
            for (String path : batchSuccessList) {
                println("  ✓ " + path);
            }
            println("");
        }
        
        if (!batchSkippedList.isEmpty()) {
            println("Skipped (already in database):");
            for (String path : batchSkippedList) {
                println("  - " + path);
            }
            println("");
        }
        
        if (!batchFailedList.isEmpty()) {
            println("Failed:");
            for (String path : batchFailedList) {
                println("  ✗ " + path);
            }
            println("");
        }
        
        // Print next steps
        println("NEXT STEPS:");
        println("-".repeat(70));
        println("");
        println("1. VERIFY DATABASE CONTENTS:");
        println("   - Run: psql -h " + DB_HOST + " -p " + DB_PORT + " -U " + DB_USERNAME + " -d " + DB_NAME);
        println("   - Query: SELECT name, md5, date_added FROM exetable ORDER BY date_added;");
        println("");
        println("2. QUERY FOR SIMILAR FUNCTIONS:");
        println("   - Open an UNDOCUMENTED program you want to analyze");
        println("   - Run 'QueryBSimForSimilarFunctionsScript.java'");
        println("");
        println("=".repeat(70));
    }
    
    /**
     * Version detection from an arbitrary path (for batch mode).
     */
    private String detectVersionFromPath(String path) {
        try {
            java.util.regex.Pattern versionPattern = 
                java.util.regex.Pattern.compile("\\b(\\d+\\.\\d+[a-z]?)\\b");
            java.util.regex.Matcher matcher = versionPattern.matcher(path);
            if (matcher.find()) {
                return matcher.group(1);
            }
        } catch (Exception e) {
            // Ignore
        }
        return null;
    }
    
    /**
     * Platform detection from an arbitrary path (for batch mode).
     */
    private String detectPlatformFromPath(String path) {
        String lowerPath = path.toLowerCase();
        if (lowerPath.contains("/lod/") || lowerPath.contains("\\lod\\")) {
            return "LoD";
        } else if (lowerPath.contains("/classic/") || lowerPath.contains("\\classic\\")) {
            return "Classic";
        } else if (lowerPath.contains("/pd2/") || lowerPath.contains("\\pd2\\")) {
            return "PD2";
        }
        return null;
    }
    
    /**
     * Module detection from a program name (for batch mode).
     */
    private String detectModuleFromName(String programName) {
        String name = programName.toLowerCase();
        if (name.endsWith(".dll") || name.endsWith(".exe")) {
            name = name.substring(0, name.length() - 4);
        }
        
        String[] knownModules = {
            "D2Client", "D2Game", "D2Common", "D2Net", "D2Lang", 
            "D2Win", "D2CMP", "D2Multi", "D2MCPClient", "D2Launch",
            "D2gfx", "D2Sound", "D2Direct3D", "D2DDraw", "D2Glide",
            "Fog", "Storm", "BNClient", "BNUpdate", "Game"
        };
        
        for (String module : knownModules) {
            if (name.equalsIgnoreCase(module)) {
                return module;
            }
        }
        return programName;
    }
    
    /**
     * Process a single program (used by both single mode and as entry point).
     */
    private void processSingleProgram(Program program) throws Exception {
        if (program.isChanged()) {
            printerr("ERROR: " + program.getName() + " has unsaved changes. Please save first.");
            return;
        }

        String programName = program.getName();
        String programPath = program.getDomainFile().getPathname();
        
        // Auto-detect version, platform, and module
        String version = AUTO_DETECT_VERSION ? detectVersionFromPath(programPath) : FALLBACK_VERSION;
        String platform = AUTO_DETECT_PLATFORM ? detectPlatformFromPath(programPath) : null;
        String module = AUTO_DETECT_MODULE ? detectModuleFromName(programName) : null;
        
        if (version == null) {
            if (FALLBACK_VERSION != null) {
                version = FALLBACK_VERSION;
            } else {
                printerr("ERROR: Could not auto-detect version from path.");
                printerr("Path: " + programPath);
                printerr("Set FALLBACK_VERSION in script configuration.");
                return;
            }
        }

        println("=".repeat(70));
        println("INGEST REFERENCE PROGRAM TO BSIM");
        println("=".repeat(70));
        println("");
        println("Program: " + programName);
        println("Version: " + version);
        if (platform != null) {
            println("Platform: " + platform);
        }
        if (module != null) {
            println("Module: " + module);
        }
        println("Analysis State: " + ANALYSIS_STATE);
        println("");
        println("Database: " + DB_HOST + ":" + DB_PORT + "/" + DB_NAME);
        println("");

        // Note: Documentation analysis is now done in calculateDocumentationScore() 
        // which is called after database connection is established

        if (namedFunctions > 0 && namedFunctions < 10) {
            Msg.warn(this, "Low documentation: only " + namedFunctions + " named functions.");
            println("WARNING: Low documentation coverage. Consider documenting more functions first.");
        }

        // Connect to BSim database
        BSimServerInfo serverInfo = new BSimServerInfo(DBType.postgres, DB_USERNAME, DB_HOST, DB_PORT, DB_NAME);

        try (FunctionDatabase pgDatabase = BSimClientFactory.buildClient(serverInfo, false)) {

            if (!pgDatabase.initialize()) {
                BSimError lastError = pgDatabase.getLastError();
                String errorMsg = lastError != null ? lastError.message : "Unknown error";
                throw new IOException("Failed to connect to database: " + errorMsg);
            }

            DatabaseInformation dbInfo = pgDatabase.getInfo();
            if (dbInfo == null) {
                throw new IOException("Failed to retrieve database information.");
            }

            println("Connected to BSim database: " + DB_NAME);

            // Calculate documentation score for current program
            documentationScore = calculateDocumentationScore();
            
            println("");
            println("Documentation Score: " + String.format("%.1f%%", documentationScore * 100));
            println("  (Based on function names, comments, parameters, and local variables)");

            // Check if program already exists in database
            String executableMd5 = currentProgram.getExecutableMD5();
            String executableName = currentProgram.getName();
            
            ExistingExecutableInfo existingInfo = checkExecutableWithScore(pgDatabase, executableMd5, executableName);
            
            if (existingInfo != null && existingInfo.exists) {
                println("");
                println("Found existing entry in database:");
                println("  Name: " + existingInfo.name);
                println("  MD5: " + existingInfo.md5);
                println("  Existing Score: " + String.format("%.1f%%", existingInfo.documentationScore * 100));
                println("  Current Score:  " + String.format("%.1f%%", documentationScore * 100));
                
                switch (DUPLICATE_STRATEGY) {
                    case SKIP:
                        println("");
                        println("=".repeat(70));
                        println("PROGRAM ALREADY EXISTS - SKIPPING (DUPLICATE_STRATEGY=SKIP)");
                        println("=".repeat(70));
                        println("To upgrade, set DUPLICATE_STRATEGY = DuplicateStrategy.UPGRADE");
                        return;
                        
                    case UPGRADE:
                        double improvement = documentationScore - existingInfo.documentationScore;
                        if (improvement >= MIN_SCORE_IMPROVEMENT) {
                            println("");
                            println("Documentation improved by " + String.format("%.1f%%", improvement * 100) + 
                                   " (threshold: " + String.format("%.1f%%", MIN_SCORE_IMPROVEMENT * 100) + ")");
                            println("Upgrading existing entry...");
                            deleteExecutable(pgDatabase, executableMd5, executableName);
                            println("  Existing entry deleted. Proceeding with upgraded ingestion.");
                        } else if (improvement > 0) {
                            println("");
                            println("=".repeat(70));
                            println("IMPROVEMENT TOO SMALL - SKIPPING");
                            println("=".repeat(70));
                            println("Improvement: " + String.format("%.1f%%", improvement * 100) + 
                                   " < threshold: " + String.format("%.1f%%", MIN_SCORE_IMPROVEMENT * 100));
                            println("Lower MIN_SCORE_IMPROVEMENT to allow smaller improvements.");
                            return;
                        } else {
                            println("");
                            println("=".repeat(70));
                            println("EXISTING VERSION HAS EQUAL OR BETTER DOCUMENTATION - SKIPPING");
                            println("=".repeat(70));
                            println("Current program does not improve documentation.");
                            println("Use DUPLICATE_STRATEGY=FORCE to replace anyway.");
                            return;
                        }
                        break;
                        
                    case FORCE:
                        println("");
                        println("FORCE mode: Deleting existing entry regardless of documentation score...");
                        deleteExecutable(pgDatabase, executableMd5, executableName);
                        println("  Existing entry deleted. Proceeding with fresh ingestion.");
                        break;
                        
                    case FAIL:
                    default:
                        throw new IOException("Program already exists in database (DUPLICATE_STRATEGY=FAIL). " +
                            "Use UPGRADE, SKIP, or FORCE strategy.");
                }
            }

            LSHVectorFactory vectorFactory = pgDatabase.getLSHVectorFactory();

            // ================================================================
            // DETECT SOURCE FILES FROM STRING REFERENCES
            // Must happen before setting categories so we can store the results
            // ================================================================
            if (DETECT_SOURCE_FILES) {
                println("");
                println("Detecting source file references...");
                detectSourceFilesInProgram();
                println("  Found " + functionsWithSourceFiles + " functions with source file references");
                println("  Unique source files: " + detectedSourceFiles.size());
                
                if (!detectedSourceFiles.isEmpty() && ANNOTATE_SOURCE_IN_COMMENT) {
                    println("  Annotating plate comments with source file info...");
                    annotateSourceFilesInComments();
                }
            }

            // ================================================================
            // SET EXECUTABLE CATEGORIES ON PROGRAM (Version, Platform, ReferenceLibrary)
            // These are stored as program properties that BSim reads during openProgram()
            // ================================================================
            println("");
            println("Setting executable categories on program...");
            
            int transactionId = currentProgram.startTransaction("Set BSim Categories");
            boolean success = false;
            try {
                Options programInfo = currentProgram.getOptions(Program.PROGRAM_INFO);
                
                // Set Version category (e.g., "1.09d", "1.13c")
                if (version != null) {
                    programInfo.setString("Version", version);
                    println("  Version = " + version);
                }
                
                // Set Platform category (e.g., "LoD", "Classic", "PD2")
                if (platform != null) {
                    programInfo.setString("Platform", platform);
                    println("  Platform = " + platform);
                }
                
                // Mark as a reference library (documented source for propagation)
                programInfo.setString("ReferenceLibrary", "true");
                println("  ReferenceLibrary = true");
                
                // Store documentation score for future comparisons
                programInfo.setString("DocScore", String.format("%.3f", documentationScore));
                println("  DocScore = " + String.format("%.1f%%", documentationScore * 100));
                
                // Set Module category (e.g., "D2Client", "D2Game", "D2Common")
                if (module != null) {
                    programInfo.setString("Module", module);
                    println("  Module = " + module);
                }
                
                // Set AnalysisState category (Initial, InProgress, Complete, Reviewed)
                programInfo.setString("AnalysisState", ANALYSIS_STATE);
                println("  AnalysisState = " + ANALYSIS_STATE);
                
                // Set Analyst if configured (for team workflows)
                if (ANALYST != null && !ANALYST.isEmpty()) {
                    programInfo.setString("Analyst", ANALYST);
                    println("  Analyst = " + ANALYST);
                }
                
                // Store source files count if detected
                if (!detectedSourceFiles.isEmpty()) {
                    programInfo.setString("SourceFilesCount", String.valueOf(detectedSourceFiles.size()));
                    println("  SourceFilesCount = " + detectedSourceFiles.size());
                    
                    // Store has-source-files flag for easy querying
                    programInfo.setString("HasSourceFiles", "true");
                    println("  HasSourceFiles = true");
                    
                    // Store all source file paths as comma-separated list
                    // Format paths to relative (from Source folder) for cleaner storage
                    List<String> formattedPaths = new ArrayList<>();
                    for (String srcFile : detectedSourceFiles) {
                        formattedPaths.add(formatSourcePath(srcFile));
                    }
                    Collections.sort(formattedPaths);
                    String sourceFilesList = String.join(",", formattedPaths);
                    programInfo.setString("SourceFiles", sourceFilesList);
                    println("  SourceFiles = " + (sourceFilesList.length() > 60 ? 
                        sourceFilesList.substring(0, 60) + "... (" + formattedPaths.size() + " files)" : 
                        sourceFilesList));
                }
                
                success = true;
            } finally {
                currentProgram.endTransaction(transactionId, success);
            }

            // Generate signatures
            println("");
            println("Generating BSim signatures...");
            
            // Use callgraph tracking from database settings, unless disabled by config
            boolean trackCallgraph = dbInfo.trackcallgraph && !DISABLE_CALLGRAPH_TRACKING;
            if (DISABLE_CALLGRAPH_TRACKING && dbInfo.trackcallgraph) {
                println("  Callgraph tracking DISABLED by config (to avoid duplicate key errors)");
            }
            
            GenSignatures gensig = new GenSignatures(trackCallgraph);
            gensig.setVectorFactory(vectorFactory);
            
            // Build category list: database categories + our custom categories
            List<String> allCategories = new ArrayList<>();
            if (dbInfo.execats != null) {
                allCategories.addAll(dbInfo.execats);
            }
            // Ensure our categories are registered (they should be from CreateProjectBSimDatabaseScript)
            if (!allCategories.contains("Version")) {
                allCategories.add("Version");
            }
            if (!allCategories.contains("Platform")) {
                allCategories.add("Platform");
            }
            if (!allCategories.contains("ReferenceLibrary")) {
                allCategories.add("ReferenceLibrary");
            }
            if (!allCategories.contains("DocScore")) {
                allCategories.add("DocScore");
            }
            if (!allCategories.contains("Module")) {
                allCategories.add("Module");
            }
            if (!allCategories.contains("AnalysisState")) {
                allCategories.add("AnalysisState");
            }
            if (!allCategories.contains("Analyst")) {
                allCategories.add("Analyst");
            }
            if (!allCategories.contains("HasSourceFiles")) {
                allCategories.add("HasSourceFiles");
            }
            if (!allCategories.contains("SourceFilesCount")) {
                allCategories.add("SourceFilesCount");
            }
            if (!allCategories.contains("SourceFiles")) {
                allCategories.add("SourceFiles");
            }
            
            gensig.addExecutableCategories(allCategories);
            gensig.addFunctionTags(dbInfo.functionTags);

            // Open program for signature generation (null params use defaults)
            gensig.openProgram(currentProgram, null, null, null, null, null);

            // Scan functions
            int scanned = 0;
            int tagged = 0;
            FunctionIterator funcIter = currentProgram.getFunctionManager().getFunctions(true);
            
            monitor.initialize(totalFunctions);
            
            while (funcIter.hasNext()) {
                if (monitor.isCancelled()) {
                    break;
                }

                Function func = funcIter.next();
                monitor.setProgress(scanned);
                monitor.setMessage("Scanning: " + func.getName());

                if (func.isExternal()) {
                    scanned++;
                    continue;
                }

                try {
                    gensig.scanFunction(func);
                    
                    if (TAG_DOCUMENTED_FUNCTIONS && isDocumentedFunction(func)) {
                        tagged++;
                    }

                    scanned++;
                } catch (Exception e) {
                    Msg.warn(this, "Error scanning " + func.getName() + ": " + e.getMessage());
                }
            }

            println("Scanned " + scanned + " functions");
            println("Documented functions: " + tagged);

            // Commit to database
            println("");
            println("Committing signatures to database...");
            
            DescriptionManager manager = gensig.getDescriptionManager();
            
            if (manager.numFunctions() == 0) {
                gensig.dispose();
                throw new IOException("No functions were scanned. Cannot commit.");
            }

            // DATABASE WIPE OPTION: If enabled, delete ALL executables in database
            // This is a nuclear option for when orphaned data prevents inserts
            if (WIPE_DATABASE_BEFORE_INSERT) {
                println("");
                println("!!! WIPE_DATABASE_BEFORE_INSERT is enabled !!!");
                println("  Deleting ALL executables from database...");
                wipeAllExecutables(pgDatabase);
                println("  Database wiped. Proceeding with fresh insert.");
            }

            // SAFETY: Always attempt delete before insert to handle orphaned data
            // This catches cases where a previous insert partially failed, leaving
            // orphaned callgraph entries that weren't cleaned up
            println("  Performing safety cleanup before insert...");
            try {
                safetyDeleteBeforeInsert(pgDatabase, executableMd5, executableName);
            } catch (Exception e) {
                println("  Safety cleanup note: " + e.getMessage());
                // Continue anyway - the insert will fail if there's truly conflicting data
            }

            InsertRequest insertReq = new InsertRequest();
            insertReq.repo_override = null;
            insertReq.manage = manager;

            ResponseInsert insertResponse = insertReq.execute(pgDatabase);
            
            if (insertResponse == null) {
                BSimError lastError = pgDatabase.getLastError();
                String errorMsg = lastError != null ? lastError.message : "Unknown error";
                throw new IOException("Failed to insert signatures: " + errorMsg);
            }

            gensig.dispose();

            // Print summary
            println("");
            println("=".repeat(70));
            println("REFERENCE PROGRAM INGESTED SUCCESSFULLY");
            println("=".repeat(70));
            println("");
            println("Program: " + programName);
            println("Version: " + (version != null ? version : "not set"));
            println("Platform: " + (platform != null ? platform : "not set"));
            println("");
            println("BSim Categories Stored:");
            println("  - Version: " + (version != null ? version : "(none)"));
            println("  - Platform: " + (platform != null ? platform : "(none)"));
            println("  - Module: " + (module != null ? module : "(none)"));
            println("  - AnalysisState: " + ANALYSIS_STATE);
            if (ANALYST != null) println("  - Analyst: " + ANALYST);
            println("  - ReferenceLibrary: true");
            println("  - DocScore: " + String.format("%.1f%%", documentationScore * 100));
            if (!detectedSourceFiles.isEmpty()) {
                println("  - HasSourceFiles: true");
                println("  - SourceFilesCount: " + detectedSourceFiles.size());
            }
            println("");
            println("Functions:");
            println("  - Total Scanned: " + scanned);
            println("  - Documented (tagged): " + tagged);
            println("  - With Custom Names: " + namedFunctions);
            println("  - With Plate Comments: " + functionsWithPlateComments);
            println("  - With Custom Parameters: " + functionsWithParamNames);
            println("  - With Named Locals: " + functionsWithLocalVarNames);
            println("  - With Inline Comments: " + functionsWithInlineComments);
            println("  - With Source File Refs: " + functionsWithSourceFiles);
            println("");
            if (!detectedSourceFiles.isEmpty()) {
                println("Source Files Detected (" + detectedSourceFiles.size() + "):");
                List<String> sortedFiles = new ArrayList<>(detectedSourceFiles);
                Collections.sort(sortedFiles);
                for (String srcFile : sortedFiles) {
                    // Show just the relative path from Source folder
                    int sourceIdx = srcFile.toLowerCase().indexOf("\\source\\");
                    String displayPath = sourceIdx >= 0 ? srcFile.substring(sourceIdx + 8) : srcFile;
                    println("  - " + displayPath);
                }
                println("");
            }
            println("=".repeat(70));
            
            // Print next steps
            println("");
            println("NEXT STEPS:");
            println("-".repeat(70));
            println("");
            println("1. INGEST MORE REFERENCE PROGRAMS (repeat for each version):");
            println("   - Open another documented program (e.g., D2Client.dll from 1.10)");
            println("   - Run this script again to add it to the BSim database");
            println("   - Each version builds your cross-version reference library");
            println("");
            println("2. QUERY FOR SIMILAR FUNCTIONS:");
            println("   - Open an UNDOCUMENTED program you want to analyze");
            println("   - Run 'QueryBSimForSimilarFunctionsScript.java'");
            println("   - BSim will find matching functions from your reference library");
            println("");
            println("3. PROPAGATE NAMES TO UNKNOWN FUNCTIONS:");
            println("   - After querying, run 'PropagateFunctionNamesWithReportScript.java'");
            println("   - This copies names/signatures from matched reference functions");
            println("   - Review the report to verify matches before accepting");
            println("");
            println("4. VERIFY DATABASE CONTENTS:");
            println("   - Run: psql -h " + DB_HOST + " -p " + DB_PORT + " -U " + DB_USERNAME + " -d " + DB_NAME);
            println("   - Query: SELECT name, md5, date_added FROM exetable;");
            println("   - Query: SELECT COUNT(*) FROM desctable;  -- function count");
            println("");
            println("=".repeat(70));
        }
    }

    /**
     * @deprecated Use calculateDocumentationScore() instead.
     * This method is kept for backwards compatibility but does nothing.
     */
    @Deprecated
    private void analyzeProgramDocumentation() {
        // Documentation analysis is now performed by calculateDocumentationScore()
        // which provides a weighted score and populates all statistics fields
    }

    private boolean isDocumentedFunction(Function func) {
        if (func.isExternal() || func.isThunk()) {
            return false;
        }
        if (!isDefaultName(func.getName())) {
            return true;
        }
        if (func.getComment() != null && !func.getComment().isEmpty()) {
            return true;
        }
        if (func.getRepeatableComment() != null && !func.getRepeatableComment().isEmpty()) {
            return true;
        }
        return false;
    }

    private boolean isDefaultName(String name) {
        return name.startsWith("FUN_") ||
               name.startsWith("thunk_FUN_") ||
               name.startsWith("switchD_") ||
               name.startsWith("caseD_") ||
               name.matches("^[A-Za-z]+_[0-9a-fA-F]+$");
    }

    private boolean hasCustomSignature(Function func) {
        for (Parameter param : func.getParameters()) {
            String name = param.getName();
            if (name != null && !name.matches("param_\\d+") && !name.isEmpty()) {
                return true;
            }
        }
        String returnTypeName = func.getReturnType().getName();
        if (!returnTypeName.equals("undefined") && !returnTypeName.equals("void")) {
            return true;
        }
        return false;
    }
    
    /**
     * Helper class to store information about an existing executable in the database.
     */
    private static class ExistingExecutableInfo {
        boolean exists = false;
        String name = null;
        String md5 = null;
        double documentationScore = 0.0;  // Stored in BSim optional values or estimated
    }
    
    /**
     * Calculates a comprehensive documentation score for the current program.
     * 
     * Score components (weighted):
     *   - Named functions (not FUN_*): 30%
     *   - Functions with plate comments: 20%
     *   - Functions with custom parameters: 25%
     *   - Functions with named local variables: 15%
     *   - Functions with inline/EOL comments: 10%
     * 
     * @return A score between 0.0 (no documentation) and 1.0 (fully documented)
     */
    private double calculateDocumentationScore() {
        int totalNonExternal = 0;
        int withNames = 0;
        int withPlateComments = 0;
        int withCustomParams = 0;
        int withLocalVars = 0;
        int withInlineComments = 0;
        
        FunctionIterator funcIter = currentProgram.getFunctionManager().getFunctions(true);
        
        while (funcIter.hasNext()) {
            Function func = funcIter.next();
            
            if (func.isExternal() || func.isThunk()) {
                continue;
            }
            
            totalNonExternal++;
            
            // Check for custom name
            if (!isDefaultName(func.getName())) {
                withNames++;
                namedFunctions++;
            }
            
            // Check for plate comment
            if (func.getComment() != null && !func.getComment().trim().isEmpty()) {
                withPlateComments++;
                functionsWithPlateComments++;
            }
            
            // Check for custom parameter names
            boolean hasCustomParams = false;
            for (Parameter param : func.getParameters()) {
                String pname = param.getName();
                if (pname != null && !pname.matches("param_\\d+") && !pname.isEmpty()) {
                    hasCustomParams = true;
                    break;
                }
            }
            if (hasCustomParams) {
                withCustomParams++;
                functionsWithParamNames++;
            }
            
            // Check for named local variables
            boolean hasNamedLocals = false;
            for (Variable var : func.getLocalVariables()) {
                String vname = var.getName();
                if (vname != null && !vname.matches("local_[0-9a-fA-Fxh]+") && 
                    !vname.matches("Stack\\[.*\\]") && !vname.startsWith("uStack") &&
                    !vname.startsWith("iStack") && !vname.startsWith("puStack")) {
                    hasNamedLocals = true;
                    break;
                }
            }
            if (hasNamedLocals) {
                withLocalVars++;
                functionsWithLocalVarNames++;
            }
            
            // Check for inline/EOL comments (via listing comments at function addresses)
            boolean hasInlineComments = false;
            ghidra.program.model.listing.Listing listing = currentProgram.getListing();
            ghidra.program.model.address.AddressSetView funcBody = func.getBody();
            ghidra.program.model.address.AddressIterator addrIter = funcBody.getAddresses(true);
            int addrCount = 0;
            while (addrIter.hasNext() && addrCount < 100) {  // Sample first 100 addresses
                ghidra.program.model.address.Address addr = addrIter.next();
                ghidra.program.model.listing.CodeUnit cu = listing.getCodeUnitAt(addr);
                if (cu != null) {
                    String eolComment = cu.getComment(ghidra.program.model.listing.CommentType.EOL);
                    String preComment = cu.getComment(ghidra.program.model.listing.CommentType.PRE);
                    if ((eolComment != null && !eolComment.isEmpty()) || 
                        (preComment != null && !preComment.isEmpty())) {
                        hasInlineComments = true;
                        break;
                    }
                }
                addrCount++;
            }
            if (hasInlineComments) {
                withInlineComments++;
                functionsWithInlineComments++;
            }
        }
        
        if (totalNonExternal == 0) {
            return 0.0;
        }
        
        // Weighted score calculation
        double nameScore = (double) withNames / totalNonExternal * 0.30;
        double plateScore = (double) withPlateComments / totalNonExternal * 0.20;
        double paramScore = (double) withCustomParams / totalNonExternal * 0.25;
        double localScore = (double) withLocalVars / totalNonExternal * 0.15;
        double inlineScore = (double) withInlineComments / totalNonExternal * 0.10;
        
        totalFunctions = totalNonExternal;
        documentedFunctions = withNames;  // Approximate
        
        return nameScore + plateScore + paramScore + localScore + inlineScore;
    }
    
    /**
     * Checks if an executable exists and retrieves its documentation score from BSim.
     * 
     * Note: BSim doesn't natively store documentation scores, so we estimate based on
     * the percentage of functions with non-default names (which BSim does store).
     * 
     * @param database The BSim database connection
     * @param md5 The MD5 hash of the executable
     * @param name The name of the executable
     * @return ExistingExecutableInfo with exists=true if found, or exists=false if not
     */
    private ExistingExecutableInfo checkExecutableWithScore(FunctionDatabase database, String md5, String name) {
        ExistingExecutableInfo info = new ExistingExecutableInfo();
        
        try {
            // Query database for existing executable by MD5
            QueryExeInfo query = new QueryExeInfo();
            query.filterMd5 = md5;
            query.fillinCategories = true;  // Include category info
            
            ResponseExe response = query.execute(database);
            
            // Check both recordCount AND records list (recordCount may not always be set)
            if (response != null && (response.recordCount > 0 || (response.records != null && !response.records.isEmpty()))) {
                info.exists = true;
                info.md5 = md5;
                info.name = name;
                
                // Estimate documentation score from function names in BSim
                // BSim stores function names, so we can count non-FUN_* names
                int totalFuncs = 0;
                int namedFuncs = 0;
                
                if (response.manage != null) {
                    Iterator<ExecutableRecord> exeIter = response.manage.getExecutableRecordSet().iterator();
                    while (exeIter.hasNext()) {
                        ExecutableRecord exeRec = exeIter.next();
                        Iterator<FunctionDescription> funcIter = response.manage.listFunctions(exeRec);
                        while (funcIter.hasNext()) {
                            FunctionDescription funcDesc = funcIter.next();
                            totalFuncs++;
                            String funcName = funcDesc.getFunctionName();
                            if (funcName != null && !isDefaultName(funcName)) {
                                namedFuncs++;
                            }
                        }
                    }
                }
                
                // Estimate score based on naming ratio (BSim only stores names, not comments/params)
                // This is an underestimate since we can't see comments/local vars from BSim
                if (totalFuncs > 0) {
                    info.documentationScore = (double) namedFuncs / totalFuncs * 0.5;  // Cap at 50% since we can't measure other factors
                }
                
                return info;
            }
            
            // Also try by name as fallback
            QueryExeInfo nameQuery = new QueryExeInfo();
            nameQuery.filterExeName = name;
            
            ResponseExe nameResponse = nameQuery.execute(database);
            
            // Check both recordCount AND records list
            if (nameResponse != null && (nameResponse.recordCount > 0 || (nameResponse.records != null && !nameResponse.records.isEmpty()))) {
                info.exists = true;
                info.name = name;
                info.md5 = "(unknown - matched by name)";
                info.documentationScore = 0.0;  // Can't estimate without full query
                return info;
            }
            
            return info;  // exists = false
        } catch (Exception e) {
            Msg.warn(this, "Could not check for existing executable: " + e.getMessage());
            return info;  // exists = false, let insert fail if it does
        }
    }
    
    /**
     * Deletes an existing executable from the BSim database.
     * 
     * @param database The BSim database connection
     * @param md5 The MD5 hash of the executable
     * @param name The name of the executable
     * @throws IOException if deletion fails
     */
    private void deleteExecutable(FunctionDatabase database, String md5, String name) throws IOException {
        try {
            // First, try to delete by MD5 only (most reliable)
            QueryDelete deleteReq = new QueryDelete();
            ExeSpecifier spec = new ExeSpecifier();
            spec.exemd5 = md5;
            // Don't set exename - MD5 alone should be sufficient and unique
            deleteReq.addSpecifier(spec);
            
            println("  Attempting delete by MD5: " + md5);
            ResponseDelete response = deleteReq.execute(database);
            
            if (response == null) {
                BSimError lastError = database.getLastError();
                String errorMsg = lastError != null ? lastError.message : "Unknown error";
                throw new IOException("Failed to delete existing executable: " + errorMsg);
            }
            
            // If MD5 delete didn't find anything, try by name
            if (response.reslist.isEmpty() && name != null && !name.isEmpty()) {
                println("  MD5 delete found nothing, trying by name: " + name);
                QueryDelete nameDeleteReq = new QueryDelete();
                ExeSpecifier nameSpec = new ExeSpecifier();
                nameSpec.exename = name;
                // Don't set MD5, try name alone
                nameDeleteReq.addSpecifier(nameSpec);
                
                response = nameDeleteReq.execute(database);
                
                if (response == null) {
                    BSimError lastError = database.getLastError();
                    String errorMsg = lastError != null ? lastError.message : "Unknown error";
                    throw new IOException("Failed to delete by name: " + errorMsg);
                }
            }
            
            // Check if deletion actually succeeded - reslist contains DeleteResult entries
            int totalDeleted = 0;
            for (ghidra.features.bsim.query.protocol.ResponseDelete.DeleteResult delResult : response.reslist) {
                totalDeleted += delResult.funccount;
                println("  Deleted: " + delResult.name + " (" + delResult.funccount + " functions) MD5: " + delResult.md5);
            }
            if (response.reslist.isEmpty() && !response.missedlist.isEmpty()) {
                // Delete failed - entry couldn't be found with the given specifier
                // This is a critical error since we already confirmed the entry exists
                StringBuilder missedInfo = new StringBuilder();
                for (ExeSpecifier missed : response.missedlist) {
                    missedInfo.append("\n    - MD5: ").append(missed.exemd5)
                              .append(", Name: ").append(missed.exename);
                }
                throw new IOException("Delete failed - could not find executable to delete. " +
                    "Missed " + response.missedlist.size() + " specifier(s):" + missedInfo.toString() +
                    "\nThe entry may exist with different MD5/name. Check database manually.");
            } else if (response.reslist.isEmpty()) {
                // This shouldn't happen if we already confirmed entry exists
                throw new IOException("Delete returned success but deleted 0 records. " +
                    "The existing entry was not removed. Manual database cleanup may be required.");
            } else {
                println("  Successfully deleted " + response.reslist.size() + " executable(s) with " + totalDeleted + " function(s).");
            }
        } catch (IOException e) {
            throw e;  // Re-throw IOException
        } catch (Exception e) {
            throw new IOException("Error deleting executable: " + e.getMessage(), e);
        }
    }
    
    /**
     * Safety delete before insert - attempts to clean up any orphaned data.
     * This is a silent operation that doesn't throw if nothing is found.
     * It handles cases where previous inserts partially failed leaving orphaned callgraph entries.
     *
     * @param database The BSim database connection
     * @param md5 The MD5 hash of the executable
     * @param name The name of the executable
     */
    private void safetyDeleteBeforeInsert(FunctionDatabase database, String md5, String name) {
        try {
            // Try delete by MD5
            QueryDelete deleteReq = new QueryDelete();
            ExeSpecifier spec = new ExeSpecifier();
            spec.exemd5 = md5;
            deleteReq.addSpecifier(spec);
            
            ResponseDelete response = deleteReq.execute(database);
            
            if (response != null && !response.reslist.isEmpty()) {
                int totalDeleted = 0;
                for (ghidra.features.bsim.query.protocol.ResponseDelete.DeleteResult delResult : response.reslist) {
                    totalDeleted += delResult.funccount;
                }
                println("  Safety cleanup removed " + response.reslist.size() + " executable(s) with " + totalDeleted + " function(s)");
                return;
            }
            
            // Also try by name if MD5 found nothing
            if (name != null && !name.isEmpty()) {
                QueryDelete nameDeleteReq = new QueryDelete();
                ExeSpecifier nameSpec = new ExeSpecifier();
                nameSpec.exename = name;
                nameDeleteReq.addSpecifier(nameSpec);
                
                ResponseDelete nameResponse = nameDeleteReq.execute(database);
                
                if (nameResponse != null && !nameResponse.reslist.isEmpty()) {
                    int totalDeleted = 0;
                    for (ghidra.features.bsim.query.protocol.ResponseDelete.DeleteResult delResult : nameResponse.reslist) {
                        totalDeleted += delResult.funccount;
                    }
                    println("  Safety cleanup (by name) removed " + nameResponse.reslist.size() + " executable(s) with " + totalDeleted + " function(s)");
                    return;
                }
            }
            
            println("  No existing data found to clean up.");
        } catch (Exception e) {
            // Log but don't fail - this is best-effort cleanup
            println("  Safety cleanup warning: " + e.getMessage());
        }
    }
    
    /**
     * Nuclear option: Delete ALL executables from the database.
     * Use this when orphaned callgraph data prevents normal inserts.
     * 
     * @param database The BSim database connection
     * @throws IOException if the wipe fails
     */
    private void wipeAllExecutables(FunctionDatabase database) throws IOException {
        try {
            // Query all executables in the database
            QueryExeInfo queryAll = new QueryExeInfo();
            // No filters = get all
            queryAll.fillinCategories = false;
            
            ResponseExe response = queryAll.execute(database);
            
            if (response == null || (response.records == null || response.records.isEmpty())) {
                println("  Database appears empty, nothing to wipe.");
                return;
            }
            
            println("  Found " + response.records.size() + " executable(s) to delete...");
            
            // Delete each executable
            int deleted = 0;
            for (ExecutableRecord exeRec : response.records) {
                try {
                    QueryDelete deleteReq = new QueryDelete();
                    ExeSpecifier spec = new ExeSpecifier();
                    spec.exemd5 = exeRec.getMd5();
                    spec.exename = exeRec.getNameExec();
                    deleteReq.addSpecifier(spec);
                    
                    ResponseDelete delResponse = deleteReq.execute(database);
                    
                    if (delResponse != null && !delResponse.reslist.isEmpty()) {
                        deleted++;
                        for (ghidra.features.bsim.query.protocol.ResponseDelete.DeleteResult delResult : delResponse.reslist) {
                            println("    Deleted: " + delResult.name + " (" + delResult.funccount + " functions)");
                        }
                    }
                } catch (Exception e) {
                    println("    Warning: Failed to delete " + exeRec.getNameExec() + ": " + e.getMessage());
                }
            }
            
            println("  Wiped " + deleted + " executable(s).");
            
        } catch (Exception e) {
            throw new IOException("Failed to wipe database: " + e.getMessage(), e);
        }
    }
    
    // ========================================================================
    // SOURCE FILE DETECTION
    // ========================================================================
    
    // Pattern to match D2 source file paths like:
    // C:\Projects\D2106\Source\D2Game\Ai\AiGeneral.cpp
    // C:\projects\D2\Source\D2Client\UI\Chat.cpp
    private static final Pattern SOURCE_FILE_PATTERN = Pattern.compile(
        "[A-Za-z]:\\\\[^\"\\\\]*\\\\Source\\\\[^\"]+\\.(?:cpp|c|h|hpp)",
        Pattern.CASE_INSENSITIVE
    );
    
    /**
     * Scans all functions in the program for string references that contain
     * source file paths (from __FILE__ macros in the original code).
     */
    private void detectSourceFilesInProgram() {
        FunctionIterator funcIter = currentProgram.getFunctionManager().getFunctions(true);
        ghidra.program.model.listing.Listing listing = currentProgram.getListing();
        
        while (funcIter.hasNext()) {
            if (monitor.isCancelled()) break;
            
            Function func = funcIter.next();
            if (func.isExternal() || func.isThunk()) continue;
            
            String sourceFile = findSourceFileForFunction(func, listing);
            if (sourceFile != null) {
                functionSourceFiles.put(func, sourceFile);
                detectedSourceFiles.add(sourceFile);
                functionsWithSourceFiles++;
            }
        }
    }
    
    /**
     * Finds a source file path referenced by a function by examining string
     * references within the function body.
     */
    private String findSourceFileForFunction(Function func, ghidra.program.model.listing.Listing listing) {
        ghidra.program.model.address.AddressSetView body = func.getBody();
        
        // Iterate through instructions in the function
        ghidra.program.model.listing.InstructionIterator instIter = listing.getInstructions(body, true);
        
        while (instIter.hasNext()) {
            ghidra.program.model.listing.Instruction inst = instIter.next();
            
            // Check references from this instruction
            ghidra.program.model.symbol.Reference[] refs = inst.getReferencesFrom();
            for (ghidra.program.model.symbol.Reference ref : refs) {
                ghidra.program.model.address.Address toAddr = ref.getToAddress();
                
                // Check if this address points to a string
                ghidra.program.model.listing.Data data = listing.getDataAt(toAddr);
                if (data != null && data.hasStringValue()) {
                    String strValue = (String) data.getValue();
                    if (strValue != null) {
                        Matcher matcher = SOURCE_FILE_PATTERN.matcher(strValue);
                        if (matcher.find()) {
                            return matcher.group();  // Return the matched path
                        }
                    }
                }
            }
        }
        
        return null;
    }
    
    /**
     * Annotates functions with their detected source file in the plate comment.
     * Only modifies functions that have a detected source file.
     */
    private void annotateSourceFilesInComments() {
        if (functionSourceFiles.isEmpty()) return;
        
        int transactionId = currentProgram.startTransaction("Annotate Source Files");
        boolean success = false;
        try {
            int annotated = 0;
            for (Map.Entry<Function, String> entry : functionSourceFiles.entrySet()) {
                Function func = entry.getKey();
                String sourceFile = entry.getValue();
                
                // Extract just the filename and relative path for cleaner comments
                String displayPath = formatSourcePath(sourceFile);
                
                String existingComment = func.getComment();
                String sourceTag = "@source " + displayPath;
                
                // Don't duplicate if already present
                if (existingComment != null && existingComment.contains("@source")) {
                    continue;
                }
                
                // Prepend source info to plate comment
                String newComment;
                if (existingComment == null || existingComment.isEmpty()) {
                    newComment = sourceTag;
                } else {
                    newComment = sourceTag + "\n\n" + existingComment;
                }
                
                func.setComment(newComment);
                annotated++;
            }
            
            println("  Annotated " + annotated + " functions with source file info");
            success = true;
        } catch (Exception e) {
            Msg.warn(this, "Error annotating source files: " + e.getMessage());
        } finally {
            currentProgram.endTransaction(transactionId, success);
        }
    }
    
    /**
     * Formats a full source path to a more readable relative path.
     * Example: C:\Projects\D2106\Source\D2Game\Ai\AiGeneral.cpp -> D2Game\Ai\AiGeneral.cpp
     */
    private String formatSourcePath(String fullPath) {
        // Find \Source\ and return everything after it
        int sourceIdx = fullPath.toLowerCase().indexOf("\\source\\");
        if (sourceIdx >= 0) {
            return fullPath.substring(sourceIdx + 8);  // Skip "\Source\"
        }
        
        // Fallback: just return the filename
        int lastSlash = fullPath.lastIndexOf('\\');
        if (lastSlash >= 0) {
            return fullPath.substring(lastSlash + 1);
        }
        
        return fullPath;
    }
}
