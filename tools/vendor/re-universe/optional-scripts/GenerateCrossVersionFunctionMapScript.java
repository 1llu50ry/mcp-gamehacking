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
//Generates a cross-version function mapping table using BSim similarity matching.
//Creates a comprehensive map showing how functions correspond across different program versions.
//Ideal for tracking function evolution across software versions (e.g., game patches).
//@category BSim
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

public class GenerateCrossVersionFunctionMapScript extends GhidraScript {

	private static final String HOST = "Host";
	private static final String PORT = "Port";
	private static final String DATABASE_NAME = "Database Name";
	private static final String USERNAME = "Username";
	private static final String SIMILARITY_THRESHOLD = "Similarity Threshold (0.0-1.0)";
	private static final String EXACT_MATCH_THRESHOLD = "Exact Match Threshold";
	private static final String OUTPUT_FORMAT = "Output Format";

	private static final int DEFAULT_POSTGRES_PORT = 5432;
	private static final double DEFAULT_SIMILARITY = 0.7;
	private static final double DEFAULT_EXACT = 0.99;

	// Track function mappings: source function -> (exe name -> matched function info)
	private Map<String, Map<String, FunctionMapping>> crossVersionMap = new LinkedHashMap<>();
	private Set<String> allExecutables = new TreeSet<>();
	private Map<String, String> executableVersionMap = new HashMap<>();  // exe name -> version
	private Set<String> allVersions = new TreeSet<>();

