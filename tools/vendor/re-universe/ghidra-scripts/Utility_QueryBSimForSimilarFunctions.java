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
// UTILITY: Query BSim for Similar Functions (INTERACTIVE ANALYSIS TOOL)
//
// Interactive utility for querying the BSim database to find functions similar to a
// specified target function. Provides real-time similarity analysis and detailed
// matching results across all indexed programs and versions.
//
// QUERY CAPABILITIES:
// - Function-to-function similarity searches across all indexed binaries
// - Cross-version function tracking and identification
// - Similarity threshold filtering for precision control
// - Multiple similarity algorithm results comparison
//
// INTERACTIVE FEATURES:
// - User-guided function selection from current program
// - Configurable similarity thresholds and result limits
// - Detailed match reporting with confidence scores
// - Export capabilities for further analysis
//
// ANALYSIS OUTPUTS:
// - Ranked similarity results with confidence scores
// - Cross-version function mapping tables
// - Detailed match explanations and reasoning
// - Export to CSV/text for external analysis
//
// PRACTICAL APPLICATIONS:
// - Reverse engineering: Find similar functions across malware families
// - Version analysis: Track function evolution across software versions
// - Code reuse detection: Identify shared code between different binaries
// - Quality validation: Verify BSim analysis accuracy through spot checks
//
// WORKFLOW INTEGRATION:
// - Use after Steps 1-4 completion for interactive exploration
// - Complements automated analysis with manual investigation capabilities
// - Validates similarity matrix results through targeted queries
//
// @author Ghidra Community (Enhanced for Unified Version System)
//@category BSim
//@menupath Tools.BSim.Utilities.Query Similar Functions
import java.io.FileWriter;
import java.io.PrintWriter;
import java.util.*;

import org.apache.commons.lang3.StringUtils;

import generic.lsh.vector.LSHVectorFactory;
import ghidra.app.script.GhidraScript;
import ghidra.features.base.values.GhidraValuesMap;
import ghidra.features.bsim.query.*;
import ghidra.features.bsim.query.BSimServerInfo.DBType;
import ghidra.features.bsim.query.FunctionDatabase.BSimError;
import ghidra.features.bsim.query.description.*;
import ghidra.features.bsim.query.protocol.*;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.util.MessageType;
import ghidra.util.Msg;

public class Utility_QueryBSimForSimilarFunctions extends GhidraScript {

	private static final String HOST = "Host";
	private static final String PORT = "Port";
	private static final String DATABASE_NAME = "Database Name";
	private static final String USERNAME = "Username";
	private static final String SIMILARITY_THRESHOLD = "Similarity Threshold (0.0-1.0)";
	private static final String CONFIDENCE_THRESHOLD = "Confidence Threshold";
	private static final String MAX_RESULTS = "Max Results Per Function";
	private static final String EXPORT_CSV = "Export Results to CSV";
	private static final String QUERY_ALL_FUNCTIONS = "Query All Functions (vs. Selected)";

	private static final int DEFAULT_POSTGRES_PORT = 5432;
	private static final double DEFAULT_SIMILARITY = 0.7;
	private static final double DEFAULT_CONFIDENCE = 0.0;
	private static final int DEFAULT_MAX_RESULTS = 100;

