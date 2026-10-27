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
//Propagates FULL function documentation from reference program to matching functions via BSim.
//NO GUI - All configuration is preset. Supports headless execution.
//Copies: names, plate comments, repeatable comments, function signatures, data types, and tags.
//@category BSim
//@menupath Tools.BSim.Propagate Full Documentation
import java.io.FileWriter;
import java.io.PrintWriter;
import java.text.SimpleDateFormat;
import java.util.*;

import generic.lsh.vector.LSHVectorFactory;
import ghidra.app.cmd.function.ApplyFunctionSignatureCmd;
import ghidra.app.script.GhidraScript;
import ghidra.features.bsim.query.*;
import ghidra.features.bsim.query.BSimServerInfo.DBType;
import ghidra.features.bsim.query.FunctionDatabase.BSimError;
import ghidra.features.bsim.query.description.*;
import ghidra.features.bsim.query.protocol.*;
import ghidra.framework.model.DomainFile;
import ghidra.framework.model.DomainFolder;
import ghidra.framework.model.Project;
import ghidra.program.model.data.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.SourceType;
import ghidra.util.Msg;
import ghidra.util.exception.DuplicateNameException;
import ghidra.util.exception.InvalidInputException;

/**
 * Comprehensive BSim-based documentation propagation script.
 * 
 * NO GUI DIALOGS - All configuration is preset below.
 * Fully supports headless execution via analyzeHeadless.
 * 
 * Propagates from the currently open reference program to all matching
 * target programs in the BSim database.
 */
public class PropagateFullDocumentationScript extends GhidraScript {

    // ========================================================================
    // CONNECTION CONFIGURATION - Edit these values before running
    // ========================================================================
    private static final String DB_HOST = System.getenv().getOrDefault("BSIM_DB_HOST", "localhost");
    private static final int DB_PORT = 5432;
    private static final String DB_NAME = "bsim";
    private static final String DB_USERNAME = "ben";
    
    // ========================================================================
    // SIMILARITY THRESHOLDS
    // ========================================================================
    // Functions with similarity >= AUTO_THRESHOLD are automatically propagated
    private static final double AUTO_THRESHOLD = 0.85;  // 85%
    
    // Functions with similarity >= REVIEW_THRESHOLD but < AUTO_THRESHOLD get NEEDS_REVIEW tag
    private static final double REVIEW_THRESHOLD = 0.70;  // 70%
    
    // ========================================================================
    // PROPAGATION OPTIONS - What to propagate
    // ========================================================================
    private static final boolean PROPAGATE_NAMES = true;
    private static final boolean PROPAGATE_PLATE_COMMENTS = true;
    private static final boolean PROPAGATE_SIGNATURES = true;
    private static final boolean PROPAGATE_DATA_TYPES = true;
    private static final boolean PROPAGATE_TAGS = true;
    
    // Only rename functions that have default names (FUN_*)
    private static final boolean ONLY_RENAME_DEFAULT_NAMES = true;
    
    // Minimum function size in instructions (skip trivial functions)
    private static final int MIN_FUNCTION_SIZE = 5;
    
    // ========================================================================
    // OUTPUT OPTIONS
    // ========================================================================
    // Dry run mode - report only, no changes made
    private static final boolean DRY_RUN = false;
    
    // Target version filter (null = all versions)
    private static final String TARGET_VERSION_FILTER = null;
    
    // Output directory for reports (null = user home)
    private static final String REPORT_OUTPUT_DIR = null;

    // Statistics
    private PropagationStats stats = new PropagationStats();
    private List<PropagationResult> results = new ArrayList<>();
    private String referenceProgram;
    private String referenceVersion;

