// Cross-Version Matrix API
// Provides data access methods for matrix visualization and interactive analysis
// @author Ben Ethington
// @category Diablo 2

import ghidra.app.script.GhidraScript;
import java.sql.*;
import java.util.*;
import java.util.stream.Collectors;

public class CrossVersionMatrixAPI extends GhidraScript {

    private static final String DB_URL = "jdbc:postgresql://"
        + System.getenv().getOrDefault("BSIM_DB_HOST", "localhost") + ":"
        + System.getenv().getOrDefault("BSIM_DB_PORT", "5432") + "/"
        + System.getenv().getOrDefault("BSIM_DB_NAME", "bsim");
    private static final String DB_USER = System.getenv().getOrDefault("BSIM_DB_USER", "bsim_user");
    private static final String DB_PASS = System.getenv().getOrDefault("BSIM_DB_PASSWORD", "");

    @Override
    public void run() throws Exception {
        println("=== Cross-Version Matrix API Demo ===");

        try (Connection conn = DriverManager.getConnection(DB_URL, DB_USER, DB_PASS)) {

            // Demo: Get available versions
            List<VersionInfo> versions = getAvailableVersions(conn);
            println("Available versions:");
            versions.forEach(v -> println("  " + v.toString()));

            // Demo: Get available binaries for a version
            if (!versions.isEmpty()) {
                String testVersion = versions.get(0).version;
                List<BinaryInfo> binaries = getAvailableBinaries(conn, testVersion);
                println("\\nBinaries for " + testVersion + ":");
                binaries.forEach(b -> println("  " + b.toString()));

                // Demo: Get function matrix for a binary
                if (!binaries.isEmpty()) {
                    String testBinary = binaries.get(0).binaryName;
                    MatrixData matrix = getFunctionMatrix(conn, testVersion, testBinary);
                    println("\\nFunction matrix for " + testBinary + " (" + testVersion + "):");
                    println("  Functions: " + matrix.functions.size());
                    println("  Versions: " + matrix.targetVersions.size());
                }
            }

        } catch (SQLException e) {
            printerr("Database error: " + e.getMessage());
        }
    }

    /**
     * Get all available versions in the database
     */
    public List<VersionInfo> getAvailableVersions(Connection conn) throws SQLException {
        String sql = """
            SELECT DISTINCT
                game_version,
                family_type,
                COUNT(*) as binary_count
            FROM exetable
            WHERE game_version IS NOT NULL
            GROUP BY game_version, family_type
            ORDER BY
                CASE family_type
                    WHEN 'Classic' THEN 1
                    WHEN 'LoD' THEN 2
                    WHEN 'PD2' THEN 3
                    ELSE 4
                END,
                game_version
        """;

        List<VersionInfo> versions = new ArrayList<>();
        try (PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {

            while (rs.next()) {
                VersionInfo version = new VersionInfo();
                version.version = rs.getString("game_version");
                version.family = rs.getString("family_type");
                version.binaryCount = rs.getInt("binary_count");
                versions.add(version);
            }
        }

        return versions;
    }

    /**
     * Get available binaries for a specific version
     */
    public List<BinaryInfo> getAvailableBinaries(Connection conn, String version) throws SQLException {
        String sql = """
            SELECT
                id,
                name_exec as binary_name,
                family_type,
                COUNT(d.id) as function_count
            FROM exetable e
            LEFT JOIN desctable d ON d.id_exe = e.id
            WHERE e.game_version = ?
            GROUP BY e.id, e.name_exec, e.family_type
            ORDER BY e.name_exec
        """;

        List<BinaryInfo> binaries = new ArrayList<>();
        try (PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setString(1, version);

            try (ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    BinaryInfo binary = new BinaryInfo();
                    binary.id = rs.getInt("id");
                    binary.binaryName = rs.getString("binary_name");
                    binary.family = rs.getString("family_type");
                    binary.functionCount = rs.getInt("function_count");
                    binaries.add(binary);
                }
            }
        }

        return binaries;
    }

