// UTILITY: Analyze Duplicate Hashes (QUALITY ASSURANCE TOOL)
//
// Quality assurance utility that identifies duplicate binaries in the project by MD5 hash
// analysis. Helps ensure data integrity and identifies potential issues with binary
// collections before processing through the main BSim workflow.
//
// DUPLICATE DETECTION:
// - Calculates MD5 hashes for all binaries in the current project
// - Identifies exact duplicates that may cause analysis issues
// - Reports duplicate groups with file paths and hash values
// - Provides statistics on collection uniqueness
//
// QUALITY ASSURANCE VALUE:
// - Prevents duplicate function signatures that skew similarity analysis
// - Identifies collection organization issues (same binary in multiple locations)
// - Helps validate binary ingestion processes
// - Supports cleanup operations before main analysis
//
// USAGE RECOMMENDATIONS:
// - Run before Step1 to validate binary collection quality
// - Use periodically to maintain clean project organization
// - Review results to remove unnecessary duplicates
//
// OUTPUT:
// - Detailed duplicate groups report
// - Summary statistics of collection uniqueness
// - Recommendations for cleanup actions
//
//@category BSim
//@menupath Tools.BSim.Utilities.Analyze Duplicate Hashes

import java.util.*;
import ghidra.app.script.GhidraScript;
import ghidra.framework.model.*;
import ghidra.program.model.listing.Program;

public class Utility_AnalyzeDuplicateHashes extends GhidraScript {

    // Map of MD5 -> list of program paths with that hash
    private Map<String, List<String>> hashToPrograms = new HashMap<>();
    private int totalPrograms = 0;
    private int programsWithHash = 0;

    @Override
    protected void run() throws Exception {
        println("=".repeat(80));
        println("DUPLICATE HASH ANALYSIS");
        println("Scanning all programs in project for duplicate MD5 hashes...");
        println("=".repeat(80));
        
        // Get the project root folder
        Project project = state.getProject();
        if (project == null) {
            println("ERROR: No project open");
            return;
        }
        
        ProjectData projectData = project.getProjectData();
        DomainFolder rootFolder = projectData.getRootFolder();
        
        // Recursively scan all programs
        scanFolder(rootFolder);
        
        println("");
        println("=".repeat(80));
        println("SCAN COMPLETE");
        println("=".repeat(80));
        println("Total programs scanned: " + totalPrograms);
        println("Programs with valid MD5: " + programsWithHash);
        println("Unique MD5 hashes: " + hashToPrograms.size());
        println("");
        
        // Find and report duplicates
        int duplicateSets = 0;
        int totalDuplicates = 0;
        
        // Sort by number of duplicates (descending)
        List<Map.Entry<String, List<String>>> sortedEntries = new ArrayList<>(hashToPrograms.entrySet());
        sortedEntries.sort((a, b) -> Integer.compare(b.getValue().size(), a.getValue().size()));
        
        println("=".repeat(80));
        println("DUPLICATE GROUPS (same MD5 hash = identical binary content)");
        println("=".repeat(80));
        
        for (Map.Entry<String, List<String>> entry : sortedEntries) {
            List<String> programs = entry.getValue();
            if (programs.size() > 1) {
                duplicateSets++;
                totalDuplicates += programs.size();
                
                println("");
                println("MD5: " + entry.getKey() + " (" + programs.size() + " copies)");
                println("-".repeat(60));
                
                // Group by binary name to show which versions share the same binary
                Map<String, List<String>> byName = new HashMap<>();
                for (String path : programs) {
                    String name = path.substring(path.lastIndexOf('/') + 1);
                    byName.computeIfAbsent(name, k -> new ArrayList<>()).add(path);
                }
                
                for (Map.Entry<String, List<String>> nameEntry : byName.entrySet()) {
                    for (String path : nameEntry.getValue()) {
                        // Extract version info from path
                        String versionInfo = extractVersionFromPath(path);
                        println("  " + versionInfo + " -> " + path);
                    }
                }
            }
        }
        
        println("");
        println("=".repeat(80));
        println("SUMMARY");
        println("=".repeat(80));
        println("Total programs: " + totalPrograms);
        println("Unique binaries (by MD5): " + hashToPrograms.size());
        println("Duplicate sets: " + duplicateSets);
        println("Programs that are duplicates: " + totalDuplicates);
        println("Truly unique (no duplicates): " + (hashToPrograms.size() - duplicateSets + 
                hashToPrograms.entrySet().stream().filter(e -> e.getValue().size() == 1).count()));
        
        // Analyze platform overlap
        println("");
        println("=".repeat(80));
        println("PLATFORM OVERLAP ANALYSIS");
        println("=".repeat(80));
        
        int classicLodShared = 0;
        int classicOnly = 0;
        int lodOnly = 0;
        
        for (Map.Entry<String, List<String>> entry : hashToPrograms.entrySet()) {
            List<String> programs = entry.getValue();
            boolean hasClassic = programs.stream().anyMatch(p -> p.contains("/Classic/"));
            boolean hasLoD = programs.stream().anyMatch(p -> p.contains("/LoD/"));
            
            if (hasClassic && hasLoD) {
                classicLodShared++;
            } else if (hasClassic) {
                classicOnly++;
            } else if (hasLoD) {
                lodOnly++;
            }
        }
        
        println("Binaries shared between Classic and LoD: " + classicLodShared);
        println("Binaries only in Classic: " + classicOnly);
        println("Binaries only in LoD: " + lodOnly);
        
        // Show which specific binaries are shared across Classic/LoD
        println("");
        println("=".repeat(80));
        println("CLASSIC/LOD SHARED BINARIES (same hash in both platforms)");
        println("=".repeat(80));
        
        for (Map.Entry<String, List<String>> entry : sortedEntries) {
            List<String> programs = entry.getValue();
            boolean hasClassic = programs.stream().anyMatch(p -> p.contains("/Classic/"));
            boolean hasLoD = programs.stream().anyMatch(p -> p.contains("/LoD/"));
            
            if (hasClassic && hasLoD) {
                println("");
                println("MD5: " + entry.getKey());
                
                // Group by platform
                List<String> classicPaths = new ArrayList<>();
                List<String> lodPaths = new ArrayList<>();
                
                for (String path : programs) {
                    if (path.contains("/Classic/")) {
                        classicPaths.add(path);
                    } else if (path.contains("/LoD/")) {
                        lodPaths.add(path);
                    }
                }
                
                println("  Classic versions:");
                for (String p : classicPaths) {
                    println("    " + extractVersionFromPath(p));
                }
                println("  LoD versions:");
                for (String p : lodPaths) {
                    println("    " + extractVersionFromPath(p));
                }
            }
        }
        
        println("");
        println("=".repeat(80));
        println("ANALYSIS COMPLETE");
        println("=".repeat(80));
    }
    
