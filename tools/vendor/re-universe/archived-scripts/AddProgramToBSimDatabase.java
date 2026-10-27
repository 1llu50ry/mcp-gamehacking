// Add programs to PostgreSQL BSim database for cross-version analysis
// Supports: Single program, All programs in project, or Version-filtered programs
// @author Ben Ethington
// @category BSim
// @keybinding ctrl shift B
// @menupath Tools.BSim.Add Program to Database
// @toolbar

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.util.exception.CancelledException;
import ghidra.framework.model.*;
import ghidra.program.database.ProgramDB;
import ghidra.base.project.GhidraProject;
import java.util.*;
import java.sql.*;

public class AddProgramToBSimDatabase extends GhidraScript {

    // Default BSim database configuration — override via environment variables
    // BSIM_DB_HOST, BSIM_DB_PORT, BSIM_DB_NAME, BSIM_DB_USER, BSIM_DB_PASSWORD
    private static final String DEFAULT_DB_URL = "jdbc:postgresql://"
        + System.getenv().getOrDefault("BSIM_DB_HOST", "localhost") + ":"
        + System.getenv().getOrDefault("BSIM_DB_PORT", "5432") + "/"
        + System.getenv().getOrDefault("BSIM_DB_NAME", "bsim");
    private static final String DEFAULT_DB_USER = System.getenv().getOrDefault("BSIM_DB_USER", "bsim_user");
    private static final String DEFAULT_DB_PASS = System.getenv().getOrDefault("BSIM_DB_PASSWORD", "");

    // Processing mode
    private static final String MODE_SINGLE = "Single Program (current)";
    private static final String MODE_ALL = "All Programs in Project";
    private static final String MODE_VERSION = "Programs by Version Filter";

    // Flag to auto-update existing executables without prompting
    private boolean autoUpdateExisting = false;

    // Helper class for unified version parsing
    private static class GameInfo {
        String gameType = "Unknown";
        String gameVersion = "Unknown";
        String versionFamily = "Unified";  // Default to Unified for new system

        GameInfo(String path) {
            parsePath(path);
        }

        // New constructor for unified executable name parsing
        GameInfo(String path, String executableName) {
            parsePath(path);
            parseUnifiedName(executableName);
        }

        // Parse unified naming convention from executable name
        private void parseUnifiedName(String executableName) {
            if (executableName == null || executableName.isEmpty()) return;

            // Standard binaries: 1.03_D2Game.dll -> version: 1.03, family: Unified
            java.util.regex.Pattern standardPattern = java.util.regex.Pattern.compile(
                "^(1\\.[0-9]+[a-z]?)_([A-Za-z0-9_]+)\\.(dll|exe)$");
            java.util.regex.Matcher standardMatcher = standardPattern.matcher(executableName);

            if (standardMatcher.matches()) {
                gameVersion = standardMatcher.group(1);
                versionFamily = "Unified";
                gameType = "Unified";
                return;
            }

            // Exception binaries: Classic_1.03_Game.exe -> version: 1.03, family: Classic
            java.util.regex.Pattern exceptionPattern = java.util.regex.Pattern.compile(
                "^(Classic|LoD)_(1\\.[0-9]+[a-z]?)_(Game|Diablo_II)\\.(exe|dll)$");
            java.util.regex.Matcher exceptionMatcher = exceptionPattern.matcher(executableName);

            if (exceptionMatcher.matches()) {
                versionFamily = exceptionMatcher.group(1);
                gameVersion = exceptionMatcher.group(2);
                gameType = versionFamily;
                return;
            }
        }
        