    /**
     * Get function matrix data for visualization
     */
    public MatrixData getFunctionMatrix(Connection conn, String sourceVersion, String sourceBinary) throws SQLException {
        MatrixData matrix = new MatrixData();
        matrix.sourceVersion = sourceVersion;
        matrix.sourceBinary = sourceBinary;

        // Get all functions from the source binary
        String functionsSql = """
            SELECT
                f.id,
                f.name_func,
                f.addr,
                fa.is_library_function,
                fa.cyclomatic_complexity,
                ARRAY_AGG(DISTINCT ft.tag_value ORDER BY ft.tag_value) as tags
            FROM desctable f
            JOIN exetable e ON f.id_exe = e.id
            LEFT JOIN function_analysis fa ON fa.function_id = f.id
            LEFT JOIN function_tags ft ON ft.function_id = f.id
            WHERE e.game_version = ? AND e.name_exec = ?
            GROUP BY f.id, f.name_func, f.addr, fa.is_library_function, fa.cyclomatic_complexity
            ORDER BY f.addr
        """;

        try (PreparedStatement stmt = conn.prepareStatement(functionsSql)) {
            stmt.setString(1, sourceVersion);
            stmt.setString(2, sourceBinary);

            try (ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    FunctionInfo func = new FunctionInfo();
                    func.id = rs.getInt("id");
                    func.name = rs.getString("name_func");
                    func.address = String.format("0x%X", rs.getLong("addr"));
                    func.isLibrary = rs.getBoolean("is_library_function");
                    func.complexity = rs.getInt("cyclomatic_complexity");

                    // Parse tags array
                    Array tagsArray = rs.getArray("tags");
                    if (tagsArray != null) {
                        String[] tags = (String[]) tagsArray.getArray();
                        func.tags = Arrays.asList(tags);
                    } else {
                        func.tags = new ArrayList<>();
                    }

                    matrix.functions.add(func);
                }
            }
        }

        // Get all target versions for cross-version analysis
        matrix.targetVersions = getAvailableVersions(conn);

        // Get similarity data for the matrix
        matrix.similarities = getSimilarityData(conn, sourceVersion, sourceBinary);