    private void scanFolder(DomainFolder folder) throws Exception {
        if (monitor.isCancelled()) return;
        
        // Process files in this folder
        for (DomainFile file : folder.getFiles()) {
            if (monitor.isCancelled()) return;
            
            // Only process program files
            String contentType = file.getContentType();
            if (contentType != null && contentType.equals("Program")) {
                processProgram(file);
            }
        }
        
        // Recurse into subfolders
        for (DomainFolder subfolder : folder.getFolders()) {
            if (monitor.isCancelled()) return;
            scanFolder(subfolder);
        }
    }
    
    private void processProgram(DomainFile file) {
        totalPrograms++;
        String path = file.getPathname();
        
        try {
            // Open program read-only to get MD5
            Program program = (Program) file.getDomainObject(this, false, false, monitor);
            try {
                String md5 = program.getExecutableMD5();
                if (md5 != null && !md5.isEmpty()) {
                    programsWithHash++;
                    hashToPrograms.computeIfAbsent(md5, k -> new ArrayList<>()).add(path);
                } else {
                    println("WARNING: No MD5 for " + path);
                }
            } finally {
                program.release(this);
            }
        } catch (Exception e) {
            println("ERROR reading " + path + ": " + e.getMessage());
        }
        
        if (totalPrograms % 50 == 0) {
            println("  Scanned " + totalPrograms + " programs...");
        }
    }
    
    private String extractVersionFromPath(String path) {
        // Path format: /Platform/Version/Binary.dll
        String[] parts = path.split("/");
        if (parts.length >= 3) {
            // Find version (looks like 1.00, 1.07, 1.10, etc.)
            for (int i = 0; i < parts.length - 1; i++) {
                if (parts[i].matches("\\d+\\.\\d+[a-z]?")) {
                    String platform = (i > 0) ? parts[i-1] : "";
                    return platform + "/" + parts[i];
                }
            }
        }
        return path;
    }
}