	@Override
	protected void run() throws Exception {
		if (currentProgram == null) {
			popup("This script requires an open program as the reference version.");
			return;
		}

		if (isRunningHeadless()) {
			popup("Use the \"bsim\" command-line tool for headless operations");
			return;
		}

		GhidraValuesMap values = new GhidraValuesMap();
		values.defineString(HOST, "localhost");
		values.defineInt(PORT, DEFAULT_POSTGRES_PORT);
		values.defineString(DATABASE_NAME, "bsim");
		values.defineString(USERNAME, System.getProperty("user.name"));
		values.defineDouble(SIMILARITY_THRESHOLD, DEFAULT_SIMILARITY);
		values.defineDouble(EXACT_MATCH_THRESHOLD, DEFAULT_EXACT);
		values.defineChoice(OUTPUT_FORMAT, "CSV", "CSV", "Markdown", "JSON");

		values.setValidator((valueMap, status) -> {
			String host = valueMap.getString(HOST);
			if (StringUtils.isBlank(host)) {
				status.setStatusText("Host cannot be empty!", MessageType.ERROR);
				return false;
			}
			double sim = valueMap.getDouble(SIMILARITY_THRESHOLD);
			if (sim < 0.0 || sim > 1.0) {
				status.setStatusText("Similarity must be between 0.0 and 1.0!", MessageType.ERROR);
				return false;
			}
			return true;
		});

		askValues("Cross-Version Function Mapping", null, values);

		String host = values.getString(HOST);
		int port = values.getInt(PORT);
		String dbName = values.getString(DATABASE_NAME);
		String username = values.getString(USERNAME);
		double similarityThreshold = values.getDouble(SIMILARITY_THRESHOLD);
		double exactThreshold = values.getDouble(EXACT_MATCH_THRESHOLD);
		String outputFormat = values.getChoice(OUTPUT_FORMAT);

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

			// Get all executables in the database for context
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

					// Get version from executable category
					String version = exe.getExeCategoryAlphabetic("Version");
					if (version != null && !version.isEmpty()) {
						executableVersionMap.put(exeName, version);
						allVersions.add(version);
					}

					if (!exeName.equals(currentProgram.getName())) {
						allExecutables.add(exeName);
					}
				}
			}

			// Log version info
			if (!allVersions.isEmpty()) {
				Msg.info(this, "Found versions in database: " + String.join(", ", allVersions));
			}

			if (allExecutables.isEmpty()) {
				popup("No other executables found in the database to compare against.\n" +
					"Make sure you've added multiple program versions using AddProgramToPostgresBSimDatabaseScript.");
				return;
			}

			LSHVectorFactory vectorFactory = pgDatabase.getLSHVectorFactory();

			// Collect all non-trivial functions
			List<Function> functions = new ArrayList<>();
			FunctionIterator funcIter = currentProgram.getFunctionManager().getFunctions(true);
			while (funcIter.hasNext()) {
				Function func = funcIter.next();
				if (!func.isThunk() && !func.isExternal() && func.getBody().getNumAddresses() > 4) {
					functions.add(func);
				}
			}

			if (functions.isEmpty()) {
				popup("No suitable functions found in the current program.");
				return;
			}

			Msg.info(this, "Building cross-version map for " + functions.size() + " functions...");
			monitor.initialize(functions.size());

			// Generate signatures
			GenSignatures gensig = new GenSignatures(dbInfo.trackcallgraph);
			gensig.setVectorFactory(vectorFactory);
			gensig.addExecutableCategories(dbInfo.execats);
			gensig.addFunctionTags(dbInfo.functionTags);
			gensig.openProgram(currentProgram, null, null, null, null, null);

			int processed = 0;
			for (Function func : functions) {
				if (monitor.isCancelled()) {
					break;
				}
				monitor.setProgress(processed++);
				monitor.setMessage("Mapping: " + func.getName() + " (" + processed + "/" + functions.size() + ")");

				try {
					DescriptionManager manager = gensig.getDescriptionManager();
					manager.clear();  // Clear previous function data
					gensig.scanFunction(func);

					if (manager.numFunctions() == 0) {
						continue;
					}

					QueryNearest queryNearest = new QueryNearest();
					queryNearest.manage = manager;
					queryNearest.max = 50;  // Get top 50 matches per function
					queryNearest.thresh = similarityThreshold;
					queryNearest.signifthresh = 0.0;

					ResponseNearest response = queryNearest.execute(pgDatabase);
					if (response == null) {
						continue;
					}

					String sourceKey = func.getName() + "@" + func.getEntryPoint().toString();
					Map<String, FunctionMapping> mappings = new HashMap<>();

					for (SimilarityResult simResult : response.result) {
						Iterator<SimilarityNote> noteIter = simResult.iterator();
						while (noteIter.hasNext()) {
							SimilarityNote note = noteIter.next();
							FunctionDescription matchFunc = note.getFunctionDescription();
							ExecutableRecord matchExe = matchFunc.getExecutableRecord();
							String exeName = matchExe.getNameExec();

							// Skip self-matches
							if (exeName.equals(currentProgram.getName())) {
								continue;
							}

							// Keep only the best match per executable
							FunctionMapping existing = mappings.get(exeName);
							if (existing == null || note.getSimilarity() > existing.similarity) {
								FunctionMapping mapping = new FunctionMapping();
								mapping.functionName = matchFunc.getFunctionName();
								mapping.address = "0x" + Long.toHexString(matchFunc.getAddress());
								mapping.version = executableVersionMap.get(exeName);  // Get version
								mapping.similarity = note.getSimilarity();
								mapping.confidence = note.getSignificance();
								mapping.isExactMatch = note.getSimilarity() >= exactThreshold;
								mappings.put(exeName, mapping);
							}
						}
					}

					if (!mappings.isEmpty()) {
						crossVersionMap.put(sourceKey, mappings);
					}

				} catch (Exception e) {
					Msg.warn(this, "Error processing " + func.getName() + ": " + e.getMessage());
				}
			}

			gensig.dispose();

			// Generate output
			String output = generateOutput(outputFormat, exactThreshold);

			// Save to file
			String extension = outputFormat.equals("JSON") ? ".json" :
							   outputFormat.equals("Markdown") ? ".md" : ".csv";
			String outputPath = System.getProperty("user.home") + "/crossversion_map_" +
				currentProgram.getName() + "_" + System.currentTimeMillis() + extension;

			try (PrintWriter pw = new PrintWriter(new FileWriter(outputPath))) {
				pw.print(output);
			}

			println(output);
			popup("Cross-version function map generated!\n\n" +
				"Functions mapped: " + crossVersionMap.size() + "\n" +
				"Executables compared: " + allExecutables.size() + "\n\n" +
				"Output saved to:\n" + outputPath);
		}
	}

	private String generateOutput(String format, double exactThreshold) {
		switch (format) {
			case "JSON":
				return generateJson();
			case "Markdown":
				return generateMarkdown(exactThreshold);
			default:
				return generateCsv();
		}
	}

	private String generateCsv() {
		StringBuilder sb = new StringBuilder();

		// Header - include version in column names if available
		sb.append("Source Function,Source Address");
		for (String exe : allExecutables) {
			String version = executableVersionMap.get(exe);
			String label = version != null ? exe + " [" + version + "]" : exe;
			sb.append(",").append(label).append(" Function");
			sb.append(",").append(label).append(" Address");
			sb.append(",").append(label).append(" Similarity");
		}
		sb.append("\n");

		// Data rows
		for (Map.Entry<String, Map<String, FunctionMapping>> entry : crossVersionMap.entrySet()) {
			String[] parts = entry.getKey().split("@");
			String funcName = parts[0];
			String funcAddr = parts.length > 1 ? parts[1] : "";

			sb.append("\"").append(funcName).append("\"");
			sb.append(",").append(funcAddr);

			Map<String, FunctionMapping> mappings = entry.getValue();
			for (String exe : allExecutables) {
				FunctionMapping mapping = mappings.get(exe);
				if (mapping != null) {
					sb.append(",\"").append(mapping.functionName).append("\"");
					sb.append(",").append(mapping.address);
					sb.append(",").append(String.format("%.4f", mapping.similarity));
				} else {
					sb.append(",,,");
				}
			}
			sb.append("\n");
		}

		return sb.toString();
	}

	private String generateMarkdown(double exactThreshold) {
		StringBuilder sb = new StringBuilder();

		sb.append("# Cross-Version Function Mapping Report\n\n");
		sb.append("**Reference Program:** ").append(currentProgram.getName()).append("\n\n");
		if (!allVersions.isEmpty()) {
			sb.append("**Versions in Database:** ").append(String.join(", ", allVersions)).append("\n\n");
		}
		sb.append("**Compared Against:**\n");
		for (String exe : allExecutables) {
			String version = executableVersionMap.get(exe);
			sb.append("- ").append(exe);
			if (version != null) {
				sb.append(" (Version: ").append(version).append(")");
			}
			sb.append("\n");
		}
		sb.append("\n---\n\n");

		// Summary statistics
		int exactMatches = 0;
		int partialMatches = 0;
		for (Map<String, FunctionMapping> mappings : crossVersionMap.values()) {
			for (FunctionMapping m : mappings.values()) {
				if (m.isExactMatch) exactMatches++;
				else partialMatches++;
			}
		}

		sb.append("## Summary\n\n");
		sb.append("| Metric | Count |\n");
		sb.append("|--------|-------|\n");
		sb.append("| Functions Mapped | ").append(crossVersionMap.size()).append(" |\n");
		sb.append("| Exact Matches (>=").append(String.format("%.0f%%", exactThreshold * 100)).append(") | ").append(exactMatches).append(" |\n");
		sb.append("| Partial Matches | ").append(partialMatches).append(" |\n\n");

		// Detailed mappings
		sb.append("## Function Mappings\n\n");

		for (Map.Entry<String, Map<String, FunctionMapping>> entry : crossVersionMap.entrySet()) {
			String[] parts = entry.getKey().split("@");
			String funcName = parts[0];
			String funcAddr = parts.length > 1 ? parts[1] : "";

			sb.append("### `").append(funcName).append("` @ ").append(funcAddr).append("\n\n");
			sb.append("| Version | Matched Function | Address | Similarity |\n");
			sb.append("|---------|------------------|---------|------------|\n");

			Map<String, FunctionMapping> mappings = entry.getValue();
			for (String exe : allExecutables) {
				FunctionMapping mapping = mappings.get(exe);
				if (mapping != null) {
					String simStr = mapping.isExactMatch ?
						String.format("**%.2f%%** (exact)", mapping.similarity * 100) :
						String.format("%.2f%%", mapping.similarity * 100);
					sb.append("| ").append(exe).append(" | `").append(mapping.functionName);
					sb.append("` | ").append(mapping.address).append(" | ").append(simStr).append(" |\n");
				} else {
					sb.append("| ").append(exe).append(" | *not found* | - | - |\n");
				}
			}
			sb.append("\n");
		}

		return sb.toString();
	}

	private String generateJson() {
		StringBuilder sb = new StringBuilder();
		sb.append("{\n");
		sb.append("  \"referenceProgram\": \"").append(currentProgram.getName()).append("\",\n");
		sb.append("  \"comparedExecutables\": [");
		boolean first = true;
		for (String exe : allExecutables) {
			if (!first) sb.append(", ");
			sb.append("\"").append(exe).append("\"");
			first = false;
		}
		sb.append("],\n");
		sb.append("  \"mappings\": [\n");

		first = true;
		for (Map.Entry<String, Map<String, FunctionMapping>> entry : crossVersionMap.entrySet()) {
			if (!first) sb.append(",\n");
			first = false;

			String[] parts = entry.getKey().split("@");
			String funcName = parts[0];
			String funcAddr = parts.length > 1 ? parts[1] : "";

			sb.append("    {\n");
			sb.append("      \"sourceFunction\": \"").append(escapeJson(funcName)).append("\",\n");
			sb.append("      \"sourceAddress\": \"").append(funcAddr).append("\",\n");
			sb.append("      \"matches\": {\n");

			Map<String, FunctionMapping> mappings = entry.getValue();
			boolean firstMapping = true;
			for (String exe : allExecutables) {
				if (!firstMapping) sb.append(",\n");
				firstMapping = false;

				FunctionMapping mapping = mappings.get(exe);
				sb.append("        \"").append(exe).append("\": ");
				if (mapping != null) {
					sb.append("{\n");
					sb.append("          \"function\": \"").append(escapeJson(mapping.functionName)).append("\",\n");
					sb.append("          \"address\": \"").append(mapping.address).append("\",\n");
					sb.append("          \"similarity\": ").append(String.format("%.4f", mapping.similarity)).append(",\n");
					sb.append("          \"isExactMatch\": ").append(mapping.isExactMatch).append("\n");
					sb.append("        }");
				} else {
					sb.append("null");
				}
			}
			sb.append("\n      }\n");
			sb.append("    }");
		}

		sb.append("\n  ]\n");
		sb.append("}\n");
		return sb.toString();
	}

	private String escapeJson(String s) {
		return s.replace("\\", "\\\\").replace("\"", "\\\"");
	}

	private static class FunctionMapping {
		String functionName;
		String address;
		String version;  // Version from BSim category
		double similarity;
		double confidence;
		boolean isExactMatch;
	}
}
