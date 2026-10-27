// Generate enhanced function signatures for BSim similarity analysis
// Compatible with Ghidra 11.4.2 - No BSim client dependencies
// @author Ben Ethington
// @category BSim
// @keybinding ctrl shift L
// @menupath Tools.BSim.Generate Enhanced Signatures

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.lang.*;
import ghidra.util.exception.CancelledException;
import ghidra.framework.model.*;
import java.sql.*;
import java.util.*;

public class GenerateBSimSignatures extends GhidraScript {

    private static final String DB_URL = "jdbc:postgresql://"
        + System.getenv().getOrDefault("BSIM_DB_HOST", "localhost") + ":"
        + System.getenv().getOrDefault("BSIM_DB_PORT", "5432") + "/"
        + System.getenv().getOrDefault("BSIM_DB_NAME", "bsim");
    private static final String DB_USER = System.getenv().getOrDefault("BSIM_DB_USER", "bsim_user");
    private static final String DB_PASS = System.getenv().getOrDefault("BSIM_DB_PASSWORD", "");

    // Mode selection constants
    private static final String MODE_SINGLE = "Single Program (current)";
    private static final String MODE_ALL = "All Programs in Project";
    private static final String MODE_VERSION = "Programs by Version Filter";

    @Override
    public void run() throws Exception {
        println("=== Enhanced BSim Signature Generation ===");

        // Ask user for processing mode
        String[] modes = { MODE_SINGLE, MODE_ALL, MODE_VERSION };
        String selectedMode = askChoice("Select Processing Mode",
            "How would you like to generate signatures?",
            Arrays.asList(modes), MODE_SINGLE);

        if (selectedMode.equals(MODE_SINGLE)) {
            processSingleProgram();
        } else if (selectedMode.equals(MODE_ALL)) {
            processAllPrograms();
        } else if (selectedMode.equals(MODE_VERSION)) {
            processVersionFiltered();
        }
    }

    private void processSingleProgram() throws Exception {
        if (currentProgram == null) {
            popup("No program is currently open. Please open a program first.");
            return;
        }

        String programName = currentProgram.getName();
        println("Program: " + programName);

        FunctionManager funcManager = currentProgram.getFunctionManager();
        int functionCount = funcManager.getFunctionCount();
        println("Total functions: " + functionCount);

        boolean proceed = askYesNo("Generate Enhanced Signatures",
            String.format("Generate enhanced signatures for %d functions?\n\nThis will:\n" +
            "- Create structural function signatures\n" +
            "- Extract instruction patterns and features\n" +
            "- Store data for similarity analysis\n" +
            "- Enable cross-version function matching\n\nProceed?", functionCount));

        if (!proceed) {
            println("Operation cancelled by user");
            return;
        }

        try {
            generateSignatures(currentProgram, programName);
            println("Successfully generated enhanced signatures!");

        } catch (Exception e) {
            printerr("Error generating signatures: " + e.getMessage());
            e.printStackTrace();
            throw e;
        }
    }

    private void processAllPrograms() throws Exception {
        Project project = state.getProject();
        if (project == null) {
            popup("No project is currently open.");
            return;
        }

        ProjectData projectData = project.getProjectData();
        DomainFolder rootFolder = projectData.getRootFolder();

        List<DomainFile> programFiles = new ArrayList<>();
        collectProgramFiles(rootFolder, programFiles);

        if (programFiles.isEmpty()) {
            popup("No program files found in the project.");
            return;
        }

        boolean proceed = askYesNo("Process All Programs",
            String.format("Found %d programs in project.\n\nGenerate signatures for all programs?",
                programFiles.size()));

        if (!proceed) {
            println("Operation cancelled by user");
            return;
        }

        println("Processing " + programFiles.size() + " programs...");
        int successCount = 0;
        int errorCount = 0;

        for (DomainFile file : programFiles) {
            if (monitor.isCancelled()) break;

            try {
                processProjectFile(file);
                successCount++;
            } catch (Exception e) {
                printerr("Error processing " + file.getName() + ": " + e.getMessage());
                errorCount++;
            }
        }

        println(String.format("\n=== Batch Processing Complete ===\nSuccess: %d\nErrors: %d",
            successCount, errorCount));
    }