        private void parsePath(String path) {
            if (path == null || path.isEmpty()) return;
            
            String lowerPath = path.toLowerCase();
            String[] parts = path.split("/");
            
            // Detect game type from path folders
            for (String part : parts) {
                String lowerPart = part.toLowerCase();
                
                // Project Diablo 2
                if (lowerPart.equals("pd2") || lowerPart.contains("projectdiablo")) {
                    gameType = "PD2";
                    versionFamily = "PD2";
                }
                // Diablo 2 Resurrected
                else if (lowerPart.equals("d2r") || lowerPart.contains("resurrected")) {
                    gameType = "D2R";
                    versionFamily = "D2R";
                }
                // Classic Diablo 2
                else if (lowerPart.equals("classic") || lowerPart.equals("d2classic")) {
                    gameType = "Classic";
                    versionFamily = "Classic";
                }
                // Lord of Destruction
                else if (lowerPart.equals("lod") || lowerPart.equals("d2lod")) {
                    gameType = "LoD";
                    versionFamily = "LoD";
                }
                // Median XL
                else if (lowerPart.equals("medianxl") || lowerPart.equals("median")) {
                    gameType = "MedianXL";
                    versionFamily = "MedianXL";
                }
                // Path of Diablo
                else if (lowerPart.equals("pod") || lowerPart.contains("pathofdiablo")) {
                    gameType = "PoD";
                    versionFamily = "PoD";
                }
                
                // Extract version patterns (e.g., 1.14d, 1.09, S9, etc.)
                java.util.regex.Pattern versionPattern = java.util.regex.Pattern.compile(
                    "(1\\.\\d{2}[a-z]?|[sS]\\d+|v?\\d+\\.\\d+\\.\\d+)"
                );
                java.util.regex.Matcher matcher = versionPattern.matcher(part);
                if (matcher.find() && gameVersion.equals("Unknown")) {
                    gameVersion = matcher.group(1);
                }
            }
            
            // If still unknown, try to detect from program name
            if (gameType.equals("Unknown")) {
                String lastPart = parts[parts.length - 1].toLowerCase();
                if (lastPart.contains("d2client") || lastPart.contains("d2game") || 
                    lastPart.contains("d2common") || lastPart.contains("d2win")) {
                    // Likely vanilla D2 - check for version in path
                    if (lowerPath.contains("1.14") || lowerPath.contains("1.13")) {
                        gameType = "LoD";
                        versionFamily = "LoD";
                    }
                }
            }
        }
    }

    @Override
    public void run() throws Exception {

        println("=== BSim Database Population Script ===");

        // Ask user which mode to use
        String[] modes = { MODE_SINGLE, MODE_ALL, MODE_VERSION };
        String selectedMode = askChoice("Select Processing Mode",
            "How would you like to populate the BSim database?", Arrays.asList(modes), MODE_SINGLE);

        if (selectedMode == null) {
            println("Operation cancelled by user");
            return;
        }

        println("Selected mode: " + selectedMode);

        try {
            if (MODE_SINGLE.equals(selectedMode)) {
                processSingleProgram();
            } else if (MODE_ALL.equals(selectedMode)) {
                processAllPrograms();
            } else if (MODE_VERSION.equals(selectedMode)) {
                processVersionFiltered();
            }

            println("BSim database population completed!");

        } catch (Exception e) {
            printerr("Error during BSim population: " + e.getMessage());
            e.printStackTrace();
            throw e;
        }
    }

    /**
     * Process only the currently open program
     */
    private void processSingleProgram() throws Exception {
        if (currentProgram == null) {
            popup("No program is currently open. Please open a program first.");
            return;
        }

        String programName = currentProgram.getName();
        
        // Get the project path (e.g., /PD2/D2Client.dll) instead of filesystem path
        String programPath = "";
        DomainFile domainFile = currentProgram.getDomainFile();
        if (domainFile != null) {
            programPath = domainFile.getPathname();
        } else {
            // Fallback to executable path if domain file not available
            programPath = currentProgram.getExecutablePath();
        }

        println("Program: " + programName);
        println("Project Path: " + programPath);
        println("Functions: " + currentProgram.getFunctionManager().getFunctionCount());

        boolean proceed = askYesNo("Confirm BSim Addition",
            String.format("Add program '%s' to BSim database?", programName));

        if (!proceed) {
            println("Operation cancelled by user");
            return;
        }

        addProgramToBSim(currentProgram, programName, programPath);
        println("Successfully added " + programName + " to BSim database!");
    }