    @Override
    protected void run() throws Exception {
        if (currentProgram == null) {
            printerr("ERROR: No program is open. Open the REFERENCE (source) program first.");
            return;
        }

        referenceProgram = currentProgram.getName();

        println("=".repeat(70));
        println("BSIM FULL DOCUMENTATION PROPAGATION");
        println("=".repeat(70));
        println("");
        println("Reference Program: " + referenceProgram);
        println("Database: " + DB_HOST + ":" + DB_PORT + "/" + DB_NAME);
        println("");
        println("Thresholds:");
        println("  Auto-Apply: >= " + String.format("%.0f%%", AUTO_THRESHOLD * 100));
        println("  Review Queue: " + String.format("%.0f%%", REVIEW_THRESHOLD * 100) + " - " + 
                String.format("%.0f%%", AUTO_THRESHOLD * 100));
        println("");
        println("Propagation Options:");
        println("  Names: " + PROPAGATE_NAMES);
        println("  Plate Comments: " + PROPAGATE_PLATE_COMMENTS);
        println("  Signatures: " + PROPAGATE_SIGNATURES);
        println("  Data Types: " + PROPAGATE_DATA_TYPES);
        println("  Tags: " + PROPAGATE_TAGS);
        println("  Only Rename Defaults: " + ONLY_RENAME_DEFAULT_NAMES);
        println("");
        if (DRY_RUN) {
            println("*** DRY RUN MODE - No changes will be made ***");
            println("");
        }

        BSimServerInfo serverInfo = new BSimServerInfo(DBType.postgres, DB_USERNAME, DB_HOST, DB_PORT, DB_NAME);

        try (FunctionDatabase pgDatabase = BSimClientFactory.buildClient(serverInfo, false)) {

            if (!pgDatabase.initialize()) {
                BSimError lastError = pgDatabase.getLastError();
                String errorMsg = lastError != null ? lastError.message : "Unknown error";
                throw new Exception("Failed to connect to database: " + errorMsg);
            }

            DatabaseInformation dbInfo = pgDatabase.getInfo();
            if (dbInfo == null) {
                throw new Exception("Failed to retrieve database information.");
            }

            println("Connected to BSim database: " + DB_NAME);

            // Get target executables from database
            Set<String> targetExecutables = getTargetExecutables(pgDatabase);
            if (targetExecutables.isEmpty()) {
                println("No target executables found in database.");
                return;
            }

            println("Target executables: " + targetExecutables.size());

            LSHVectorFactory vectorFactory = pgDatabase.getLSHVectorFactory();

            // Collect documented reference functions
            List<Function> refFunctions = collectDocumentedFunctions();
            if (refFunctions.isEmpty()) {
                println("No documented functions found in reference program.");
                return;
            }

            println("Documented reference functions: " + refFunctions.size());
            stats.totalSourceFunctions = refFunctions.size();

            // Process functions and find matches
            println("");
            println("Querying BSim for similar functions...");
            monitor.initialize(refFunctions.size());

            GenSignatures gensig = new GenSignatures(dbInfo.trackcallgraph);
            gensig.setVectorFactory(vectorFactory);
            gensig.addExecutableCategories(dbInfo.execats);
            gensig.addFunctionTags(dbInfo.functionTags);
            gensig.openProgram(currentProgram, null, null, null, null, null);

            Map<String, List<FunctionMatch>> matchesByTarget = new HashMap<>();

            int processed = 0;
            for (Function func : refFunctions) {
                if (monitor.isCancelled()) {
                    break;
                }
                monitor.setProgress(processed++);
                monitor.setMessage("Analyzing: " + func.getName());

                try {
                    List<FunctionMatch> matches = findMatches(func, gensig, pgDatabase, targetExecutables);
                    for (FunctionMatch match : matches) {
                        matchesByTarget.computeIfAbsent(match.targetExecutable, k -> new ArrayList<>()).add(match);
                    }
                } catch (Exception e) {
                    Msg.warn(this, "Error processing " + func.getName() + ": " + e.getMessage());
                }
            }

            gensig.dispose();

            int totalMatches = matchesByTarget.values().stream().mapToInt(List::size).sum();
            println("Total matches found: " + totalMatches);
            stats.totalMatches = totalMatches;

            // Propagate to target programs
            if (!matchesByTarget.isEmpty() && !DRY_RUN) {
                println("");
                println("Propagating documentation to target programs...");
                propagateToTargets(matchesByTarget);
            }

            // Generate reports
            String timestamp = new SimpleDateFormat("yyyyMMdd_HHmmss").format(new Date());
            String basePath = (REPORT_OUTPUT_DIR != null ? REPORT_OUTPUT_DIR : System.getProperty("user.home")) 
                + "/bsim_propagation_" + timestamp;

            String summaryReport = generateSummaryReport();
            String detailedReport = generateDetailedReport();

            saveReport(basePath + "_summary.txt", summaryReport);
            saveReport(basePath + "_detailed.csv", detailedReport);

            println("");
            println(summaryReport);
            println("");
            println("Reports saved to: " + basePath + "_*.txt/csv");
        }
    }