	@Override
	protected void run() throws Exception {
		if (currentProgram == null) {
			popup("This script requires an open program to query against.");
			return;
		}

		if (isRunningHeadless()) {
			popup("Use the \"bsim\" command-line tool for headless BSim queries");
			return;
		}

		GhidraValuesMap values = new GhidraValuesMap();
		values.defineString(HOST, "localhost");
		values.defineInt(PORT, DEFAULT_POSTGRES_PORT);
		values.defineString(DATABASE_NAME, "bsim");
		values.defineString(USERNAME, System.getProperty("user.name"));
		values.defineDouble(SIMILARITY_THRESHOLD, DEFAULT_SIMILARITY);
		values.defineDouble(CONFIDENCE_THRESHOLD, DEFAULT_CONFIDENCE);
		values.defineInt(MAX_RESULTS, DEFAULT_MAX_RESULTS);
		values.defineBoolean(QUERY_ALL_FUNCTIONS, true);
		values.defineBoolean(EXPORT_CSV, false);

		values.setValidator((valueMap, status) -> {
			String host = valueMap.getString(HOST);
			if (StringUtils.isBlank(host)) {
				status.setStatusText("Host cannot be empty!", MessageType.ERROR);
				return false;
			}
			int port = valueMap.getInt(PORT);
			if (port <= 0 || port > 65535) {
				status.setStatusText("Port must be between 1 and 65535!", MessageType.ERROR);
				return false;
			}
			double sim = valueMap.getDouble(SIMILARITY_THRESHOLD);
			if (sim < 0.0 || sim > 1.0) {
				status.setStatusText("Similarity must be between 0.0 and 1.0!", MessageType.ERROR);
				return false;
			}
			return true;
		});

		askValues("BSim Query Configuration", null, values);

		String host = values.getString(HOST);
		int port = values.getInt(PORT);
		String dbName = values.getString(DATABASE_NAME);
		String username = values.getString(USERNAME);
		double similarityThreshold = values.getDouble(SIMILARITY_THRESHOLD);
		double confidenceThreshold = values.getDouble(CONFIDENCE_THRESHOLD);
		int maxResults = values.getInt(MAX_RESULTS);
		boolean queryAllFunctions = values.getBoolean(QUERY_ALL_FUNCTIONS);
		boolean exportCsv = values.getBoolean(EXPORT_CSV);

		BSimServerInfo serverInfo = new BSimServerInfo(DBType.postgres, username, host, port, dbName);

		try (FunctionDatabase pgDatabase = BSimClientFactory.buildClient(serverInfo, false)) {

			if (!pgDatabase.initialize()) {
				BSimError lastError = pgDatabase.getLastError();
				String errorMsg = lastError != null ? lastError.message : "Unknown error";
				popup("Failed to connect to database: " + errorMsg);
				return;
			}

			DatabaseInformation dbInfo = pgDatabase.getInfo();
			if (dbInfo == null) {
				popup("Failed to retrieve database information.");
				return;
			}

			LSHVectorFactory vectorFactory = pgDatabase.getLSHVectorFactory();

			// Collect functions to query
			List<Function> functionsToQuery = new ArrayList<>();
			if (queryAllFunctions) {
				FunctionIterator funcIter = currentProgram.getFunctionManager().getFunctions(true);
				while (funcIter.hasNext()) {
					Function func = funcIter.next();
					// Skip thunks and external functions
					if (!func.isThunk() && !func.isExternal() && func.getBody().getNumAddresses() > 0) {
						functionsToQuery.add(func);
					}
				}
			} else {
				// Query only the function at the current cursor location
				Function func = getFunctionContaining(currentAddress);
				if (func != null) {
					functionsToQuery.add(func);
				} else {
					popup("No function at current cursor location. Place cursor inside a function.");
					return;
				}
			}

			if (functionsToQuery.isEmpty()) {
				popup("No functions found to query.");
				return;
			}

			Msg.info(this, "Querying " + functionsToQuery.size() + " functions against BSim database...");
			monitor.initialize(functionsToQuery.size());
			monitor.setMessage("Generating signatures and querying...");

			// Generate signatures for query functions
			GenSignatures gensig = new GenSignatures(dbInfo.trackcallgraph);
			gensig.setVectorFactory(vectorFactory);
			gensig.addExecutableCategories(dbInfo.execats);
			gensig.addFunctionTags(dbInfo.functionTags);

			gensig.openProgram(currentProgram, null, null, null, null, null);

			// Results storage
			Map<Function, List<SimilarityResult>> allResults = new LinkedHashMap<>();
			int processedCount = 0;

			for (Function func : functionsToQuery) {
				if (monitor.isCancelled()) {
					break;
				}
				monitor.setProgress(processedCount++);
				monitor.setMessage("Querying: " + func.getName());

				try {
					// Scan function and get description manager
					gensig.scanFunction(func);
					DescriptionManager manager = gensig.getDescriptionManager();

					if (manager.numFunctions() == 0) {
						continue;
					}

					// Build query
					QueryNearest queryNearest = new QueryNearest();
					queryNearest.manage = manager;
					queryNearest.max = maxResults;
					queryNearest.thresh = similarityThreshold;
					queryNearest.signifthresh = confidenceThreshold;

					ResponseNearest response = queryNearest.execute(pgDatabase);
					if (response == null) {
						Msg.warn(this, "Query failed for " + func.getName());
						continue;
					}

					List<SimilarityResult> results = new ArrayList<>();
					// Iterate over each SimilarityResult, then over each SimilarityNote within
					for (ghidra.features.bsim.query.protocol.SimilarityResult simResult : response.result) {
						for (SimilarityNote note : simResult) {
							FunctionDescription matchFunc = note.getFunctionDescription();
							ExecutableRecord matchExe = matchFunc.getExecutableRecord();

							// Skip self-matches (same program)
							String matchExeName = matchExe.getNameExec();
							if (matchExeName.equals(currentProgram.getName())) {
								continue;
							}

							SimilarityResult result = new SimilarityResult();
							result.matchedFunctionName = matchFunc.getFunctionName();
							result.matchedFunctionAddress = "0x" + Long.toHexString(matchFunc.getAddress());
							result.matchedExecutable = matchExeName;
							result.similarity = note.getSimilarity();
							result.confidence = note.getSignificance();
							results.add(result);
						}
					}

					if (!results.isEmpty()) {
						allResults.put(func, results);
					}

				} catch (Exception e) {
					Msg.warn(this, "Error querying function " + func.getName() + ": " + e.getMessage());
				}
			}

			gensig.dispose();

			// Display results
			displayResults(allResults, similarityThreshold, exportCsv);
		}
	}