    /**
     * Process all programs in the Ghidra project
     */
    private void processAllPrograms() throws Exception {
        Project project = state.getProject();
        if (project == null) {
            popup("No project is open. Please open a Ghidra project first.");
            return;
        }

        ProjectData projectData = project.getProjectData();
        DomainFolder rootFolder = projectData.getRootFolder();

        // Collect all program files
        List<DomainFile> programFiles = new ArrayList<>();
        collectProgramFiles(rootFolder, programFiles);

        if (programFiles.isEmpty()) {
            popup("No programs found in the project.");
            return;
        }

        println("Found " + programFiles.size() + " programs in project");

        boolean proceed = askYesNo("Process All Programs",
            String.format("Add all %d programs to BSim database?\n\nThis may take a while.", programFiles.size()));

        if (!proceed) {
            println("Operation cancelled by user");
            return;
        }

        // Ask if user wants to auto-update existing executables
        autoUpdateExisting = askYesNo("Auto-Update Existing",
            "Automatically update existing executables without prompting for each one?");
        
        if (autoUpdateExisting) {
            println("Auto-update mode enabled - existing executables will be updated automatically");
        }

        int successCount = 0;
        int errorCount = 0;

        for (int i = 0; i < programFiles.size(); i++) {
            DomainFile file = programFiles.get(i);
            monitor.setMessage(String.format("Processing %d/%d: %s", i + 1, programFiles.size(), file.getName()));
            monitor.setProgress(i);

            if (monitor.isCancelled()) {
                println("Operation cancelled by user");
                break;
            }

            try {
                processProjectFile(file);
                successCount++;
            } catch (Exception e) {
                printerr("Error processing " + file.getName() + ": " + e.getMessage());
                errorCount++;
            }
        }

        println(String.format("Completed: %d successful, %d errors", successCount, errorCount));
    }

    /**
     * Process programs matching a version filter
     */
    private void processVersionFiltered() throws Exception {
        Project project = state.getProject();
        if (project == null) {
            popup("No project is open. Please open a Ghidra project first.");
            return;
        }

        // Ask for version filter
        String versionFilter = askString("Version Filter",
            "Enter version pattern to match (e.g., '1.14', 'LoD', 'Classic'):", "1.14");

        if (versionFilter == null || versionFilter.trim().isEmpty()) {
            println("Operation cancelled - no filter provided");
            return;
        }

        ProjectData projectData = project.getProjectData();
        DomainFolder rootFolder = projectData.getRootFolder();

        // Collect matching program files
        List<DomainFile> programFiles = new ArrayList<>();
        collectProgramFiles(rootFolder, programFiles);

        // Filter by version
        List<DomainFile> matchingFiles = new ArrayList<>();
        for (DomainFile file : programFiles) {
            String path = file.getPathname().toLowerCase();
            String name = file.getName().toLowerCase();
            if (path.contains(versionFilter.toLowerCase()) || name.contains(versionFilter.toLowerCase())) {
                matchingFiles.add(file);
            }
        }

        if (matchingFiles.isEmpty()) {
            popup("No programs matching filter '" + versionFilter + "' found.");
            return;
        }

        println("Found " + matchingFiles.size() + " programs matching '" + versionFilter + "'");

        // Show matching files
        println("Matching programs:");
        for (DomainFile file : matchingFiles) {
            println("  - " + file.getPathname());
        }

        boolean proceed = askYesNo("Process Filtered Programs",
            String.format("Add %d programs matching '%s' to BSim database?", matchingFiles.size(), versionFilter));

        if (!proceed) {
            println("Operation cancelled by user");
            return;
        }

        // Ask if user wants to auto-update existing executables
        autoUpdateExisting = askYesNo("Auto-Update Existing",
            "Automatically update existing executables without prompting for each one?");
        
        if (autoUpdateExisting) {
            println("Auto-update mode enabled - existing executables will be updated automatically");
        }

        int successCount = 0;
        int errorCount = 0;

        for (int i = 0; i < matchingFiles.size(); i++) {
            DomainFile file = matchingFiles.get(i);
            monitor.setMessage(String.format("Processing %d/%d: %s", i + 1, matchingFiles.size(), file.getName()));
            monitor.setProgress(i);

            if (monitor.isCancelled()) {
                println("Operation cancelled by user");
                break;
            }

            try {
                processProjectFile(file);
                successCount++;
            } catch (Exception e) {
                printerr("Error processing " + file.getName() + ": " + e.getMessage());
                errorCount++;
            }
        }

        println(String.format("Completed: %d successful, %d errors", successCount, errorCount));
    }

