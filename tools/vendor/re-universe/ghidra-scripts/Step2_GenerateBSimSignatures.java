// Enhanced signature generation now happens INLINE during Step1 as each function
// is processed. This eliminates the need for a separate pass through all functions.
//
// WHAT THIS SCRIPT DID:
// - Analyzed function control flow and instruction patterns
// - Created structural signatures for similarity matching
// - Stored enhanced signatures in BSim database
//
// WHY IT'S DEPRECATED:
// - Step1 now generates enhanced signatures immediately when each function is added
// - No need to re-open programs and iterate through functions a second time
// - More efficient: single pass instead of two passes
//
// IF YOU RUN THIS SCRIPT:
// - It will report that all functions already have signatures (because Step1 did it)
// - Safe to run - it's idempotent and will just skip already-processed functions
// - Consider deleting this script once you've verified Step1 works correctly
//
// @author Ben Ethington
// @category Diablo 2
// @keybinding ctrl shift L

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.framework.model.*;
import java.sql.*;
import java.util.*;

public class Step2_GenerateBSimSignatures extends GhidraScript {

    // Resolved credentials (loaded from db.env)
    private String dbUrl;
    private String dbUser;
    private String dbPass;
    
    // Statistics
    private int totalProcessed = 0;
    private int totalSkipped = 0;
    private int totalErrors = 0;