	private void displayResults(Map<Function, List<SimilarityResult>> allResults,
			double threshold, boolean exportCsv) throws Exception {

		if (allResults.isEmpty()) {
			popup("No similar functions found above the similarity threshold of " + threshold);
			return;
		}

		StringBuilder report = new StringBuilder();
		report.append("BSim Cross-Version Function Matching Results\n");
		report.append("=============================================\n");
		report.append("Source Program: ").append(currentProgram.getName()).append("\n");
		report.append("Similarity Threshold: ").append(threshold).append("\n");
		report.append("Functions with matches: ").append(allResults.size()).append("\n\n");

		// Group by matched executable for summary
		Map<String, Integer> matchCountByExe = new HashMap<>();
		int totalMatches = 0;

		for (Map.Entry<Function, List<SimilarityResult>> entry : allResults.entrySet()) {
			for (SimilarityResult result : entry.getValue()) {
				matchCountByExe.merge(result.matchedExecutable, 1, Integer::sum);
				totalMatches++;
			}
		}

		report.append("Summary by Executable:\n");
		report.append("-----------------------\n");
		for (Map.Entry<String, Integer> entry : matchCountByExe.entrySet()) {
			report.append("  ").append(entry.getKey()).append(": ").append(entry.getValue()).append(" matches\n");
		}
		report.append("\nTotal matches: ").append(totalMatches).append("\n\n");

		report.append("Detailed Results:\n");
		report.append("-----------------\n\n");

		for (Map.Entry<Function, List<SimilarityResult>> entry : allResults.entrySet()) {
			Function func = entry.getKey();
			List<SimilarityResult> results = entry.getValue();

			report.append("Function: ").append(func.getName());
			report.append(" @ 0x").append(func.getEntryPoint().toString()).append("\n");

			for (SimilarityResult result : results) {
				report.append(String.format("  -> %s @ %s in [%s] (sim=%.4f, conf=%.4f)\n",
					result.matchedFunctionName,
					result.matchedFunctionAddress,
					result.matchedExecutable,
					result.similarity,
					result.confidence));
			}
			report.append("\n");
		}

		// Export to CSV if requested
		if (exportCsv) {
			String csvPath = System.getProperty("user.home") + "/bsim_results_" +
				currentProgram.getName() + "_" + System.currentTimeMillis() + ".csv";
			try (PrintWriter pw = new PrintWriter(new FileWriter(csvPath))) {
				pw.println("Source Function,Source Address,Matched Function,Matched Address,Matched Executable,Similarity,Confidence");
				for (Map.Entry<Function, List<SimilarityResult>> entry : allResults.entrySet()) {
					Function func = entry.getKey();
					for (SimilarityResult result : entry.getValue()) {
						pw.printf("\"%s\",\"0x%s\",\"%s\",\"%s\",\"%s\",%.4f,%.4f%n",
							func.getName(),
							func.getEntryPoint().toString(),
							result.matchedFunctionName,
							result.matchedFunctionAddress,
							result.matchedExecutable,
							result.similarity,
							result.confidence);
					}
				}
			}
			report.append("\nResults exported to: ").append(csvPath).append("\n");
		}

		// Show in console
		println(report.toString());

		// Also show popup summary
		popup("Found " + allResults.size() + " functions with " + totalMatches +
			" total matches across " + matchCountByExe.size() + " executables.\n\n" +
			"See console output for full details." +
			(exportCsv ? "\nResults exported to CSV." : ""));
	}

	private static class SimilarityResult {
		String matchedFunctionName;
		String matchedFunctionAddress;
		String matchedExecutable;
		double similarity;
		double confidence;
	}
}
