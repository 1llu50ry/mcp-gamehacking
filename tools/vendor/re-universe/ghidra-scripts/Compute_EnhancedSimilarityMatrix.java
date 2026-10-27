// Compute Enhanced Similarity Matrix
// Advanced similarity analysis using multiple algorithms and comprehensive function metrics
// @author Ben Ethington
// @category Diablo 2

import ghidra.app.script.GhidraScript;
import java.sql.*;
import java.util.*;

public class Compute_EnhancedSimilarityMatrix extends GhidraScript {

    private static final String DB_URL = "jdbc:postgresql://"
        + System.getenv().getOrDefault("BSIM_DB_HOST", "localhost") + ":"
        + System.getenv().getOrDefault("BSIM_DB_PORT", "5432") + "/"
        + System.getenv().getOrDefault("BSIM_DB_NAME", "bsim");
    private static final String DB_USER = System.getenv().getOrDefault("BSIM_DB_USER", "bsim_user");
    private static final String DB_PASS = System.getenv().getOrDefault("BSIM_DB_PASSWORD", "");

    // Similarity thresholds
    private static final float EXACT_MATCH_THRESHOLD = 0.95f;
    private static final float SIMILAR_MATCH_THRESHOLD = 0.70f;
    private static final float WEAK_MATCH_THRESHOLD = 0.30f;

    @Override
    public void run() throws Exception {
        println("=== Computing Enhanced Similarity Matrix ===");

        try (Connection conn = DriverManager.getConnection(DB_URL, DB_USER, DB_PASS)) {

            // Clear existing similarity data
            clearExistingSimilarityData(conn);

            // Compute cross-version function similarities
            computeFunctionSimilarities(conn);

            // Refresh materialized views
            refreshAnalysisViews(conn);

            println("Enhanced similarity matrix computation completed!");

        } catch (SQLException e) {
            printerr("Database error: " + e.getMessage());
            throw e;
        }
    }

    /**
     * Clear existing similarity data for fresh computation
     */
    private void clearExistingSimilarityData(Connection conn) throws SQLException {
        println("Clearing existing similarity data...");

        String sql = "DELETE FROM similarity_matrix";
        try (Statement stmt = conn.createStatement()) {
            int deleted = stmt.executeUpdate(sql);
            println("  Cleared " + deleted + " existing similarity records");
        }
    }

    /**
     * Compute comprehensive function similarities across all versions
     */
    private void computeFunctionSimilarities(Connection conn) throws SQLException {
        println("Computing function similarities...");

        // Get all function pairs for cross-version analysis
        String functionPairsSql = """
            SELECT
                f1.id as source_id, f1.name_func as source_name, f1.addr as source_addr,
                e1.id as source_exe_id, e1.game_version as source_version,
                f2.id as target_id, f2.name_func as target_name, f2.addr as target_addr,
                e2.id as target_exe_id, e2.game_version as target_version,
                fa1.instruction_count as source_inst_count, fa1.cyclomatic_complexity as source_complexity,
                fa1.calls_made as source_calls_made, fa1.is_library_function as source_is_library,
                fa2.instruction_count as target_inst_count, fa2.cyclomatic_complexity as target_complexity,
                fa2.calls_made as target_calls_made, fa2.is_library_function as target_is_library
            FROM desctable f1
            JOIN exetable e1 ON f1.id_exe = e1.id
            JOIN desctable f2 ON f1.name_func = f2.name_func AND f2.id_exe != f1.id_exe
            JOIN exetable e2 ON f2.id_exe = e2.id
            LEFT JOIN function_analysis fa1 ON fa1.function_id = f1.id
            LEFT JOIN function_analysis fa2 ON fa2.function_id = f2.id
            WHERE f1.id < f2.id
            ORDER BY f1.name_func, e1.game_version, e2.game_version
        """;

        String insertSimilaritySql = """
            INSERT INTO similarity_matrix
            (source_function_id, source_executable_id, source_version,
             target_function_id, target_executable_id, target_version,
             similarity_score, match_type, signature_similarity, structural_similarity,
             semantic_similarity, tag_similarity, confidence_level, analysis_method)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """;

        int processedPairs = 0;
        int similarityRecords = 0;

        try (PreparedStatement selectStmt = conn.prepareStatement(functionPairsSql);
             PreparedStatement insertStmt = conn.prepareStatement(insertSimilaritySql);
             ResultSet rs = selectStmt.executeQuery()) {

            while (rs.next() && !monitor.isCancelled()) {
                processedPairs++;

                if (processedPairs % 1000 == 0) {
                    monitor.setMessage(String.format("Processed %d function pairs...", processedPairs));
                }

                // Calculate comprehensive similarity
                SimilarityResult similarity = calculateComprehensiveSimilarity(conn, rs);

                // Only store meaningful similarities
                if (similarity.overallScore >= WEAK_MATCH_THRESHOLD) {
                    insertStmt.setInt(1, rs.getInt("source_id"));
                    insertStmt.setInt(2, rs.getInt("source_exe_id"));
                    insertStmt.setString(3, rs.getString("source_version"));
                    insertStmt.setInt(4, rs.getInt("target_id"));
                    insertStmt.setInt(5, rs.getInt("target_exe_id"));
                    insertStmt.setString(6, rs.getString("target_version"));
                    insertStmt.setFloat(7, similarity.overallScore);
                    insertStmt.setString(8, similarity.matchType);
                    insertStmt.setFloat(9, similarity.signatureSimilarity);
                    insertStmt.setFloat(10, similarity.structuralSimilarity);
                    insertStmt.setFloat(11, similarity.semanticSimilarity);
                    insertStmt.setFloat(12, similarity.tagSimilarity);
                    insertStmt.setString(13, similarity.confidenceLevel);
                    insertStmt.setString(14, "ENHANCED_ANALYSIS");

                    insertStmt.executeUpdate();
                    similarityRecords++;
                }
            }
        }

        if (monitor.isCancelled()) {
            println("Operation cancelled by user");
            return;
        }

        println(String.format("  Processed %d function pairs, stored %d similarity records",
                processedPairs, similarityRecords));
    }