        return matrix;
    }

    /**
     * Get similarity data for matrix visualization
     */
    private Map<String, Map<String, SimilarityInfo>> getSimilarityData(Connection conn, String sourceVersion, String sourceBinary) throws SQLException {
        String sql = """
            SELECT
                f1.name_func as function_name,
                f1.addr as function_addr,
                e2.game_version as target_version,
                e2.name_exec as target_binary,
                sm.similarity_score,
                sm.match_type,
                sm.confidence_level
            FROM desctable f1
            JOIN exetable e1 ON f1.id_exe = e1.id
            LEFT JOIN similarity_matrix sm ON sm.source_function_id = f1.id
            LEFT JOIN desctable f2 ON sm.target_function_id = f2.id
            LEFT JOIN exetable e2 ON f2.id_exe = e2.id
            WHERE e1.game_version = ? AND e1.name_exec = ?
            AND sm.similarity_score IS NOT NULL
        """;

        Map<String, Map<String, SimilarityInfo>> similarities = new HashMap<>();

        try (PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setString(1, sourceVersion);
            stmt.setString(2, sourceBinary);

            try (ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    String functionKey = rs.getString("function_name") + "@" + String.format("0x%X", rs.getLong("function_addr"));
                    String targetVersion = rs.getString("target_version");

                    SimilarityInfo simInfo = new SimilarityInfo();
                    simInfo.score = rs.getFloat("similarity_score");
                    simInfo.matchType = rs.getString("match_type");
                    simInfo.confidence = rs.getString("confidence_level");
                    simInfo.targetBinary = rs.getString("target_binary");

                    similarities.computeIfAbsent(functionKey, k -> new HashMap<>())
                            .put(targetVersion, simInfo);
                }
            }
        }

        return similarities;
    }

    /**
     * Get detailed function comparison data
     */
    public FunctionComparisonData getFunctionComparison(Connection conn, int sourceFunctionId, int targetFunctionId) throws SQLException {
        FunctionComparisonData comparison = new FunctionComparisonData();

        String sql = """
            SELECT
                f1.name_func as source_name, f1.addr as source_addr,
                e1.name_exec as source_binary, e1.game_version as source_version,
                fa1.instruction_count as source_instructions, fa1.cyclomatic_complexity as source_complexity,
                f2.name_func as target_name, f2.addr as target_addr,
                e2.name_exec as target_binary, e2.game_version as target_version,
                fa2.instruction_count as target_instructions, fa2.cyclomatic_complexity as target_complexity,
                sm.similarity_score, sm.match_type, sm.confidence_level,
                sm.signature_similarity, sm.structural_similarity, sm.semantic_similarity, sm.tag_similarity
            FROM desctable f1
            JOIN exetable e1 ON f1.id_exe = e1.id
            LEFT JOIN function_analysis fa1 ON fa1.function_id = f1.id
            JOIN desctable f2 ON f2.id = ?
            JOIN exetable e2 ON f2.id_exe = e2.id
            LEFT JOIN function_analysis fa2 ON fa2.function_id = f2.id
            LEFT JOIN similarity_matrix sm ON sm.source_function_id = f1.id AND sm.target_function_id = f2.id
            WHERE f1.id = ?
        """;

        try (PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setInt(1, targetFunctionId);
            stmt.setInt(2, sourceFunctionId);

            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    // Source function
                    comparison.sourceFunction = new DetailedFunctionInfo();
                    comparison.sourceFunction.name = rs.getString("source_name");
                    comparison.sourceFunction.address = String.format("0x%X", rs.getLong("source_addr"));
                    comparison.sourceFunction.binary = rs.getString("source_binary");
                    comparison.sourceFunction.version = rs.getString("source_version");
                    comparison.sourceFunction.instructionCount = rs.getInt("source_instructions");
                    comparison.sourceFunction.complexity = rs.getInt("source_complexity");

                    // Target function
                    comparison.targetFunction = new DetailedFunctionInfo();
                    comparison.targetFunction.name = rs.getString("target_name");
                    comparison.targetFunction.address = String.format("0x%X", rs.getLong("target_addr"));
                    comparison.targetFunction.binary = rs.getString("target_binary");
                    comparison.targetFunction.version = rs.getString("target_version");
                    comparison.targetFunction.instructionCount = rs.getInt("target_instructions");
                    comparison.targetFunction.complexity = rs.getInt("target_complexity");

                    // Similarity metrics
                    comparison.overallSimilarity = rs.getFloat("similarity_score");
                    comparison.matchType = rs.getString("match_type");
                    comparison.confidence = rs.getString("confidence_level");
                    comparison.signatureSimilarity = rs.getFloat("signature_similarity");
                    comparison.structuralSimilarity = rs.getFloat("structural_similarity");
                    comparison.semanticSimilarity = rs.getFloat("semantic_similarity");
                    comparison.tagSimilarity = rs.getFloat("tag_similarity");
                }
            }
        }

        return comparison;
    }

    // Data classes for API responses

    public static class VersionInfo {
        public String version;
        public String family;
        public int binaryCount;

        @Override
        public String toString() {
            return String.format("%s %s (%d binaries)", family, version, binaryCount);
        }
    }

    public static class BinaryInfo {
        public int id;
        public String binaryName;
        public String family;
        public int functionCount;

        @Override
        public String toString() {
            return String.format("%s (%d functions)", binaryName, functionCount);
        }
    }

    public static class FunctionInfo {
        public int id;
        public String name;
        public String address;
        public boolean isLibrary;
        public int complexity;
        public List<String> tags;
    }

    public static class DetailedFunctionInfo extends FunctionInfo {
        public String binary;
        public String version;
        public int instructionCount;
    }

    public static class SimilarityInfo {
        public float score;
        public String matchType;
        public String confidence;
        public String targetBinary;
    }

    public static class MatrixData {
        public String sourceVersion;
        public String sourceBinary;
        public List<FunctionInfo> functions = new ArrayList<>();
        public List<VersionInfo> targetVersions = new ArrayList<>();
        public Map<String, Map<String, SimilarityInfo>> similarities = new HashMap<>();
    }

    public static class FunctionComparisonData {
        public DetailedFunctionInfo sourceFunction;
        public DetailedFunctionInfo targetFunction;
        public float overallSimilarity;
        public String matchType;
        public String confidence;
        public float signatureSimilarity;
        public float structuralSimilarity;
        public float semanticSimilarity;
        public float tagSimilarity;
    }
}