    private Set<String> getTargetExecutables(FunctionDatabase pgDatabase) throws Exception {
        Set<String> targets = new HashSet<>();

        QueryExeInfo exeQuery = new QueryExeInfo();
        exeQuery.filterMd5 = "";
        exeQuery.filterExeName = "";
        exeQuery.filterArch = "";
        exeQuery.filterCompilerName = "";
        exeQuery.includeFakes = false;
        exeQuery.limit = 1000;

        ResponseExe exeResponse = exeQuery.execute(pgDatabase);
        if (exeResponse != null && exeResponse.records != null) {
            for (ExecutableRecord exe : exeResponse.records) {
                String exeName = exe.getNameExec();

                if (exeName.equals(referenceProgram)) {
                    String version = exe.getExeCategoryAlphabetic("Version");
                    if (version != null && !version.isEmpty()) {
                        referenceVersion = version;
                    }
                    continue;
                }

                if (TARGET_VERSION_FILTER != null) {
                    String version = exe.getExeCategoryAlphabetic("Version");
                    if (version == null || !version.equals(TARGET_VERSION_FILTER)) {
                        continue;
                    }
                }

                targets.add(exeName);
            }
        }

        return targets;
    }

    private List<Function> collectDocumentedFunctions() {
        List<Function> functions = new ArrayList<>();
        FunctionIterator funcIter = currentProgram.getFunctionManager().getFunctions(true);

        while (funcIter.hasNext()) {
            Function func = funcIter.next();
            if (func.isThunk() || func.isExternal()) {
                continue;
            }

            long size = func.getBody().getNumAddresses();
            if (size < MIN_FUNCTION_SIZE) {
                continue;
            }

            if (isDocumentedFunction(func)) {
                functions.add(func);
            }
        }

        return functions;
    }

