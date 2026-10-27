// Setup Cross-Version Analysis Data Structures
// Creates enhanced database structures for matrix visualization and advanced similarity analysis
// @author Ben Ethington
// @category BSim
// @menupath Tools.BSim.Database.Setup Cross-Version Analysis Structures

import ghidra.app.script.GhidraScript;
import java.sql.*;

public class Setup_CrossVersionAnalysisStructures extends GhidraScript {

    private static final String DB_URL = "jdbc:postgresql://"
        + System.getenv().getOrDefault("BSIM_DB_HOST", "localhost") + ":"
        + System.getenv().getOrDefault("BSIM_DB_PORT", "5432") + "/"
        + System.getenv().getOrDefault("BSIM_DB_NAME", "bsim");
    private static final String DB_USER = System.getenv().getOrDefault("BSIM_DB_USER", "bsim_user");
    private static final String DB_PASS = System.getenv().getOrDefault("BSIM_DB_PASSWORD", "");

    @Override
    public void run() throws Exception {
        println("=== Setting up Cross-Version Analysis Data Structures ===");

        try (Connection conn = DriverManager.getConnection(DB_URL, DB_USER, DB_PASS)) {

            // Create enhanced function analysis table
            createFunctionAnalysisTable(conn);

            // Create function tags table
            createFunctionTagsTable(conn);

            // Create cross-version similarity matrix table
            createSimilarityMatrixTable(conn);

            // Create enhanced materialized views
            createEnhancedViews(conn);

            // Create indexes for performance
            createPerformanceIndexes(conn);

            println("Cross-version analysis data structures created successfully!");

        } catch (SQLException e) {
            printerr("Database error: " + e.getMessage());
            throw e;
        }
    }

    /**
     * Create enhanced function analysis table for storing detailed metrics
     */
    private void createFunctionAnalysisTable(Connection conn) throws SQLException {
        println("Creating function analysis table...");

        String sql = """
            CREATE TABLE IF NOT EXISTS function_analysis (
                id SERIAL PRIMARY KEY,
                function_id INTEGER REFERENCES desctable(id),
                executable_id INTEGER REFERENCES exetable(id),
                function_name VARCHAR(255),
                entry_address BIGINT,
                instruction_count INTEGER,
                basic_block_count INTEGER,
                cyclomatic_complexity INTEGER,
                calls_made INTEGER,
                calls_received INTEGER,
                has_loops BOOLEAN DEFAULT FALSE,
                has_recursion BOOLEAN DEFAULT FALSE,
                max_depth INTEGER,
                stack_frame_size INTEGER,
                calling_convention VARCHAR(50),
                is_leaf_function BOOLEAN DEFAULT FALSE,
                is_library_function BOOLEAN DEFAULT FALSE,
                is_thunk BOOLEAN DEFAULT FALSE,
                confidence_score FLOAT DEFAULT 0.0,
                analysis_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(function_id, executable_id)
            )
        """;

        try (Statement stmt = conn.createStatement()) {
            stmt.execute(sql);
            println("  Function analysis table created");
        }
    }

    /**
     * Create function tags table for comprehensive tagging system
     */
    private void createFunctionTagsTable(Connection conn) throws SQLException {
        println("Creating function tags table...");

        String sql = """
            CREATE TABLE IF NOT EXISTS function_tags (
                id SERIAL PRIMARY KEY,
                function_id INTEGER REFERENCES desctable(id),
                executable_id INTEGER REFERENCES exetable(id),
                tag_category VARCHAR(50) NOT NULL,
                tag_value VARCHAR(100) NOT NULL,
                confidence FLOAT DEFAULT 1.0,
                auto_generated BOOLEAN DEFAULT TRUE,
                created_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(function_id, executable_id, tag_category, tag_value)
            )
        """;

        try (Statement stmt = conn.createStatement()) {
            stmt.execute(sql);
            println("  Function tags table created");
        }
    }

    /**
     * Create cross-version similarity matrix table
     */
    private void createSimilarityMatrixTable(Connection conn) throws SQLException {
        println("Creating similarity matrix table...");

        String sql = """
            CREATE TABLE IF NOT EXISTS similarity_matrix (
                id SERIAL PRIMARY KEY,
                source_function_id INTEGER REFERENCES desctable(id),
                source_executable_id INTEGER REFERENCES exetable(id),
                source_version VARCHAR(50),
                target_function_id INTEGER REFERENCES desctable(id),
                target_executable_id INTEGER REFERENCES exetable(id),
                target_version VARCHAR(50),
                similarity_score FLOAT NOT NULL,
                match_type VARCHAR(20) CHECK (match_type IN ('EXACT', 'SIMILAR', 'WEAK', 'NONE')),
                signature_similarity FLOAT,
                structural_similarity FLOAT,
                semantic_similarity FLOAT,
                tag_similarity FLOAT,
                confidence_level VARCHAR(20) CHECK (confidence_level IN ('HIGH', 'MEDIUM', 'LOW')),
                analysis_method VARCHAR(50),
                computed_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX(source_function_id, target_function_id),
                INDEX(similarity_score),
                INDEX(match_type),
                UNIQUE(source_function_id, target_function_id)
            )
        """;

        try (Statement stmt = conn.createStatement()) {
            stmt.execute(sql);
            println("  Similarity matrix table created");
        }
    }