    /**
     * Recursively collect all program files from a folder
     */
    private void collectProgramFiles(DomainFolder folder, List<DomainFile> files) throws Exception {
        // Add files from this folder
        for (DomainFile file : folder.getFiles()) {
            if (file.getContentType().equals("Program")) {
                files.add(file);
            }
        }

        // Recurse into subfolders
        for (DomainFolder subfolder : folder.getFolders()) {
            collectProgramFiles(subfolder, files);
        }
    }

    /**
     * Process a single project file
     */
    private void processProjectFile(DomainFile file) throws Exception {
        println("Processing: " + file.getPathname());

        // Open the program
        Program program = (Program) file.getDomainObject(this, true, false, monitor);

        try {
            String programName = program.getName();
            String programPath = file.getPathname();

            addProgramToBSim(program, programName, programPath);
            println("  Added " + programName + " to BSim database");

        } finally {
            // Always release the program
            program.release(this);
        }
    }

    /**
     * Add a program to the BSim database
     */
    private void addProgramToBSim(Program program, String programName, String programPath) throws Exception {

        println("Connecting to BSim database...");

        // Connect to PostgreSQL BSim database
        try (Connection conn = DriverManager.getConnection(DEFAULT_DB_URL, DEFAULT_DB_USER, DEFAULT_DB_PASS)) {

            println("Connected to BSim database successfully");

            // First, check if executable already exists
            int executableId = getOrCreateExecutable(conn, programName, programPath);
            println("Executable ID: " + executableId);

            // Process functions
            processFunctions(conn, executableId, programName, programPath, program);

            // Update materialized views for cross-version analysis
            refreshMaterializedViews(conn);

        } catch (SQLException e) {
            printerr("Database error: " + e.getMessage());
            throw e;
        }
    }

