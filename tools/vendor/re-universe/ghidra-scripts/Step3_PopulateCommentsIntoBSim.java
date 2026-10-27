// STEP 3: Populate Function Comments (OPTIONAL ENRICHMENT)
//
// Extracts function comments from Ghidra analysis and stores them in the BSim database
// for enhanced similarity analysis. Comments provide valuable context for function
// identification and can improve matching accuracy across different versions.
//
// COMMENT EXTRACTION:
// - Pre-comments: Comments placed before function entry points
// - Post-comments: Comments placed after function definitions
// - Plate comments: Function header documentation blocks
// - EOL comments: End-of-line comments at function entry points
//
// ANALYSIS ENHANCEMENT:
// - Improves function matching by providing semantic context
// - Enables comment-based filtering and search capabilities
// - Supports analyst workflow by preserving documentation
// - Facilitates cross-version function tracking through consistent naming
//
// DATA STORAGE:
// - Links comments to specific functions via function IDs
// - Preserves comment types and positions for context
// - Maintains version associations for cross-version analysis
//
// WORKFLOW POSITION: Optional after Step1-2, enhances Step4-5 results
// DEPENDENCIES: Requires functions to be added via Step1
//
// @author Ben Ethington
// @category Diablo 2
// @keybinding ctrl shift C

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.symbol.*;
import ghidra.util.exception.CancelledException;
import ghidra.framework.model.*;
import java.sql.*;
import java.util.*;

public class Step3_PopulateCommentsIntoBSim extends GhidraScript {

    // Resolved credentials (loaded from db.env)
    private String dbUrl;
    private String dbUser;
    private String dbPass;

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

    // Mode selection constants
    private static final String MODE_SINGLE = "Single Program (current)";
    private static final String MODE_ALL = "All Programs in Project";
    private static final String MODE_VERSION = "Programs by Version Filter";