    private void processVersionFiltered() throws Exception {
        String versionFilter = askString("Version Filter",
            "Enter version pattern to match (e.g., '1.14' or 'D2R'):");

        if (versionFilter == null || versionFilter.trim().isEmpty()) {
            println("No version filter specified, operation cancelled.");
            return;
        }

        Project project = state.getProject();
        if (project == null) {
            popup("No project is currently open.");
            return;
        }

        ProjectData projectData = project.getProjectData();
        DomainFolder rootFolder = projectData.getRootFolder();

        List<DomainFile> allFiles = new ArrayList<>();
        collectProgramFiles(rootFolder, allFiles);

        // Filter by version
        List<DomainFile> matchingFiles = new ArrayList<>();
        for (DomainFile file : allFiles) {
            String path = file.getPathname();
            if (path.contains(versionFilter) || file.getName().contains(versionFilter)) {
                matchingFiles.add(file);
            }
        }

        if (matchingFiles.isEmpty()) {
            popup("No programs matching version '" + versionFilter + "' found.");
            return;
        }

        boolean proceed = askYesNo("Process Filtered Programs",
            String.format("Found %d programs matching '%s'.\n\nGenerate signatures for these programs?",
                matchingFiles.size(), versionFilter));

        if (!proceed) {
            println("Operation cancelled by user");
            return;
        }

        println("Processing " + matchingFiles.size() + " matching programs...");
        int successCount = 0;
        int errorCount = 0;

        for (DomainFile file : matchingFiles) {
            if (monitor.isCancelled()) break;

            try {
                processProjectFile(file);
                successCount++;
            } catch (Exception e) {
                printerr("Error processing " + file.getName() + ": " + e.getMessage());
                errorCount++;
            }
        }

        println(String.format("\n=== Version Filtered Processing Complete ===\nVersion: %s\nSuccess: %d\nErrors: %d",
            versionFilter, successCount, errorCount));
    }

    private void collectProgramFiles(DomainFolder folder, List<DomainFile> files) throws Exception {
        for (DomainFile file : folder.getFiles()) {
            if (file.getContentType().equals("Program")) {
                files.add(file);
            }
        }
        for (DomainFolder subfolder : folder.getFolders()) {
            collectProgramFiles(subfolder, files);
        }
    }

    private void processProjectFile(DomainFile file) throws Exception {
        println("\nProcessing: " + file.getPathname());
        monitor.setMessage("Processing: " + file.getName());

        Program program = (Program) file.getDomainObject(this, false, false, monitor);
        try {
            generateSignatures(program, file.getName());
            println("  Signatures generated successfully");
        } finally {
            program.release(this);
        }
    }

    private void generateSignatures(Program program, String programName) throws Exception {
        println("Connecting to database...");

        try (Connection conn = DriverManager.getConnection(DB_URL, DB_USER, DB_PASS)) {
            println("Connected successfully");

            // Get executable ID
            int executableId = getExecutableId(conn, programName);
            if (executableId == -1) {
                throw new RuntimeException("Executable not found. Please run AddProgramToBSimDatabase.java first.");
            }

            println("Processing functions for executable ID: " + executableId);
            processFunctionSignatures(conn, program, executableId, programName);

        } catch (SQLException e) {
            printerr("Database error: " + e.getMessage());
            throw e;
        }
    }

    private int getExecutableId(Connection conn, String programName) throws SQLException {
        String sql = "SELECT id FROM exetable WHERE name_exec = ?";
        try (PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setString(1, programName);
            ResultSet rs = stmt.executeQuery();
            if (rs.next()) {
                return rs.getInt("id");
            }
        }
        return -1;
    }

    private void ensureEnhancedSignaturesTable(Connection conn) throws SQLException {
        // Create table if it doesn't exist (using bytea for our custom signatures, not lshvector)
        String createTableSql = """
            CREATE TABLE IF NOT EXISTS enhanced_signatures (
                id SERIAL PRIMARY KEY,
                function_id BIGINT NOT NULL UNIQUE,
                signature_vector BYTEA,
                feature_count INTEGER,
                signature_quality DOUBLE PRECISION,
                instruction_count INTEGER,
                parameter_count INTEGER,
                branch_count INTEGER,
                call_count INTEGER,
                mnemonic_pattern TEXT,
                control_flow_pattern TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
            """;
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(createTableSql);
        }