    /**
     * Get or create executable record in database
     */
    private int getOrCreateExecutable(Connection conn, String programName, String programPath) throws SQLException {
        // Parse game info from path and executable name (unified system)
        GameInfo gameInfo = new GameInfo(programPath, programName);
        
        // Ensure game_version columns exist (they may not in older schemas)
        ensureGameVersionColumns(conn);

        // Check if executable already exists
        String selectSql = "SELECT id FROM exetable WHERE name_exec = ?";
        try (PreparedStatement stmt = conn.prepareStatement(selectSql)) {
            stmt.setString(1, programName);
            ResultSet rs = stmt.executeQuery();

            if (rs.next()) {
                int existingId = rs.getInt("id");
                println("Executable already exists in database with ID: " + existingId);
                
                // Update game_version and version_family if they were missing
                try {
                    String updateSql = "UPDATE exetable SET game_version = COALESCE(NULLIF(game_version, ''), ?), " +
                        "version_family = COALESCE(NULLIF(version_family, ''), ?) WHERE id = ?";
                    try (PreparedStatement updateStmt = conn.prepareStatement(updateSql)) {
                        updateStmt.setString(1, gameInfo.gameVersion);
                        updateStmt.setString(2, gameInfo.versionFamily);
                        updateStmt.setInt(3, existingId);
                        updateStmt.executeUpdate();
                    }
                } catch (SQLException e) {
                    // Columns may not exist in older schema - just log and continue
                    println("  Note: Could not update game version info (columns may not exist)");
                }

                // Check if auto-update is enabled, otherwise ask user
                if (!autoUpdateExisting) {
                    boolean update = askYesNo("Executable Exists",
                        "Executable already exists in database. Update function data?");
                    if (!update) {
                        throw new RuntimeException("Operation cancelled - executable exists");
                    }
                } else {
                    println("  Auto-updating existing executable...");
                }
                return existingId;
            }
        }

        // Try to create new executable record with game version info
        // First try with game_version columns, fall back to basic insert if columns don't exist
        try {
            String insertSql = "INSERT INTO exetable (name_exec, md5, architecture, ingest_date, repository, path, game_version, version_family) " +
                "VALUES (?, ?, ?, NOW(), 1, 1, ?, ?) RETURNING id";
            try (PreparedStatement stmt = conn.prepareStatement(insertSql)) {
                stmt.setString(1, programName);
                stmt.setString(2, generateMD5(programName));
                stmt.setInt(3, getArchitecture());
                stmt.setString(4, gameInfo.gameVersion);
                stmt.setString(5, gameInfo.versionFamily);

                ResultSet rs = stmt.executeQuery();
                if (rs.next()) {
                    int newId = rs.getInt("id");
                    println("Created new executable record with ID: " + newId);
                    println("  Game Type: " + gameInfo.gameType + ", Version: " + gameInfo.gameVersion);
                    return newId;
                }
            }
        } catch (SQLException e) {
            // Fall back to basic insert without game version columns
            println("  Note: Using basic insert (game version columns not available)");
            String insertSql = "INSERT INTO exetable (name_exec, md5, architecture, ingest_date, repository, path) " +
                "VALUES (?, ?, ?, NOW(), 1, 1) RETURNING id";
            try (PreparedStatement stmt = conn.prepareStatement(insertSql)) {
                stmt.setString(1, programName);
                stmt.setString(2, generateMD5(programName));
                stmt.setInt(3, getArchitecture());

                ResultSet rs = stmt.executeQuery();
                if (rs.next()) {
                    int newId = rs.getInt("id");
                    println("Created new executable record with ID: " + newId);
                    return newId;
                }
            }
        }
        
        throw new SQLException("Failed to create executable record");
    }
    
    /**
     * Ensure game_version and version_family columns exist in exetable
     */
    private void ensureGameVersionColumns(Connection conn) {
        try (Statement stmt = conn.createStatement()) {
            stmt.execute("ALTER TABLE exetable ADD COLUMN IF NOT EXISTS game_version VARCHAR(16)");
            stmt.execute("ALTER TABLE exetable ADD COLUMN IF NOT EXISTS version_family VARCHAR(16)");
        } catch (SQLException e) {
            // Columns may already exist or ALTER not supported - ignore
        }
    }