    /**
     * Calculate comprehensive similarity using multiple algorithms
     */
    private SimilarityResult calculateComprehensiveSimilarity(Connection conn, ResultSet rs) throws SQLException {
        SimilarityResult result = new SimilarityResult();

        try {
            // Name-based similarity (exact match for same function names)
            result.signatureSimilarity = 1.0f; // Functions have same name

            // Structural similarity based on metrics
            result.structuralSimilarity = calculateStructuralSimilarity(rs);

            // Semantic similarity based on calling patterns and complexity
            result.semanticSimilarity = calculateSemanticSimilarity(rs);

            // Tag-based similarity
            result.tagSimilarity = calculateTagSimilarity(conn,
                rs.getInt("source_id"), rs.getInt("target_id"));

            // Compute overall weighted score
            result.overallScore = calculateWeightedSimilarity(
                result.signatureSimilarity,
                result.structuralSimilarity,
                result.semanticSimilarity,
                result.tagSimilarity
            );

            // Determine match type and confidence
            result.matchType = determineMatchType(result.overallScore);
            result.confidenceLevel = determineConfidenceLevel(result);

        } catch (Exception e) {
            // Default to low similarity on error
            result.overallScore = 0.1f;
            result.matchType = "NONE";
            result.confidenceLevel = "LOW";
        }

        return result;
    }

    /**
     * Calculate structural similarity based on function metrics
     */
    private float calculateStructuralSimilarity(ResultSet rs) throws SQLException {
        int sourceInst = rs.getInt("source_inst_count");
        int targetInst = rs.getInt("target_inst_count");
        int sourceComplexity = rs.getInt("source_complexity");
        int targetComplexity = rs.getInt("target_complexity");
        int sourceCalls = rs.getInt("source_calls_made");
        int targetCalls = rs.getInt("target_calls_made");

        // Handle null/zero values
        if (sourceInst == 0 && targetInst == 0) return 1.0f;
        if (sourceInst == 0 || targetInst == 0) return 0.0f;

        // Calculate similarity metrics
        float instSimilarity = 1.0f - Math.abs(sourceInst - targetInst) / (float)Math.max(sourceInst, targetInst);
        float complexitySimilarity = 1.0f - Math.abs(sourceComplexity - targetComplexity) / (float)Math.max(sourceComplexity, targetComplexity);
        float callsSimilarity = 1.0f - Math.abs(sourceCalls - targetCalls) / (float)Math.max(sourceCalls, targetCalls);

        // Weighted average
        return (instSimilarity * 0.4f + complexitySimilarity * 0.3f + callsSimilarity * 0.3f);
    }