    private void loadDbConfig() throws Exception {
        String host = "localhost";
        String port = "5432";
        String dbName = "bsim";
        dbUser = "bsim_user";
        dbPass = "";

        String scriptDir = getSourceFile().getParentFile().getAbsolutePath();
        java.io.File envFile = new java.io.File(scriptDir, "db.env");

        if (envFile.exists()) {
            println("Loading database config from db.env");
            try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.FileReader(envFile))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    line = line.trim();
                    if (line.isEmpty() || line.startsWith("#")) continue;
                    int eq = line.indexOf('=');
                    if (eq <= 0) continue;
                    String key = line.substring(0, eq).trim();
                    String value = line.substring(eq + 1).trim();
                    switch (key) {
                        case "BSIM_DB_HOST": host = value; break;
                        case "BSIM_DB_PORT": port = value; break;
                        case "BSIM_DB_NAME": dbName = value; break;
                        case "BSIM_DB_USER": dbUser = value; break;
                        case "BSIM_DB_PASSWORD": dbPass = value; break;
                    }
                }
            }
        } else {
            throw new Exception("ERROR: db.env not found at " + envFile.getAbsolutePath() +
                ". Create this file with BSIM_DB_HOST, BSIM_DB_PORT, BSIM_DB_NAME, BSIM_DB_USER, BSIM_DB_PASSWORD.");
        }

        dbUrl = "jdbc:postgresql://" + host + ":" + port + "/" + dbName;
        println("Database: " + dbUrl + " (user: " + dbUser + ")");
    }

    @Override
    public void run() throws Exception {
        println("=== Enhanced BSim Signature Generation (Idempotent) ===");
        println("");

        // Load database credentials from db.env
        loadDbConfig();

        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPass)) {
            println("Connected to BSim database");

            // Check if enhanced_signatures table exists
            if (!checkEnhancedSignaturesTable(conn)) {
                popup("Enhanced signatures table not found in database.\n" +
                      "Please ensure the BSim schema extension is installed.");
                return;
            }

            // Get statistics on what needs processing
            int[] stats = getProcessingStats(conn);
            int totalFunctions = stats[0];
            int withSignatures = stats[1];
            int needsProcessing = totalFunctions - withSignatures;

            println(String.format("Database Status:"));
            println(String.format("  Total functions: %,d", totalFunctions));
            println(String.format("  Already have signatures: %,d (%.1f%%)", 
                withSignatures, (100.0 * withSignatures / totalFunctions)));
            println(String.format("  Need signatures: %,d (%.1f%%)", 
                needsProcessing, (100.0 * needsProcessing / totalFunctions)));
            println("");

            if (needsProcessing == 0) {
                println("✓ All functions already have signatures. Nothing to do.");
                popup("All functions already have signatures!\n\n" +
                      String.format("Total: %,d functions with signatures.", withSignatures));
                return;
            }

            // Get list of executables that have unprocessed functions
            List<ExecutableInfo> execsToProcess = getExecutablesNeedingSignatures(conn);
            
            if (execsToProcess.isEmpty()) {
                println("No executables found with unprocessed functions.");
                return;
            }

            println(String.format("Found %d executables with unprocessed functions:", execsToProcess.size()));
            for (ExecutableInfo exec : execsToProcess) {
                println(String.format("  - %s: %,d functions need signatures", exec.name, exec.unprocessedCount));
            }
            println("");

            // Ask for confirmation
            boolean proceed = askYesNo("Generate Missing Signatures",
                String.format("Generate signatures for %,d unprocessed functions across %d executables?\n\n" +
                    "This will:\n" +
                    "- Open each executable from the Ghidra project\n" +
                    "- Generate structural signatures for functions without them\n" +
                    "- Store signatures in BSim database\n\n" +
                    "Already processed functions will be skipped.\n\nProceed?",
                    needsProcessing, execsToProcess.size()));

            if (!proceed) {
                println("Operation cancelled by user");
                return;
            }

            // Process each executable
            Project project = state.getProject();
            if (project == null) {
                popup("No project is currently open.");
                return;
            }

            ProjectData projectData = project.getProjectData();
            DomainFolder rootFolder = projectData.getRootFolder();

            // Build map of project files
            Map<String, DomainFile> projectFiles = new HashMap<>();
            collectProgramFiles(rootFolder, projectFiles);

            println(String.format("Found %d program files in Ghidra project", projectFiles.size()));
            println("");

            int execsProcessed = 0;
            int execsSkipped = 0;

            for (int i = 0; i < execsToProcess.size(); i++) {
                ExecutableInfo execInfo = execsToProcess.get(i);
                
                if (monitor.isCancelled()) {
                    println("Operation cancelled by user");
                    break;
                }

                monitor.setMessage(String.format("Processing %d/%d: %s", 
                    i + 1, execsToProcess.size(), execInfo.name));
                monitor.setProgress(i * 100 / execsToProcess.size());

                // Find matching file in project
                DomainFile matchingFile = findMatchingFile(projectFiles, execInfo.name);
                
                if (matchingFile == null) {
                    println(String.format("⚠ Could not find '%s' in Ghidra project - skipping", execInfo.name));
                    execsSkipped++;
                    continue;
                }

                try {
                    processExecutable(conn, matchingFile, execInfo);
                    execsProcessed++;
                } catch (Exception e) {
                    printerr(String.format("Error processing %s: %s", execInfo.name, e.getMessage()));
                    totalErrors++;
                }
            }

            // Final summary
            println("");
            println("=== Processing Complete ===");
            println(String.format("Executables processed: %d", execsProcessed));
            println(String.format("Executables skipped (not in project): %d", execsSkipped));
            println(String.format("Functions with new signatures: %,d", totalProcessed));
            println(String.format("Functions skipped (already had signatures): %,d", totalSkipped));
            println(String.format("Errors: %d", totalErrors));

            // Refresh materialized views
            refreshMaterializedViews(conn);

        } catch (SQLException e) {
            printerr("Database error: " + e.getMessage());
            e.printStackTrace();
            throw e;
        }
    }

    /**
     * Get count of total functions and functions with signatures
     */
    private int[] getProcessingStats(Connection conn) throws SQLException {
        String sql = """
            SELECT 
                (SELECT COUNT(*) FROM desctable) as total,
                (SELECT COUNT(*) FROM enhanced_signatures) as with_sigs
            """;
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            if (rs.next()) {
                return new int[] { rs.getInt("total"), rs.getInt("with_sigs") };
            }
        }
        return new int[] { 0, 0 };
    }

    /**
     * Get list of executables that have functions without signatures
     */
    private List<ExecutableInfo> getExecutablesNeedingSignatures(Connection conn) throws SQLException {
        List<ExecutableInfo> result = new ArrayList<>();
        
        String sql = """
            SELECT e.id, e.name_exec, 
                   COUNT(d.id) as total_functions,
                   COUNT(d.id) - COUNT(es.id) as unprocessed_count
            FROM exetable e
            JOIN desctable d ON d.id_exe = e.id
            LEFT JOIN enhanced_signatures es ON es.function_id = d.id
            GROUP BY e.id, e.name_exec
            HAVING COUNT(d.id) - COUNT(es.id) > 0
            ORDER BY unprocessed_count DESC
            """;
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            while (rs.next()) {
                ExecutableInfo info = new ExecutableInfo();
                info.id = rs.getInt("id");
                info.name = rs.getString("name_exec");
                info.totalFunctions = rs.getInt("total_functions");
                info.unprocessedCount = rs.getInt("unprocessed_count");
                result.add(info);
            }
        }
        
        return result;
    }

    /**
     * Get list of function IDs that don't have signatures yet for this executable
     */
    private List<FunctionToProcess> getFunctionsNeedingSignatures(Connection conn, int executableId) throws SQLException {
        List<FunctionToProcess> result = new ArrayList<>();
        
        String sql = """
            SELECT d.id, d.name_func, d.addr
            FROM desctable d
            LEFT JOIN enhanced_signatures es ON es.function_id = d.id
            WHERE d.id_exe = ? AND es.id IS NULL
            ORDER BY d.addr
            """;
        
        try (PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setInt(1, executableId);
            ResultSet rs = stmt.executeQuery();
            while (rs.next()) {
                FunctionToProcess func = new FunctionToProcess();
                func.id = rs.getInt("id");
                func.name = rs.getString("name_func");
                func.address = rs.getLong("addr");
                result.add(func);
            }
        }
        
        return result;
    }

    /**
     * Process a single executable - generate signatures for unprocessed functions
     */
    private void processExecutable(Connection conn, DomainFile file, ExecutableInfo execInfo) throws Exception {
        println(String.format("Processing: %s (%,d functions need signatures)", 
            execInfo.name, execInfo.unprocessedCount));

        // Get list of functions needing signatures
        List<FunctionToProcess> functionsToProcess = getFunctionsNeedingSignatures(conn, execInfo.id);
        
        if (functionsToProcess.isEmpty()) {
            println("  All functions already have signatures - skipping");
            return;
        }

        // Build lookup map by address
        Map<Long, FunctionToProcess> addressMap = new HashMap<>();
        for (FunctionToProcess func : functionsToProcess) {
            addressMap.put(func.address, func);
        }

        // Open the program
        Program program = (Program) file.getDomainObject(this, true, false, monitor);
        
        try {
            FunctionManager funcManager = program.getFunctionManager();
            
            String insertSql = """
                INSERT INTO enhanced_signatures 
                    (function_id, executable_id, signature_hash, signature_data, lsh_vector, confidence_score)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (function_id) DO NOTHING
                """;
            
            int processed = 0;
            int skipped = 0;
            
            try (PreparedStatement stmt = conn.prepareStatement(insertSql)) {
                FunctionIterator functions = funcManager.getFunctions(true);
                
                while (functions.hasNext() && !monitor.isCancelled()) {
                    Function function = functions.next();
                    long addr = function.getEntryPoint().getOffset();
                    
                    // Check if this function needs processing
                    FunctionToProcess funcInfo = addressMap.get(addr);
                    if (funcInfo == null) {
                        skipped++;
                        continue; // Already has signature
                    }
                    
                    // Generate signature
                    FunctionSignature sig = generateFunctionSignature(program, function);
                    
                    // Create JSON signature data
                    String signatureData = String.format(
                        "{\"instructionCount\":%d,\"basicBlockCount\":%d,\"callCount\":%d,\"quality\":%.2f,\"featureVector\":\"%s\"}",
                        sig.instructionCount, sig.basicBlockCount, sig.callCount,
                        sig.quality, sig.featureVector);
                    
                    stmt.setInt(1, funcInfo.id);
                    stmt.setInt(2, execInfo.id);
                    stmt.setString(3, sig.hash);
                    stmt.setString(4, signatureData);
                    stmt.setString(5, sig.featureVector);
                    stmt.setDouble(6, sig.quality);
                    
                    stmt.addBatch();
                    processed++;
                    
                    // Execute batch periodically
                    if (processed % 500 == 0) {
                        stmt.executeBatch();
                        monitor.setMessage(String.format("Processing %s: %,d/%,d", 
                            execInfo.name, processed, functionsToProcess.size()));
                    }
                }
                
                // Execute remaining batch
                stmt.executeBatch();
            }
            
            println(String.format("  ✓ Generated %,d signatures (skipped %,d already processed)", 
                processed, skipped));
            
            totalProcessed += processed;
            totalSkipped += skipped;
            
        } finally {
            program.release(this);
        }
    }

    /**
     * Collect all program files from project into a map
     */
    private void collectProgramFiles(DomainFolder folder, Map<String, DomainFile> files) throws Exception {
        for (DomainFile file : folder.getFiles()) {
            if (file.getContentType().equals("Program")) {
                // Store by full path and by name for flexible matching
                files.put(file.getPathname(), file);
                files.put(file.getName(), file);
            }
        }

        for (DomainFolder subfolder : folder.getFolders()) {
            collectProgramFiles(subfolder, files);
        }
    }

    /**
     * Find a project file matching the executable name from the database
     */
    private DomainFile findMatchingFile(Map<String, DomainFile> projectFiles, String execName) {
        // Direct match
        if (projectFiles.containsKey(execName)) {
            return projectFiles.get(execName);
        }

        // Extract base filename for matching
        String baseName = execName;
        
        // Handle unified naming: "1.05b_D2Game.dll" -> "D2Game.dll"
        if (baseName.matches("^\\d+\\.\\d+[a-z]?_.*")) {
            baseName = baseName.substring(baseName.indexOf("_") + 1);
        }
        
        // Handle exception naming: "Classic_1.05b_Diablo_II.exe", "LoD_1.05b_Game.exe", or "vanilla_1.05b_Game.exe"
        if (baseName.matches("^(Classic|LoD|vanilla)_\\d+\\.\\d+[a-z]?_.*")) {
            String[] parts = baseName.split("_", 3);
            if (parts.length >= 3) {
                baseName = parts[2].replace("_", " ");
            }
        }
        
        // Search for matching file
        for (Map.Entry<String, DomainFile> entry : projectFiles.entrySet()) {
            String path = entry.getKey();
            String fileName = path;
            if (fileName.contains("/")) {
                fileName = fileName.substring(fileName.lastIndexOf("/") + 1);
            }
            
            // Check various matching conditions
            if (fileName.equals(baseName) || 
                fileName.replace(" ", "_").equals(baseName) ||
                fileName.equals(baseName.replace("_", " "))) {
                
                // Verify version matches by checking path
                if (execName.contains("_") && path.contains("/")) {
                    String version = extractVersion(execName);
                    if (version != null && path.contains("/" + version + "/")) {
                        return entry.getValue();
                    }
                }
            }
        }
        
        // Looser matching - just find by base name
        for (Map.Entry<String, DomainFile> entry : projectFiles.entrySet()) {
            String fileName = entry.getValue().getName();
            if (fileName.equals(baseName) || 
                fileName.replace(" ", "_").equals(baseName.replace(" ", "_"))) {
                return entry.getValue();
            }
        }
        
        return null;
    }

    /**
     * Extract version string from executable name
     */
    private String extractVersion(String execName) {
        // Match patterns like "1.05b" from "1.05b_D2Game.dll" or "Classic_1.05b_..."
        java.util.regex.Pattern p = java.util.regex.Pattern.compile("(\\d+\\.\\d+[a-z]?)");
        java.util.regex.Matcher m = p.matcher(execName);
        if (m.find()) {
            return m.group(1);
        }
        return null;
    }

    /**
     * Generate structural signature for a function
     */
    private FunctionSignature generateFunctionSignature(Program program, Function function) {
        FunctionSignature signature = new FunctionSignature();

        // Basic metrics
        signature.instructionCount = (int) function.getBody().getNumAddresses();
        signature.basicBlockCount = function.getBody().getNumAddressRanges();

        // Count calls
        signature.callCount = 0;
        InstructionIterator instructions = program.getListing().getInstructions(function.getBody(), true);
        while (instructions.hasNext()) {
            Instruction instruction = instructions.next();
            if (instruction.getFlowType().isCall()) {
                signature.callCount++;
            }
        }

        // Generate feature vector
        signature.featureVector = String.format("inst:%d,bb:%d,calls:%d",
            signature.instructionCount, signature.basicBlockCount, signature.callCount);

        // Calculate quality score
        signature.quality = calculateQuality(signature);

        // Generate hash
        signature.hash = generateSignatureHash(function, signature);

        return signature;
    }

    private double calculateQuality(FunctionSignature signature) {
        double quality = 0.5; // Base quality
        if (signature.instructionCount > 10) quality += 0.2;
        if (signature.basicBlockCount > 1) quality += 0.2;
        if (signature.callCount > 0) quality += 0.1;
        return Math.min(quality, 1.0);
    }

    private String generateSignatureHash(Function function, FunctionSignature signature) {
        String data = function.getName() + "_" + signature.instructionCount + "_" +
                     signature.basicBlockCount + "_" + signature.callCount;
        return Integer.toHexString(data.hashCode());
    }

    private boolean checkEnhancedSignaturesTable(Connection conn) {
        try (Statement stmt = conn.createStatement()) {
            stmt.executeQuery("SELECT 1 FROM enhanced_signatures LIMIT 1");
            return true;
        } catch (SQLException e) {
            return false;
        }
    }

    private void refreshMaterializedViews(Connection conn) {
        println("Refreshing materialized views...");
        try {
            try (Statement stmt = conn.createStatement()) {
                stmt.execute("SELECT refresh_cross_version_data()");
                println("✓ Cross-version analysis updated");
            }
        } catch (SQLException e) {
            try (Statement stmt = conn.createStatement()) {
                stmt.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY cross_version_functions");
                println("✓ Materialized views refreshed");
            } catch (SQLException e2) {
                println("Note: Could not refresh materialized views - may need manual refresh");
            }
        }
    }

    // Helper classes
    private static class ExecutableInfo {
        int id;
        String name;
        int totalFunctions;
        int unprocessedCount;
    }

    private static class FunctionToProcess {
        int id;
        String name;
        long address;
    }

    private static class FunctionSignature {
        String hash;
        int instructionCount;
        int basicBlockCount;
        int callCount;
        double quality;
        String featureVector;
    }
}