    /**
     * Process all functions in the program and add to database
     */
    private void processFunctions(Connection conn, int executableId, String programName, String programPath, Program program) throws Exception {

        println("Processing functions...");
        monitor.setMessage("Processing functions for BSim");

        // Get all functions in the program
        FunctionManager funcManager = program.getFunctionManager();
        FunctionIterator functions = funcManager.getFunctions(true);

        int functionCount = 0;
        int addedCount = 0;
        int skippedCount = 0;

        // Check if function already exists
        String checkSql = "SELECT id FROM desctable WHERE name_func = ? AND id_exe = ? AND addr = ?";
        // Prepare insert statement (without ON CONFLICT for compatibility)
        String insertSql = "INSERT INTO desctable (name_func, id_exe, id_signature, flags, addr) VALUES (?, ?, ?, ?, ?)";

        try (PreparedStatement checkStmt = conn.prepareStatement(checkSql);
             PreparedStatement insertStmt = conn.prepareStatement(insertSql)) {

            // Process each function
            while (functions.hasNext() && !monitor.isCancelled()) {
                Function function = functions.next();
                functionCount++;

                // Update progress
                if (functionCount % 100 == 0) {
                    monitor.setMessage(String.format("Processing function %d: %s",
                        functionCount, function.getName()));
                    println(String.format("Processed %d functions...", functionCount));
                }

                try {
                    // Check if function already exists
                    checkStmt.setString(1, function.getName());
                    checkStmt.setInt(2, executableId);
                    checkStmt.setLong(3, function.getEntryPoint().getOffset());
                    ResultSet rs = checkStmt.executeQuery();
                    
                    if (rs.next()) {
                        // Function already exists, skip
                        skippedCount++;
                        rs.close();
                        continue;
                    }
                    rs.close();

                    // Add function to database
                    insertStmt.setString(1, function.getName());
                    insertStmt.setInt(2, executableId);
                    insertStmt.setLong(3, generateSignatureId(function)); // Generate signature ID
                    insertStmt.setInt(4, 0); // Default flags
                    insertStmt.setLong(5, function.getEntryPoint().getOffset());

                    int rowsAffected = insertStmt.executeUpdate();
                    if (rowsAffected > 0) {
                        addedCount++;
                    }

                } catch (SQLException e) {
                    // Only log if it's not a duplicate key error
                    if (!e.getMessage().contains("duplicate key")) {
                        printerr("Error processing function " + function.getName() + ": " + e.getMessage());
                    } else {
                        skippedCount++;
                    }
                }
            }
        }

        if (monitor.isCancelled()) {
            println("Operation cancelled by user");
            return;
        }

        println(String.format("Processed %d functions, added %d new, skipped %d existing",
            functionCount, addedCount, skippedCount));

        // Log program metadata
        logProgramMetadata(programName, programPath, functionCount, addedCount);
    }

    /**
     * Refresh materialized views for cross-version analysis
     */
    private void refreshMaterializedViews(Connection conn) throws SQLException {
        println("Refreshing materialized views for cross-version analysis...");

        try (Statement stmt = conn.createStatement()) {
            // Refresh cross-version functions view
            stmt.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY cross_version_functions");
            println("Refreshed cross_version_functions view");

            // Refresh function evolution view
            stmt.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY function_evolution");
            println("Refreshed function_evolution view");

        } catch (SQLException e) {
            // If concurrent refresh fails, try regular refresh
            try (Statement stmt = conn.createStatement()) {
                stmt.execute("REFRESH MATERIALIZED VIEW cross_version_functions");
                stmt.execute("REFRESH MATERIALIZED VIEW function_evolution");
                println("Refreshed views (non-concurrent mode)");
            }
        }
    }

    /**
     * Generate a simple MD5 placeholder
     */
    private String generateMD5(String input) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("MD5");
            byte[] hash = md.digest(input.getBytes());
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (Exception e) {
            return "unknown_md5";
        }
    }

    /**
     * Detect program architecture
     */
    private int getArchitecture() {
        String arch = currentProgram.getLanguage().getProcessor().toString().toLowerCase();
        if (arch.contains("x86") && arch.contains("64")) {
            return 64; // x86-64
        } else if (arch.contains("x86")) {
            return 32; // x86-32
        } else {
            return 32; // Default to 32-bit
        }
    }

    /**
     * Generate signature ID for function (simplified)
     */
    private long generateSignatureId(Function function) {
        // Simple signature generation based on function properties
        String signature = function.getName() + "_" + function.getBody().getNumAddresses();
        return Math.abs(signature.hashCode());
    }

    /**
     * Log program metadata for analysis
     */
    private void logProgramMetadata(String programName, String programPath, int functionCount, int addedCount) {
        // Parse version information from path
        GameInfo gameInfo = new GameInfo(programPath);

        println("=== Program Analysis Summary ===");
        println("Program: " + programName);
        println("Path: " + programPath);
        println("Game Type: " + gameInfo.gameType);
        println("Version: " + gameInfo.gameVersion);
        println("Version Family: " + gameInfo.versionFamily);
        println("Total Functions: " + functionCount);
        println("Added to Database: " + addedCount);
        println("Architecture: " + getArchitecture() + "-bit");
        println("================================");
    }
}