    @Override
    public void run() throws Exception {
        println("=== BSim Comment Population Script ===");

        // Load database credentials from db.env
        loadDbConfig();

        // Ask user for processing mode
        String[] modes = { MODE_SINGLE, MODE_ALL, MODE_VERSION };
        String selectedMode = askChoice("Select Processing Mode",
            "How would you like to populate comments?",
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
        // Get project path for version-aware executable lookup
        String projectPath = null;
        DomainFile domainFile = currentProgram.getDomainFile();
        if (domainFile != null) {
            projectPath = domainFile.getPathname();
        }
        println("Program: " + programName);
        if (projectPath != null) {
            println("Project path: " + projectPath);
        }

        // Check if this is a mod file
        if (projectPath != null && shouldSkipPath(projectPath)) {
            popup("This program is from a mod folder or has no recognized version.\n" +
                  "Only official vanilla versions (1.00-1.14d) are processed.");
            return;
        }

        // Count functions with comments
        int functionsWithComments = countFunctionsWithComments(currentProgram);
        println("Functions with comments: " + functionsWithComments);

        if (functionsWithComments == 0) {
            popup("No functions with comments found in this program.");
            return;
        }

        boolean proceed = askYesNo("Populate Comments",
            String.format("Add %d function comments to BSim database?\n\nThis will:\n" +
            "- Extract all function comments\n" +
            "- Associate comments with BSim function records\n" +
            "- Enable comment-based analysis\n\nProceed?", functionsWithComments));

        if (!proceed) {
            println("Operation cancelled by user");
            return;
        }

        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPass)) {
            println("Connected to BSim database");
            populateComments(currentProgram, programName, projectPath, conn);
            println("Successfully populated comments into BSim database!");
        } catch (Exception e) {
            printerr("Error populating comments: " + e.getMessage());
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

        List<DomainFile> allFiles = new ArrayList<>();
        collectProgramFiles(rootFolder, allFiles);

        // Filter out mod files - only process official vanilla versions
        List<DomainFile> programFiles = new ArrayList<>();
        int skippedCount = 0;
        for (DomainFile file : allFiles) {
            if (shouldSkipPath(file.getPathname())) {
                skippedCount++;
            } else {
                programFiles.add(file);
            }
        }

        if (skippedCount > 0) {
            println("Skipped " + skippedCount + " non-vanilla programs (mods, unknown versions)");
        }

        if (programFiles.isEmpty()) {
            popup("No vanilla program files found in the project.");
            return;
        }

        boolean proceed = askYesNo("Process All Programs",
            String.format("Found %d vanilla programs (skipped %d mods/other).\n\nPopulate comments for all vanilla programs?",
                programFiles.size(), skippedCount));

        if (!proceed) {
            println("Operation cancelled by user");
            return;
        }

        println("Processing " + programFiles.size() + " vanilla programs...");
        int successCount = 0;
        int errorCount = 0;

        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPass)) {
            println("Connected to BSim database");

            for (DomainFile file : programFiles) {
                if (monitor.isCancelled()) break;

                try {
                    processProjectFile(file, conn);
                    successCount++;
                } catch (Exception e) {
                    printerr("Error processing " + file.getName() + ": " + e.getMessage());
                    errorCount++;
                }
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

        // Filter by version AND skip mods
        List<DomainFile> matchingFiles = new ArrayList<>();
        for (DomainFile file : allFiles) {
            if (shouldSkipPath(file.getPathname())) continue;
            String path = file.getPathname();
            if (path.contains(versionFilter) || file.getName().contains(versionFilter)) {
                matchingFiles.add(file);
            }
        }

        if (matchingFiles.isEmpty()) {
            popup("No vanilla programs matching version '" + versionFilter + "' found.");
            return;
        }

        boolean proceed = askYesNo("Process Filtered Programs",
            String.format("Found %d vanilla programs matching '%s'.\n\nPopulate comments for these programs?",
                matchingFiles.size(), versionFilter));

        if (!proceed) {
            println("Operation cancelled by user");
            return;
        }

        println("Processing " + matchingFiles.size() + " matching programs...");
        int successCount = 0;
        int errorCount = 0;

        try (Connection conn = DriverManager.getConnection(dbUrl, dbUser, dbPass)) {
            println("Connected to BSim database");

            for (DomainFile file : matchingFiles) {
                if (monitor.isCancelled()) break;

                try {
                    processProjectFile(file, conn);
                    successCount++;
                } catch (Exception e) {
                    printerr("Error processing " + file.getName() + ": " + e.getMessage());
                    errorCount++;
                }
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

    /**
     * Check if a project path should be skipped (mod folder, unknown version).
     * Only official vanilla versions 1.00-1.14d are processed.
     */
    private boolean shouldSkipPath(String projectPath) {
        if (projectPath == null || projectPath.isEmpty()) return true;

        String[] parts = projectPath.replace("\\", "/").split("/");

        // Check for known mod folders or generic "Mods" folder
        for (String part : parts) {
            if (part.isEmpty()) continue;
            if (isModFolder(part)) return true;
            if (part.equalsIgnoreCase("Mods")) return true;
        }

        // Verify a valid vanilla version exists in the path (1.xx format)
        for (String part : parts) {
            if (part.matches("1\\.[0-9]{1,2}[a-z]?")) {
                return false;
            }
        }

        return true; // No valid version found
    }

    /**
     * Check if a folder component represents a known Diablo 2 mod.
     */
    private boolean isModFolder(String component) {
        String[] knownMods = {"PD2", "PoD", "MedianXL", "Eastern Sun", "Requiem", "PlugY"};
        for (String mod : knownMods) {
            if (component.equalsIgnoreCase(mod)) return true;
        }
        return false;
    }

    private void processProjectFile(DomainFile file, Connection conn) throws Exception {
        println("\nProcessing: " + file.getPathname());
        monitor.setMessage("Processing: " + file.getName());

        Program program = (Program) file.getDomainObject(this, false, false, monitor);
        try {
            int commentCount = countFunctionsWithComments(program);
            if (commentCount > 0) {
                populateComments(program, file.getName(), file.getPathname(), conn);
                println("  Added " + commentCount + " function comments");
            } else {
                println("  No comments to add");
            }
        } finally {
            program.release(this);
        }
    }

    private int countFunctionsWithComments(Program program) {
        FunctionManager funcManager = program.getFunctionManager();
        FunctionIterator functions = funcManager.getFunctions(true);
        int count = 0;

        while (functions.hasNext()) {
            Function func = functions.next();
            if (hasComments(program, func)) {
                count++;
            }
        }
        return count;
    }

    private boolean hasComments(Program program, Function func) {
        CodeUnit cu = program.getListing().getCodeUnitAt(func.getEntryPoint());
        if (cu == null) return false;

        // Use new Ghidra 11.4+ CommentType API
        String plateComment = cu.getComment(ghidra.program.model.listing.CommentType.PLATE);
        String preComment = cu.getComment(ghidra.program.model.listing.CommentType.PRE);
        String postComment = cu.getComment(ghidra.program.model.listing.CommentType.POST);
        String eolComment = cu.getComment(ghidra.program.model.listing.CommentType.EOL);

        return (plateComment != null && !plateComment.trim().isEmpty()) ||
               (preComment != null && !preComment.trim().isEmpty()) ||
               (postComment != null && !postComment.trim().isEmpty()) ||
               (eolComment != null && !eolComment.trim().isEmpty());
    }

    private void populateComments(Program program, String programName, String projectPath, Connection conn) throws Exception {
        // Extract version from project path for disambiguation
        String versionString = extractVersionFromPath(projectPath);
        if (versionString != null) {
            println("  Version: " + versionString);
        }

        // Get executable ID with version-aware lookup
        int executableId = getExecutableId(conn, programName, versionString);
        if (executableId == -1) {
            throw new RuntimeException("Executable not found in BSim database. Run Step1 first for: " + programName);
        }

        println("  Executable ID: " + executableId);

        // Process function comments
        processComments(conn, program, executableId, programName);
    }

    private int getExecutableId(Connection conn, String programName, String versionString) throws SQLException {
        // If we have a version, use it to disambiguate executables with the same name across versions
        if (versionString != null) {
            String selectWithVersionSql =
                "SELECT e.id FROM exetable e " +
                "JOIN game_versions gv ON e.game_version = gv.id " +
                "WHERE e.name_exec = ? AND gv.version_string = ?";
            try (PreparedStatement stmt = conn.prepareStatement(selectWithVersionSql)) {
                stmt.setString(1, programName);
                stmt.setString(2, versionString);
                ResultSet rs = stmt.executeQuery();
                if (rs.next()) {
                    return rs.getInt("id");
                }
            }
        }

        // Fallback: query by name only (may be ambiguous if same binary exists in multiple versions)
        String selectSql = "SELECT id FROM exetable WHERE name_exec = ?";
        try (PreparedStatement stmt = conn.prepareStatement(selectSql)) {
            stmt.setString(1, programName);
            ResultSet rs = stmt.executeQuery();

            if (rs.next()) {
                int id = rs.getInt("id");
                // Check if there are multiple matches
                if (rs.next()) {
                    printerr("WARNING: Multiple executables found with name '" + programName +
                             "'. Using first match (id=" + id + "). " +
                             "Provide version info via project path for accurate matching.");
                }
                return id;
            }
            return -1;
        }
    }

    /**
     * Extract game version string from the Ghidra project path.
     * Handles paths like "/vanilla/1.03/D2Game.dll" or "/vanilla/1.05b/Game.exe".
     */
    private String extractVersionFromPath(String projectPath) {
        if (projectPath == null || projectPath.isEmpty()) {
            return null;
        }

        String[] pathParts = projectPath.replace("\\", "/").split("/");
        for (String part : pathParts) {
            if (part.isEmpty()) continue;
            if (part.matches("1\\.[0-9]{1,2}[a-z]?")) {
                return part;
            }
        }
        return null;
    }

    private void processComments(Connection conn, Program program, int executableId, String programName) throws Exception {
        println("Processing function comments...");
        monitor.setMessage("Processing function comments for BSim");

        FunctionManager funcManager = program.getFunctionManager();
        FunctionIterator functions = funcManager.getFunctions(true);

        int processedCount = 0;
        int commentCount = 0;

        // Get or create a valid user_id (find first user or use NULL)
        Integer userId = getValidUserId(conn);

        // Prepare statements for comment insertion (user_id can be NULL)
        String insertCommentSql = "INSERT INTO core_comment (content, content_html, entity_type, entity_id, entity_name, created_at, updated_at, is_deleted, parent_id, user_id) VALUES (?, ?, ?, ?, ?, NOW(), NOW(), false, NULL, ?) ON CONFLICT DO NOTHING";

        // Get function ID from BSim database
        String getFunctionIdSql = "SELECT id FROM desctable WHERE name_func = ? AND id_exe = ?";

        try (PreparedStatement commentStmt = conn.prepareStatement(insertCommentSql);
             PreparedStatement funcIdStmt = conn.prepareStatement(getFunctionIdSql)) {

            while (functions.hasNext() && !monitor.isCancelled()) {
                Function function = functions.next();
                processedCount++;

                if (processedCount % 50 == 0) {
                    monitor.setMessage(String.format("Processing function %d: %s",
                        processedCount, function.getName()));
                }

                if (hasComments(program, function) || hasStringReferences(program, function)) {
                    // Get BSim function ID
                    funcIdStmt.setString(1, function.getName());
                    funcIdStmt.setInt(2, executableId);
                    ResultSet rs = funcIdStmt.executeQuery();

                    if (rs.next()) {
                        long functionId = rs.getLong("id");

                        // Extract and insert all comment types
                        commentCount += insertFunctionComments(commentStmt, program, function, functionId, userId);

                        // EFFICIENCY ENHANCEMENT: Also process string references while we have the function
                        processStringReferencesForFunction(conn, program, function, functionId, executableId);
                    }
                    rs.close();
                }
            }
        }

        if (monitor.isCancelled()) {
            println("Operation cancelled by user");
            return;
        }

        println(String.format("Processed %d functions, added %d comments to database",
            processedCount, commentCount));
    }

    private Integer getValidUserId(Connection conn) throws SQLException {
        // Try to find an existing user in auth_user table
        String findUserSql = "SELECT id FROM auth_user ORDER BY id LIMIT 1";
        try (PreparedStatement stmt = conn.prepareStatement(findUserSql)) {
            ResultSet rs = stmt.executeQuery();
            if (rs.next()) {
                int userId = rs.getInt("id");
                println("Using existing user_id: " + userId);
                return userId;
            }
        }
        
        // No user exists, create a system user for Ghidra imports
        println("No users found, creating 'ghidra_system' user...");
        String createUserSql = "INSERT INTO auth_user (password, is_superuser, username, first_name, last_name, email, is_staff, is_active, date_joined) " +
                               "VALUES ('!unusable', false, 'ghidra_system', 'Ghidra', 'System', 'ghidra@system.local', false, true, NOW()) " +
                               "RETURNING id";
        try (PreparedStatement stmt = conn.prepareStatement(createUserSql)) {
            ResultSet rs = stmt.executeQuery();
            if (rs.next()) {
                int userId = rs.getInt("id");
                println("Created ghidra_system user with id: " + userId);
                return userId;
            }
        }
        
        throw new SQLException("Failed to find or create a valid user for comments");
    }

    private int insertFunctionComments(PreparedStatement commentStmt, Program program, Function function, long functionId, Integer userId) throws SQLException {
        CodeUnit cu = program.getListing().getCodeUnitAt(function.getEntryPoint());
        if (cu == null) return 0;

        int insertedCount = 0;

        // Insert different comment types using Ghidra 11.4+ CommentType API
        String[] commentTypes = {"PLATE", "PRE", "POST", "EOL"};
        ghidra.program.model.listing.CommentType[] commentEnums = {
            ghidra.program.model.listing.CommentType.PLATE,
            ghidra.program.model.listing.CommentType.PRE,
            ghidra.program.model.listing.CommentType.POST,
            ghidra.program.model.listing.CommentType.EOL
        };

        for (int i = 0; i < commentTypes.length; i++) {
            String comment = cu.getComment(commentEnums[i]);
            if (comment != null && !comment.trim().isEmpty()) {

                // Clean and format comment
                String cleanComment = comment.trim();
                String htmlComment = convertToHtml(cleanComment);

                commentStmt.setString(1, cleanComment);
                commentStmt.setString(2, htmlComment);
                commentStmt.setString(3, "function");
                commentStmt.setLong(4, functionId);
                commentStmt.setString(5, function.getName() + "_" + commentTypes[i]);
                commentStmt.setInt(6, userId);  // user_id is required (NOT NULL)

                try {
                    int rowsAffected = commentStmt.executeUpdate();
                    if (rowsAffected > 0) {
                        insertedCount++;
                    }
                } catch (SQLException e) {
                    printerr("Error inserting comment for function " + function.getName() +
                            " (" + commentTypes[i] + "): " + e.getMessage());
                }
            }
        }

        return insertedCount;
    }

    private String convertToHtml(String comment) {
        // Basic HTML conversion for comment content
        return comment
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&#39;")
            .replace("\n", "<br>")
            .replace("\t", "&nbsp;&nbsp;&nbsp;&nbsp;");
    }

    /**
     * Check if function has string references for efficiency enhancement
     */
    private boolean hasStringReferences(Program program, Function function) {
        try {
            Listing listing = program.getListing();
            AddressSetView functionBody = function.getBody();

            InstructionIterator instructions = listing.getInstructions(functionBody, true);
            while (instructions.hasNext()) {
                Instruction instruction = instructions.next();
                for (int i = 0; i < instruction.getNumOperands(); i++) {
                    Reference[] refs = instruction.getOperandReferences(i);
                    for (Reference ref : refs) {
                        if (ref.getReferenceType().isData()) {
                            Data data = listing.getDataAt(ref.getToAddress());
                            if (data != null && data.hasStringValue()) {
                                return true;
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            // Ignore errors in string detection
        }
        return false;
    }

    /**
     * Process string references for a function during comment processing for efficiency
     */
    private void processStringReferencesForFunction(Connection conn, Program program,
                                                   Function function, long functionId, int executableId) {
        try {
            Listing listing = program.getListing();
            AddressSetView functionBody = function.getBody();

            String stringInsertSql = """
                INSERT INTO string_references (executable_id, string_address, string_content, string_length, encoding_type)
                VALUES (?, ?, ?, ?, 'UTF-8')
                ON CONFLICT (executable_id, string_address) DO NOTHING
                RETURNING id
                """;

            String funcStringInsertSql = """
                INSERT INTO function_string_refs (function_id, string_ref_id, usage_type, reference_count)
                VALUES (?, ?, 'direct_reference', 1)
                ON CONFLICT (function_id, string_ref_id)
                DO UPDATE SET reference_count = function_string_refs.reference_count + 1
                """;

            try (PreparedStatement stringStmt = conn.prepareStatement(stringInsertSql);
                 PreparedStatement funcStringStmt = conn.prepareStatement(funcStringInsertSql)) {

                InstructionIterator instructions = listing.getInstructions(functionBody, true);
                while (instructions.hasNext()) {
                    Instruction instruction = instructions.next();
                    for (int i = 0; i < instruction.getNumOperands(); i++) {
                        Reference[] refs = instruction.getOperandReferences(i);
                        for (Reference ref : refs) {
                            if (ref.getReferenceType().isData()) {
                                Data data = listing.getDataAt(ref.getToAddress());
                                if (data != null && data.hasStringValue()) {
                                    String stringValue = data.getDefaultValueRepresentation();
                                    if (stringValue != null && stringValue.length() > 2) {
                                        // Clean the string value
                                        stringValue = stringValue.substring(1, stringValue.length() - 1); // Remove quotes

                                        // Insert string reference and get ID
                                        stringStmt.setInt(1, executableId);
                                        stringStmt.setLong(2, ref.getToAddress().getOffset());
                                        stringStmt.setString(3, stringValue);
                                        stringStmt.setInt(4, stringValue.length());

                                        try (ResultSet rs = stringStmt.executeQuery()) {
                                            if (rs.next()) {
                                                int stringRefId = rs.getInt("id");

                                                // Link function to string
                                                funcStringStmt.setLong(1, functionId);
                                                funcStringStmt.setInt(2, stringRefId);
                                                funcStringStmt.executeUpdate();
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (SQLException e) {
            println("Note: Could not store string references for " + function.getName() + ": " + e.getMessage());
        }
    }
}