    private boolean isDocumentedFunction(Function func) {
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

    private List<FunctionMatch> findMatches(Function func, GenSignatures gensig, 
            FunctionDatabase pgDatabase, Set<String> targetExecutables) throws Exception {
        
        List<FunctionMatch> matches = new ArrayList<>();

        DescriptionManager manager = gensig.getDescriptionManager();
        manager.clear();
        gensig.scanFunction(func);

        if (manager.numFunctions() == 0) {
            return matches;
        }

        QueryNearest queryNearest = new QueryNearest();
        queryNearest.manage = manager;
        queryNearest.max = 50;
        queryNearest.thresh = REVIEW_THRESHOLD;
        queryNearest.signifthresh = 0.0;

        ResponseNearest response = queryNearest.execute(pgDatabase);
        if (response == null) {
            return matches;
        }

        Map<String, FunctionMatch> bestByTarget = new HashMap<>();

        for (SimilarityResult simResult : response.result) {
            Iterator<SimilarityNote> noteIter = simResult.iterator();
            while (noteIter.hasNext()) {
                SimilarityNote note = noteIter.next();
                FunctionDescription matchFunc = note.getFunctionDescription();
                ExecutableRecord matchExe = matchFunc.getExecutableRecord();
                String exeName = matchExe.getNameExec();

                if (!targetExecutables.contains(exeName)) {
                    continue;
                }

                double similarity = note.getSimilarity();

                FunctionMatch existing = bestByTarget.get(exeName);
                if (existing == null || similarity > existing.similarity) {
                    FunctionMatch match = new FunctionMatch();
                    match.sourceFunction = func;
                    match.sourceName = func.getName();
                    match.sourceAddress = func.getEntryPoint().toString();
                    match.targetExecutable = exeName;
                    match.targetName = matchFunc.getFunctionName();
                    match.targetAddress = matchFunc.getAddress();
                    match.similarity = similarity;
                    match.confidence = note.getSignificance();
                    match.autoApply = similarity >= AUTO_THRESHOLD;
                    match.needsReview = similarity >= REVIEW_THRESHOLD && similarity < AUTO_THRESHOLD;

                    bestByTarget.put(exeName, match);
                }
            }
        }

        matches.addAll(bestByTarget.values());
        return matches;
    }

    private void propagateToTargets(Map<String, List<FunctionMatch>> matchesByTarget) throws Exception {
        Project project = state.getProject();
        if (project == null) {
            Msg.warn(this, "No project available for propagation");
            return;
        }

        List<DomainFile> programFiles = new ArrayList<>();
        collectProgramFiles(project.getProjectData().getRootFolder(), programFiles);

        for (DomainFile dFile : programFiles) {
            String fileName = dFile.getName();
            List<FunctionMatch> matches = matchesByTarget.get(fileName);

            if (matches == null || matches.isEmpty()) {
                continue;
            }

            monitor.setMessage("Propagating to: " + fileName);
            Program targetProgram = null;

            try {
                targetProgram = (Program) dFile.getDomainObject(this, true, false, monitor);

                int txId = targetProgram.startTransaction("BSim Full Documentation Propagation");
                try {
                    for (FunctionMatch match : matches) {
                        propagateDocumentation(match, targetProgram);
                    }
                    targetProgram.endTransaction(txId, true);
                } catch (Exception e) {
                    targetProgram.endTransaction(txId, false);
                    throw e;
                }

                dFile.save(monitor);
                stats.programsModified++;

            } catch (Exception e) {
                Msg.error(this, "Error processing " + fileName + ": " + e.getMessage(), e);
            } finally {
                if (targetProgram != null) {
                    targetProgram.release(this);
                }
            }
        }
    }

    private void propagateDocumentation(FunctionMatch match, Program targetProgram) {
        PropagationResult result = new PropagationResult();
        result.match = match;
        results.add(result);

        try {
            Function targetFunc = targetProgram.getFunctionManager()
                .getFunctionAt(targetProgram.getAddressFactory()
                    .getDefaultAddressSpace().getAddress(match.targetAddress));

            if (targetFunc == null) {
                result.error = "Target function not found";
                return;
            }

            Function sourceFunc = match.sourceFunction;

            // 1. Propagate Name
            if (PROPAGATE_NAMES && !isDefaultName(sourceFunc.getName())) {
                boolean shouldRename = !ONLY_RENAME_DEFAULT_NAMES || isDefaultName(targetFunc.getName());
                if (shouldRename && !targetFunc.getName().equals(sourceFunc.getName())) {
                    try {
                        targetFunc.setName(sourceFunc.getName(), SourceType.IMPORTED);
                        result.nameApplied = true;
                        stats.namesApplied++;
                    } catch (DuplicateNameException | InvalidInputException e) {
                        try {
                            String newName = sourceFunc.getName() + "_" + Long.toHexString(match.targetAddress);
                            targetFunc.setName(newName, SourceType.IMPORTED);
                            result.nameApplied = true;
                            stats.namesApplied++;
                        } catch (Exception e2) {
                            Msg.warn(this, "Could not rename: " + e2.getMessage());
                        }
                    }
                }
            }

            // 2. Propagate Plate Comment
            if (PROPAGATE_PLATE_COMMENTS) {
                String plateComment = sourceFunc.getComment();
                if (plateComment != null && !plateComment.isEmpty()) {
                    String existing = targetFunc.getComment();
                    if (existing == null || existing.isEmpty()) {
                        targetFunc.setComment(plateComment);
                        result.plateCommentApplied = true;
                        stats.plateCommentsApplied++;
                    } else if (!existing.contains(plateComment)) {
                        targetFunc.setComment(existing + "\n\n[Propagated from " + 
                            referenceProgram + "]\n" + plateComment);
                        result.plateCommentApplied = true;
                        stats.plateCommentsApplied++;
                    }
                }

                String repeatableComment = sourceFunc.getRepeatableComment();
                if (repeatableComment != null && !repeatableComment.isEmpty()) {
                    String existing = targetFunc.getRepeatableComment();
                    if (existing == null || existing.isEmpty()) {
                        targetFunc.setRepeatableComment(repeatableComment);
                        result.repeatableCommentApplied = true;
                        stats.repeatableCommentsApplied++;
                    }
                }
            }

            // 3. Propagate Data Types (before signature)
            if (PROPAGATE_DATA_TYPES) {
                int typesCopied = propagateDataTypesForFunction(sourceFunc, targetProgram);
                result.dataTypesCopied = typesCopied;
                stats.dataTypesCopied += typesCopied;
            }

            // 4. Propagate Function Signature
            if (PROPAGATE_SIGNATURES) {
                try {
                    FunctionSignature sourceSig = sourceFunc.getSignature();
                    ApplyFunctionSignatureCmd cmd = new ApplyFunctionSignatureCmd(
                        targetFunc.getEntryPoint(),
                        sourceSig,
                        SourceType.IMPORTED
                    );
                    if (cmd.applyTo(targetProgram)) {
                        result.signatureApplied = true;
                        stats.signaturesApplied++;
                    }
                } catch (Exception e) {
                    Msg.warn(this, "Could not apply signature: " + e.getMessage());
                }
            }

            // 5. Propagate Function Tags
            if (PROPAGATE_TAGS) {
                int tagsApplied = propagateFunctionTags(sourceFunc, targetFunc, targetProgram);
                result.tagsApplied = tagsApplied;
                stats.tagsApplied += tagsApplied;

                // Add PROPAGATED tag
                try {
                    FunctionTagManager tagMgr = targetProgram.getFunctionManager().getFunctionTagManager();
                    FunctionTag propagatedTag = tagMgr.getFunctionTag("PROPAGATED");
                    if (propagatedTag == null) {
                        propagatedTag = tagMgr.createFunctionTag("PROPAGATED", 
                            "Function received documentation via BSim propagation");
                    }
                    targetFunc.addTag(propagatedTag.getName());
                } catch (Exception e) {
                    // Tag might not be supported
                }

                // Add NEEDS_REVIEW tag if in review range
                if (match.needsReview) {
                    try {
                        FunctionTagManager tagMgr = targetProgram.getFunctionManager().getFunctionTagManager();
                        FunctionTag reviewTag = tagMgr.getFunctionTag("NEEDS_REVIEW");
                        if (reviewTag == null) {
                            reviewTag = tagMgr.createFunctionTag("NEEDS_REVIEW", 
                                "Function needs manual review after propagation");
                        }
                        targetFunc.addTag(reviewTag.getName());
                    } catch (Exception e) {
                        // Tag might not be supported
                    }
                }
            }

            result.success = true;

        } catch (Exception e) {
            result.error = e.getMessage();
            Msg.warn(this, "Error propagating to " + match.targetExecutable + ": " + e.getMessage());
        }
    }

    private int propagateDataTypesForFunction(Function sourceFunc, Program targetProgram) {
        int typesCopied = 0;
        DataTypeManager targetDtm = targetProgram.getDataTypeManager();

        Set<DataType> typesToCopy = new HashSet<>();

        DataType returnType = sourceFunc.getReturnType();
        collectDataTypes(returnType, typesToCopy);

        for (Parameter param : sourceFunc.getParameters()) {
            collectDataTypes(param.getDataType(), typesToCopy);
        }

        for (Variable local : sourceFunc.getLocalVariables()) {
            collectDataTypes(local.getDataType(), typesToCopy);
        }

        for (DataType dt : typesToCopy) {
            try {
                if (dt instanceof BuiltInDataType) {
                    continue;
                }
                DataType existing = targetDtm.getDataType(dt.getCategoryPath(), dt.getName());
                if (existing != null) {
                    continue;
                }

                targetDtm.resolve(dt, DataTypeConflictHandler.REPLACE_HANDLER);
                typesCopied++;
            } catch (Exception e) {
                Msg.warn(this, "Could not copy type " + dt.getName() + ": " + e.getMessage());
            }
        }

        return typesCopied;
    }

    private void collectDataTypes(DataType dt, Set<DataType> types) {
        if (dt == null || dt instanceof BuiltInDataType) {
            return;
        }

        if (dt instanceof Pointer) {
            collectDataTypes(((Pointer) dt).getDataType(), types);
            return;
        }

        if (dt instanceof Array) {
            collectDataTypes(((Array) dt).getDataType(), types);
            return;
        }

        if (dt instanceof TypeDef) {
            types.add(dt);
            collectDataTypes(((TypeDef) dt).getBaseDataType(), types);
            return;
        }

        if (dt instanceof Structure) {
            types.add(dt);
            Structure struct = (Structure) dt;
            for (DataTypeComponent comp : struct.getComponents()) {
                collectDataTypes(comp.getDataType(), types);
            }
            return;
        }

        if (dt instanceof ghidra.program.model.data.Enum) {
            types.add(dt);
            return;
        }

        if (dt instanceof FunctionDefinition) {
            types.add(dt);
            FunctionDefinition funcDef = (FunctionDefinition) dt;
            collectDataTypes(funcDef.getReturnType(), types);
            for (ParameterDefinition param : funcDef.getArguments()) {
                collectDataTypes(param.getDataType(), types);
            }
            return;
        }

        types.add(dt);
    }

    private int propagateFunctionTags(Function sourceFunc, Function targetFunc, Program targetProgram) {
        int tagsApplied = 0;

        try {
            FunctionTagManager targetTagMgr = targetProgram.getFunctionManager().getFunctionTagManager();

            for (FunctionTag sourceTag : sourceFunc.getTags()) {
                String tagName = sourceTag.getName();

                FunctionTag targetTag = targetTagMgr.getFunctionTag(tagName);
                if (targetTag == null) {
                    String comment = sourceTag.getComment();
                    targetTag = targetTagMgr.createFunctionTag(tagName, comment != null ? comment : "");
                }

                if (!targetFunc.getTags().contains(targetTag)) {
                    targetFunc.addTag(tagName);
                    tagsApplied++;
                }
            }
        } catch (Exception e) {
            Msg.warn(this, "Could not propagate tags: " + e.getMessage());
        }

        return tagsApplied;
    }

    private void collectProgramFiles(DomainFolder folder, List<DomainFile> programFiles) {
        for (DomainFile file : folder.getFiles()) {
            if (file.getContentType().equals("Program")) {
                programFiles.add(file);
            }
        }
        for (DomainFolder subfolder : folder.getFolders()) {
            collectProgramFiles(subfolder, programFiles);
        }
    }

    private void saveReport(String path, String content) throws Exception {
        try (PrintWriter pw = new PrintWriter(new FileWriter(path))) {
            pw.print(content);
        }
    }

    private String generateSummaryReport() {
        StringBuilder sb = new StringBuilder();
        sb.append("=".repeat(70)).append("\n");
        sb.append("BSim FULL DOCUMENTATION PROPAGATION REPORT\n");
        sb.append("=".repeat(70)).append("\n\n");

        sb.append("Generated: ").append(new Date()).append("\n");
        sb.append("Reference Program: ").append(referenceProgram);
        if (referenceVersion != null) {
            sb.append(" (Version: ").append(referenceVersion).append(")");
        }
        sb.append("\n");
        sb.append("Dry Run: ").append(DRY_RUN).append("\n\n");

        sb.append("Thresholds:\n");
        sb.append("  Auto-Apply: >= ").append(String.format("%.0f%%", AUTO_THRESHOLD * 100)).append("\n");
        sb.append("  Review Queue: ").append(String.format("%.0f%%", REVIEW_THRESHOLD * 100));
        sb.append(" - ").append(String.format("%.0f%%", AUTO_THRESHOLD * 100)).append("\n\n");

        sb.append("Statistics:\n");
        sb.append("  Source Functions Analyzed: ").append(stats.totalSourceFunctions).append("\n");
        sb.append("  Total Matches Found: ").append(stats.totalMatches).append("\n");
        sb.append("  Programs Modified: ").append(stats.programsModified).append("\n\n");

        sb.append("Propagation Results:\n");
        sb.append("  Names Applied: ").append(stats.namesApplied).append("\n");
        sb.append("  Plate Comments Applied: ").append(stats.plateCommentsApplied).append("\n");
        sb.append("  Repeatable Comments Applied: ").append(stats.repeatableCommentsApplied).append("\n");
        sb.append("  Signatures Applied: ").append(stats.signaturesApplied).append("\n");
        sb.append("  Data Types Copied: ").append(stats.dataTypesCopied).append("\n");
        sb.append("  Tags Applied: ").append(stats.tagsApplied).append("\n\n");

        sb.append("=".repeat(70)).append("\n");

        return sb.toString();
    }

    private String generateDetailedReport() {
        StringBuilder sb = new StringBuilder();
        sb.append("source_name,source_address,target_executable,target_name,target_address,");
        sb.append("similarity,auto_apply,name_applied,plate_comment,signature,data_types,tags,error\n");

        for (PropagationResult result : results) {
            FunctionMatch m = result.match;
            sb.append(csvEscape(m.sourceName)).append(",");
            sb.append(m.sourceAddress).append(",");
            sb.append(csvEscape(m.targetExecutable)).append(",");
            sb.append(csvEscape(m.targetName)).append(",");
            sb.append("0x").append(Long.toHexString(m.targetAddress)).append(",");
            sb.append(String.format("%.3f", m.similarity)).append(",");
            sb.append(m.autoApply).append(",");
            sb.append(result.nameApplied).append(",");
            sb.append(result.plateCommentApplied).append(",");
            sb.append(result.signatureApplied).append(",");
            sb.append(result.dataTypesCopied).append(",");
            sb.append(result.tagsApplied).append(",");
            sb.append(csvEscape(result.error != null ? result.error : "")).append("\n");
        }

        return sb.toString();
    }

    private String csvEscape(String s) {
        if (s == null) return "";
        if (s.contains(",") || s.contains("\"") || s.contains("\n")) {
            return "\"" + s.replace("\"", "\"\"") + "\"";
        }
        return s;
    }

    // Helper classes
    private static class FunctionMatch {
        Function sourceFunction;
        String sourceName;
        String sourceAddress;
        String targetExecutable;
        String targetName;
        long targetAddress;
        double similarity;
        double confidence;
        boolean autoApply;
        boolean needsReview;
    }

    private static class PropagationResult {
        FunctionMatch match;
        boolean success;
        boolean nameApplied;
        boolean plateCommentApplied;
        boolean repeatableCommentApplied;
        boolean signatureApplied;
        int dataTypesCopied;
        int tagsApplied;
        String error;
    }

    private static class PropagationStats {
        int totalSourceFunctions;
        int totalMatches;
        int programsModified;
        int namesApplied;
        int plateCommentsApplied;
        int repeatableCommentsApplied;
        int signaturesApplied;
        int dataTypesCopied;
        int tagsApplied;
    }
}