    /**
     * Calculate semantic similarity based on function behavior indicators
     */
    private float calculateSemanticSimilarity(ResultSet rs) throws SQLException {
        boolean sourceIsLibrary = rs.getBoolean("source_is_library");
        boolean targetIsLibrary = rs.getBoolean("target_is_library");

        // Library functions should match with library functions
        if (sourceIsLibrary && targetIsLibrary) {
            return 0.8f;
        } else if (sourceIsLibrary != targetIsLibrary) {
            return 0.2f;
        }

        // For non-library functions, use structural metrics as semantic proxy
        return calculateStructuralSimilarity(rs) * 0.8f;
    }

    /**
     * Calculate tag-based similarity
     */
    private float calculateTagSimilarity(Connection conn, int sourceId, int targetId) throws SQLException {
        String sql = """
            SELECT
                COUNT(DISTINCT t1.tag_category) as total_source_tags,
                COUNT(DISTINCT t2.tag_category) as total_target_tags,
                COUNT(DISTINCT CASE WHEN t1.tag_category = t2.tag_category AND t1.tag_value = t2.tag_value THEN t1.tag_category END) as matching_tags
            FROM function_tags t1
            FULL OUTER JOIN function_tags t2 ON t1.tag_category = t2.tag_category AND t1.tag_value = t2.tag_value AND t2.function_id = ?
            WHERE t1.function_id = ?
        """;

        try (PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setInt(1, targetId);
            stmt.setInt(2, sourceId);

            ResultSet rs = stmt.executeQuery();
            if (rs.next()) {
                int totalSourceTags = rs.getInt("total_source_tags");
                int totalTargetTags = rs.getInt("total_target_tags");
                int matchingTags = rs.getInt("matching_tags");

                if (totalSourceTags == 0 && totalTargetTags == 0) return 1.0f;
                if (totalSourceTags == 0 || totalTargetTags == 0) return 0.0f;

                // Jaccard similarity
                int union = totalSourceTags + totalTargetTags - matchingTags;
                return union > 0 ? (float)matchingTags / union : 0.0f;
            }
        }

        return 0.0f; // Default if no tags found
    }

    /**
     * Calculate weighted overall similarity score
     */
    private float calculateWeightedSimilarity(float signature, float structural, float semantic, float tags) {
        // Weighted combination - signature has highest weight since functions have same name
        return signature * 0.4f + structural * 0.25f + semantic * 0.25f + tags * 0.1f;
    }

    /**
     * Determine match type based on similarity score
     */
    private String determineMatchType(float score) {
        if (score >= EXACT_MATCH_THRESHOLD) return "EXACT";
        if (score >= SIMILAR_MATCH_THRESHOLD) return "SIMILAR";
        if (score >= WEAK_MATCH_THRESHOLD) return "WEAK";
        return "NONE";
    }

    /**
     * Determine confidence level based on multiple factors
     */
    private String determineConfidenceLevel(SimilarityResult result) {
        // High confidence if multiple metrics agree
        int highScores = 0;
        if (result.signatureSimilarity > 0.8f) highScores++;
        if (result.structuralSimilarity > 0.8f) highScores++;
        if (result.semanticSimilarity > 0.8f) highScores++;
        if (result.tagSimilarity > 0.6f) highScores++;

        if (highScores >= 3) return "HIGH";
        if (highScores >= 2) return "MEDIUM";
        return "LOW";
    }

    /**
     * Refresh materialized views after similarity computation
     */
    private void refreshAnalysisViews(Connection conn) throws SQLException {
        println("Refreshing analysis views...");

        String[] views = {
            "function_matrix",
            "function_summary"
        };

        try (Statement stmt = conn.createStatement()) {
            for (String view : views) {
                try {
                    stmt.execute("REFRESH MATERIALIZED VIEW " + view);
                    println("  Refreshed " + view);
                } catch (SQLException e) {
                    println("  Warning: Could not refresh " + view + ": " + e.getMessage());
                }
            }
        }
    }

    /**
     * Helper class to store similarity calculation results
     */
    private static class SimilarityResult {
        float overallScore = 0.0f;
        float signatureSimilarity = 0.0f;
        float structuralSimilarity = 0.0f;
        float semanticSimilarity = 0.0f;
        float tagSimilarity = 0.0f;
        String matchType = "NONE";
        String confidenceLevel = "LOW";
    }
}