        // Add signature_vector column if it doesn't exist (for tables that had lsh_vector)
        String addColumnSql = """
            ALTER TABLE enhanced_signatures 
            ADD COLUMN IF NOT EXISTS signature_vector BYTEA
            """;
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(addColumnSql);
        } catch (SQLException e) {
            // Column may already exist, ignore
        }

        // Drop the old lsh_vector column constraint and column if it exists
        // First make it nullable (in case it has NOT NULL constraint)
        try (Statement stmt = conn.createStatement()) {
            stmt.execute("ALTER TABLE enhanced_signatures ALTER COLUMN lsh_vector DROP NOT NULL");
        } catch (SQLException e) {
            // Column may not exist or constraint already dropped, ignore
        }

        // Drop the old lsh_vector column entirely since we use signature_vector now
        try (Statement stmt = conn.createStatement()) {
            stmt.execute("ALTER TABLE enhanced_signatures DROP COLUMN IF EXISTS lsh_vector");
        } catch (SQLException e) {
            // Column may not exist, ignore
        }
    }

    private void processFunctionSignatures(Connection conn, Program program, int executableId, String programName) throws Exception {
        println("Generating enhanced signatures...");
        monitor.setMessage("Generating function signatures");

        FunctionManager funcManager = program.getFunctionManager();
        FunctionIterator functions = funcManager.getFunctions(true);

        int processedCount = 0;
        int signatureCount = 0;

        // Ensure the table exists with correct schema (using bytea for our custom signatures)
        ensureEnhancedSignaturesTable(conn);

        // SQL statements
        String checkSql = "SELECT id FROM enhanced_signatures WHERE function_id = ?";
        String insertSql = """
            INSERT INTO enhanced_signatures
            (function_id, signature_vector, feature_count, signature_quality, instruction_count,
             parameter_count, branch_count, call_count, mnemonic_pattern, control_flow_pattern)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (function_id) DO UPDATE SET
                signature_vector = EXCLUDED.signature_vector,
                feature_count = EXCLUDED.feature_count,
                signature_quality = EXCLUDED.signature_quality,
                instruction_count = EXCLUDED.instruction_count,
                parameter_count = EXCLUDED.parameter_count,
                branch_count = EXCLUDED.branch_count,
                call_count = EXCLUDED.call_count,
                mnemonic_pattern = EXCLUDED.mnemonic_pattern,
                control_flow_pattern = EXCLUDED.control_flow_pattern,
                created_at = NOW()
            """;

        String getFunctionIdSql = "SELECT id FROM desctable WHERE name_func = ? AND id_exe = ?";

        try (PreparedStatement checkStmt = conn.prepareStatement(checkSql);
             PreparedStatement insertStmt = conn.prepareStatement(insertSql);
             PreparedStatement funcIdStmt = conn.prepareStatement(getFunctionIdSql)) {

            while (functions.hasNext() && !monitor.isCancelled()) {
                Function function = functions.next();
                processedCount++;

                if (processedCount % 100 == 0) {
                    monitor.setMessage(String.format("Processing function %d: %s",
                        processedCount, function.getName()));
                    println(String.format("Processed %d functions...", processedCount));
                }

                try {
                    // Get function ID from database
                    funcIdStmt.setString(1, function.getName());
                    funcIdStmt.setInt(2, executableId);
                    ResultSet rs = funcIdStmt.executeQuery();

                    if (!rs.next()) {
                        rs.close();
                        continue; // Function not in database
                    }

                    long functionId = rs.getLong("id");
                    rs.close();

                    // Check if signature already exists
                    checkStmt.setLong(1, functionId);
                    ResultSet checkRs = checkStmt.executeQuery();
                    if (checkRs.next()) {
                        checkRs.close();
                        continue; // Skip if exists
                    }
                    checkRs.close();

                    // Create enhanced signature
                    FunctionSignature signature = createFunctionSignature(function);
                    if (signature != null) {
                        // Store signature
                        insertStmt.setLong(1, functionId);
                        insertStmt.setBytes(2, signature.lshVector);
                        insertStmt.setInt(3, signature.featureCount);
                        insertStmt.setDouble(4, signature.quality);
                        insertStmt.setInt(5, signature.instructionCount);
                        insertStmt.setInt(6, signature.parameterCount);
                        insertStmt.setInt(7, signature.branchCount);
                        insertStmt.setInt(8, signature.callCount);
                        insertStmt.setString(9, signature.mnemonicPattern);
                        insertStmt.setString(10, signature.controlFlowPattern);

                        insertStmt.executeUpdate();
                        signatureCount++;
                    }

                } catch (Exception e) {
                    printerr("Error processing function " + function.getName() + ": " + e.getMessage());
                }
            }
        }

        if (monitor.isCancelled()) {
            println("Operation cancelled by user");
            return;
        }

        println(String.format("Generated %d enhanced signatures for %d functions",
            signatureCount, processedCount));
    }

    private FunctionSignature createFunctionSignature(Function function) {
        try {
            FunctionSignature sig = new FunctionSignature();

            // Basic metrics
            sig.instructionCount = (int)function.getBody().getNumAddresses();
            sig.parameterCount = function.getParameterCount();

            // Instruction pattern analysis
            sig.mnemonicPattern = extractMnemonicPattern(function);
            sig.controlFlowPattern = extractControlFlowPattern(function);

            // Function complexity
            sig.branchCount = countBranches(function);
            sig.callCount = function.getCalledFunctions(monitor).size();

            // Create LSH-style vector
            List<Integer> features = extractFeatures(function);
            sig.lshVector = createLSHVector(features);
            sig.featureCount = features.size();
            sig.quality = calculateSignatureQuality(sig);

            return sig;

        } catch (Exception e) {
            return null;
        }
    }

    private String extractMnemonicPattern(Function function) {
        Map<String, Integer> mnemonicCounts = new HashMap<>();
        AddressSetView body = function.getBody();
        InstructionIterator instructions = currentProgram.getListing().getInstructions(body, true);

        while (instructions.hasNext()) {
            Instruction instr = instructions.next();
            String mnemonic = instr.getMnemonicString();
            mnemonicCounts.merge(mnemonic, 1, Integer::sum);
        }

        // Create normalized pattern (top 5 most common mnemonics)
        return mnemonicCounts.entrySet().stream()
            .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
            .limit(5)
            .map(e -> e.getKey() + ":" + e.getValue())
            .reduce("", (a, b) -> a.isEmpty() ? b : a + "," + b);
    }

    private String extractControlFlowPattern(Function function) {
        Map<String, Integer> flowTypes = new HashMap<>();
        AddressSetView body = function.getBody();
        InstructionIterator instructions = currentProgram.getListing().getInstructions(body, true);

        while (instructions.hasNext()) {
            Instruction instr = instructions.next();
            // Use flow type methods directly without variable
            if (instr.getFlowType().hasFallthrough() || instr.getFlowType().isJump() || instr.getFlowType().isCall()) {
                flowTypes.merge(instr.getFlowType().toString(), 1, Integer::sum);
            }
        }

        return flowTypes.entrySet().stream()
            .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
            .map(e -> e.getKey() + ":" + e.getValue())
            .reduce("", (a, b) -> a.isEmpty() ? b : a + "," + b);
    }

    private int countBranches(Function function) {
        int branchCount = 0;
        AddressSetView body = function.getBody();
        InstructionIterator instructions = currentProgram.getListing().getInstructions(body, true);

        while (instructions.hasNext()) {
            Instruction instr = instructions.next();
            if (instr.getFlowType().isJump() || instr.getFlowType().isConditional()) {
                branchCount++;
            }
        }
        return branchCount;
    }

    private List<Integer> extractFeatures(Function function) {
        List<Integer> features = new ArrayList<>();

        try {
            AddressSetView body = function.getBody();
            InstructionIterator instructions = currentProgram.getListing().getInstructions(body, true);

            while (instructions.hasNext()) {
                Instruction instr = instructions.next();

                // Mnemonic features
                features.add(instr.getMnemonicString().hashCode());

                // Operand features
                for (int i = 0; i < instr.getNumOperands(); i++) {
                    features.add(instr.getOperandType(i));
                }

                // Flow type features
                features.add(instr.getFlowType().hashCode());
            }

            // Structural features
            features.add((int)function.getBody().getNumAddresses());
            features.add(function.getParameterCount());

        } catch (Exception e) {
            // Return partial features if error occurs
        }

        return features;
    }

    private byte[] createLSHVector(List<Integer> features) {
        if (features.isEmpty()) {
            return new byte[32]; // Empty vector
        }

        int vectorSize = 256; // Bits
        byte[] vector = new byte[vectorSize / 8]; // 32 bytes

        // Use multiple hash functions for better distribution
        for (int hashFunc = 0; hashFunc < vectorSize; hashFunc++) {
            int hash = 0;

            for (Integer feature : features) {
                // Apply different hash functions
                int h = feature ^ (hashFunc * 0x9E3779B9);
                h = Integer.rotateLeft(h, hashFunc % 32);
                hash ^= h;
            }

            // Set bit in vector
            if ((hash & 1) == 1) {
                int byteIndex = hashFunc / 8;
                int bitIndex = hashFunc % 8;
                vector[byteIndex] |= (1 << bitIndex);
            }
        }

        return vector;
    }

    private double calculateSignatureQuality(FunctionSignature sig) {
        double quality = 0.0;

        // Quality based on feature richness
        if (sig.instructionCount > 10) quality += 0.3;
        if (sig.featureCount > 20) quality += 0.2;
        if (sig.branchCount > 0) quality += 0.2;
        if (sig.callCount > 0) quality += 0.2;
        if (sig.mnemonicPattern != null && sig.mnemonicPattern.length() > 10) quality += 0.1;

        return Math.min(quality, 1.0);
    }

    // Helper class for function signatures
    private static class FunctionSignature {
        byte[] lshVector;
        int featureCount;
        double quality;
        int instructionCount;
        int parameterCount;
        int branchCount;
        int callCount;
        String mnemonicPattern;
        String controlFlowPattern;
    }
}