    /**
     * Create enhanced materialized views for cross-version analysis
     */
    private void createEnhancedViews(Connection conn) throws SQLException {
        println("Creating enhanced materialized views...");

        // Function matrix view for UI
        String matrixViewSql = """
            CREATE MATERIALIZED VIEW IF NOT EXISTS function_matrix AS
            SELECT
                f1.name_func as function_name,
                f1.addr as address,
                e1.name_exec as source_binary,
                e1.game_version as source_version,
                e1.family_type as source_family,
                e2.name_exec as target_binary,
                e2.game_version as target_version,
                e2.family_type as target_family,
                COALESCE(sm.similarity_score, 0.0) as similarity_score,
                COALESCE(sm.match_type, 'NONE') as match_type,
                COALESCE(sm.confidence_level, 'LOW') as confidence
            FROM desctable f1
            JOIN exetable e1 ON f1.id_exe = e1.id
            CROSS JOIN exetable e2
            LEFT JOIN desctable f2 ON f2.id_exe = e2.id AND f2.name_func = f1.name_func
            LEFT JOIN similarity_matrix sm ON sm.source_function_id = f1.id AND sm.target_function_id = f2.id
            WHERE e1.id != e2.id
            ORDER BY f1.name_func, e1.game_version, e2.game_version
        """;

        // Enhanced function summary view
        String summaryViewSql = """
            CREATE MATERIALIZED VIEW IF NOT EXISTS function_summary AS
            SELECT
                f.id as function_id,
                f.name_func as function_name,
                f.addr as address,
                e.name_exec as binary_name,
                e.game_version as version,
                e.family_type as family,
                fa.instruction_count,
                fa.cyclomatic_complexity,
                fa.is_leaf_function,
                fa.is_library_function,
                ARRAY_AGG(DISTINCT ft.tag_value ORDER BY ft.tag_value) as tags,
                COUNT(DISTINCT sm1.target_function_id) as similar_functions_count,
                AVG(sm1.similarity_score) as avg_similarity_score
            FROM desctable f
            JOIN exetable e ON f.id_exe = e.id
            LEFT JOIN function_analysis fa ON fa.function_id = f.id
            LEFT JOIN function_tags ft ON ft.function_id = f.id
            LEFT JOIN similarity_matrix sm1 ON sm1.source_function_id = f.id AND sm1.similarity_score > 0.7
            GROUP BY f.id, f.name_func, f.addr, e.name_exec, e.game_version, e.family_type,
                     fa.instruction_count, fa.cyclomatic_complexity, fa.is_leaf_function, fa.is_library_function
            ORDER BY f.name_func, e.game_version
        """;

        try (Statement stmt = conn.createStatement()) {
            stmt.execute(matrixViewSql);
            println("  Function matrix view created");

            stmt.execute(summaryViewSql);
            println("  Function summary view created");
        }
    }

    /**
     * Create performance indexes
     */
    private void createPerformanceIndexes(Connection conn) throws SQLException {
        println("Creating performance indexes...");

        String[] indexes = {
            "CREATE INDEX IF NOT EXISTS idx_function_analysis_executable ON function_analysis(executable_id)",
            "CREATE INDEX IF NOT EXISTS idx_function_analysis_complexity ON function_analysis(cyclomatic_complexity)",
            "CREATE INDEX IF NOT EXISTS idx_function_analysis_instruction_count ON function_analysis(instruction_count)",
            "CREATE INDEX IF NOT EXISTS idx_function_tags_category ON function_tags(tag_category)",
            "CREATE INDEX IF NOT EXISTS idx_function_tags_value ON function_tags(tag_value)",
            "CREATE INDEX IF NOT EXISTS idx_function_tags_executable ON function_tags(executable_id)",
            "CREATE INDEX IF NOT EXISTS idx_similarity_matrix_source ON similarity_matrix(source_executable_id, source_function_id)",
            "CREATE INDEX IF NOT EXISTS idx_similarity_matrix_target ON similarity_matrix(target_executable_id, target_function_id)",
            "CREATE INDEX IF NOT EXISTS idx_similarity_matrix_score ON similarity_matrix(similarity_score DESC)",
            "CREATE INDEX IF NOT EXISTS idx_similarity_matrix_type ON similarity_matrix(match_type, similarity_score DESC)"
        };

        try (Statement stmt = conn.createStatement()) {
            for (String index : indexes) {
                stmt.execute(index);
            }
            println("  Performance indexes created");
        }
    }
}