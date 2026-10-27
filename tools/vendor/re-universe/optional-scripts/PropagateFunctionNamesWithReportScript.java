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
//Propagates function names from a reference program to matching functions in other versions
//using BSim similarity matching. Generates comprehensive cross-version matching reports
//with per-binary statistics showing match rates and coverage.
//@category BSim
import java.io.FileWriter;
import java.io.PrintWriter;
import java.text.SimpleDateFormat;
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
import ghidra.framework.model.DomainFile;
import ghidra.framework.model.DomainFolder;
import ghidra.framework.model.Project;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Program;
import ghidra.program.model.symbol.SourceType;
import ghidra.util.MessageType;
import ghidra.util.Msg;
import ghidra.util.exception.DuplicateNameException;
import ghidra.util.exception.InvalidInputException;

public class PropagateFunctionNamesWithReportScript extends GhidraScript {

	private static final String HOST = "Host";
	private static final String PORT = "Port";
	private static final String DATABASE_NAME = "Database Name";
	private static final String USERNAME = "Username";
	private static final String SIMILARITY_THRESHOLD = "Similarity Threshold (0.0-1.0)";
	private static final String EXACT_MATCH_THRESHOLD = "Exact Match Threshold";
	private static final String PROPAGATE_NAMES = "Propagate Function Names";
	private static final String ONLY_RENAME_DEFAULT = "Only Rename Default Names (FUN_*)";
	private static final String ADD_CROSS_REF_COMMENTS = "Add Cross-Reference Comments";
	private static final String MIN_FUNCTION_SIZE = "Min Function Size (instructions)";
	private static final String TARGET_VERSION_FILTER = "Target Version Filter (empty=all)";

	private static final int DEFAULT_POSTGRES_PORT = 5432;
	private static final double DEFAULT_SIMILARITY = 0.7;
	private static final double DEFAULT_EXACT = 0.99;
	private static final int DEFAULT_MIN_SIZE = 5;

	// Statistics tracking
	private Map<String, BinaryStats> binaryStatsMap = new LinkedHashMap<>();
	private List<FunctionMatch> allMatches = new ArrayList<>();
	private Map<String, Map<String, FunctionMatch>> crossVersionTable = new LinkedHashMap<>();
	private Set<String> allExecutableNames = new TreeSet<>();
	private Map<String, String> executableVersionMap = new HashMap<>();  // exe name -> version
	private Set<String> allVersions = new TreeSet<>();
	private String referenceProgram;
	private String referenceVersion;

	// Configuration
	private double similarityThreshold;
	private double exactMatchThreshold;
	private boolean propagateNames;
	private boolean onlyRenameDefault;
	private boolean addComments;
	private String targetVersionFilter;

	@Override
	protected void run() throws Exception {
		if (currentProgram == null) {
			popup("This script requires an open program as the REFERENCE version.\n" +
				"Function names will be propagated FROM this program TO other versions.");
			return;
		}

		if (isRunningHeadless()) {
			popup("This script requires GUI interaction.");
			return;
		}

		GhidraValuesMap values = new GhidraValuesMap();
		values.defineString(HOST, "localhost");
		values.defineInt(PORT, DEFAULT_POSTGRES_PORT);
		values.defineString(DATABASE_NAME, "bsim");
		values.defineString(USERNAME, System.getProperty("user.name"));
		values.defineDouble(SIMILARITY_THRESHOLD, DEFAULT_SIMILARITY);
		values.defineDouble(EXACT_MATCH_THRESHOLD, DEFAULT_EXACT);
		values.defineBoolean(PROPAGATE_NAMES, true);
		values.defineBoolean(ONLY_RENAME_DEFAULT, true);
		values.defineBoolean(ADD_CROSS_REF_COMMENTS, true);
		values.defineInt(MIN_FUNCTION_SIZE, DEFAULT_MIN_SIZE);
		values.defineString(TARGET_VERSION_FILTER, "");

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

		askValues("BSim Function Propagation & Report", null, values);

		String host = values.getString(HOST);
		int port = values.getInt(PORT);
		String dbName = values.getString(DATABASE_NAME);
		String username = values.getString(USERNAME);
		similarityThreshold = values.getDouble(SIMILARITY_THRESHOLD);
		exactMatchThreshold = values.getDouble(EXACT_MATCH_THRESHOLD);
		propagateNames = values.getBoolean(PROPAGATE_NAMES);
		onlyRenameDefault = values.getBoolean(ONLY_RENAME_DEFAULT);
		addComments = values.getBoolean(ADD_CROSS_REF_COMMENTS);
		int minFunctionSize = values.getInt(MIN_FUNCTION_SIZE);
		targetVersionFilter = values.getString(TARGET_VERSION_FILTER);
		if (targetVersionFilter != null) {
			targetVersionFilter = targetVersionFilter.trim();
			if (targetVersionFilter.isEmpty()) {
				targetVersionFilter = null;
			}
		}

		referenceProgram = currentProgram.getName();

		// Initialize stats for reference program
		BinaryStats refStats = new BinaryStats(referenceProgram);
		refStats.isReference = true;
		binaryStatsMap.put(referenceProgram, refStats);

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

			// Get all programs in database
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

					// Get version from executable category (first category)
					String version = exe.getExeCategoryAlphabetic("Version");

					// Track version info
					if (version != null && !version.isEmpty()) {
						executableVersionMap.put(exeName, version);
						allVersions.add(version);
					}

					// Check if this is the reference program
					if (exeName.equals(referenceProgram)) {
						referenceVersion = version;
						continue;
					}

					// Apply version filter if specified
					if (targetVersionFilter != null) {
						if (version == null || !version.equals(targetVersionFilter)) {
							continue;  // Skip executables not matching the target version
						}
					}

					allExecutableNames.add(exeName);
					BinaryStats stats = new BinaryStats(exeName);
					stats.version = version;
					binaryStatsMap.put(exeName, stats);
				}
			}

			// Log version info
			if (!allVersions.isEmpty()) {
				Msg.info(this, "Found versions in database: " + String.join(", ", allVersions));
				if (referenceVersion != null) {
					Msg.info(this, "Reference program version: " + referenceVersion);
				}
				if (targetVersionFilter != null) {
					Msg.info(this, "Filtering to target version: " + targetVersionFilter);
				}
			}

			if (allExecutableNames.size() < 2) {
				popup("Need at least 2 programs in the BSim database for cross-version matching.");
				return;
			}

			LSHVectorFactory vectorFactory = pgDatabase.getLSHVectorFactory();

			// Collect reference functions
			List<Function> refFunctions = new ArrayList<>();
			FunctionIterator funcIter = currentProgram.getFunctionManager().getFunctions(true);
			while (funcIter.hasNext()) {
				Function func = funcIter.next();
				if (!func.isThunk() && !func.isExternal()) {
					long instrCount = func.getBody().getNumAddresses();
					if (instrCount >= minFunctionSize) {
						refFunctions.add(func);
						refStats.totalFunctions++;
						if (isNamedFunction(func)) {
							refStats.namedFunctions++;
						}
					}
				}
			}

			if (refFunctions.isEmpty()) {
				popup("No suitable functions found in reference program.");
				return;
			}

			Msg.info(this, "Processing " + refFunctions.size() + " functions from " + referenceProgram);
			monitor.initialize(refFunctions.size());

			// Generate signatures and query
			GenSignatures gensig = new GenSignatures(dbInfo.trackcallgraph);
			gensig.setVectorFactory(vectorFactory);
			gensig.addExecutableCategories(dbInfo.execats);
			gensig.addFunctionTags(dbInfo.functionTags);
			gensig.openProgram(currentProgram, null, null, null, null, null);

			int processed = 0;
			for (Function func : refFunctions) {
				if (monitor.isCancelled()) {
					break;
				}
				monitor.setProgress(processed++);
				monitor.setMessage("Analyzing: " + func.getName() + " (" + processed + "/" + refFunctions.size() + ")");

				try {
					processFunction(func, gensig, pgDatabase);
				} catch (Exception e) {
					Msg.warn(this, "Error processing " + func.getName() + ": " + e.getMessage());
				}
			}

			gensig.dispose();

			// Now propagate names to other programs if enabled
			if (propagateNames) {
				propagateToPrograms();
			}

			// Calculate derived statistics
			calculateDerivedStats();

			// Generate reports
			String timestamp = new SimpleDateFormat("yyyyMMdd_HHmmss").format(new Date());
			String basePath = System.getProperty("user.home") + "/bsim_report_" + timestamp;

			String summaryReport = generateSummaryReport();
			String detailedReport = generateDetailedReport();
			String csvReport = generateCsvReport();
			String matrixCsv = generateCrossVersionMatrix();

			// Save reports
			saveReport(basePath + "_summary.txt", summaryReport);
			saveReport(basePath + "_detailed.md", detailedReport);
			saveReport(basePath + "_matches.csv", csvReport);
			saveReport(basePath + "_matrix.csv", matrixCsv);

			// Display summary
			println(summaryReport);
			popup("BSim Analysis Complete!\n\n" +
				"Reports saved to:\n" +
				basePath + "_summary.txt\n" +
				basePath + "_detailed.md\n" +
				basePath + "_matches.csv\n" +
				basePath + "_matrix.csv\n\n" +
				"See console for summary.");
		}
	}

	private void processFunction(Function func, GenSignatures gensig, FunctionDatabase pgDatabase) throws Exception {
		DescriptionManager manager = gensig.getDescriptionManager();
		manager.clear();  // Clear previous function data
		gensig.scanFunction(func);

		if (manager.numFunctions() == 0) {
			return;
		}

		QueryNearest queryNearest = new QueryNearest();
		queryNearest.manage = manager;
		queryNearest.max = 100;
		queryNearest.thresh = similarityThreshold;
		queryNearest.signifthresh = 0.0;

		ResponseNearest response = queryNearest.execute(pgDatabase);
		if (response == null) {
			return;
		}

		String funcKey = func.getName() + "@" + func.getEntryPoint().toString();
		Map<String, FunctionMatch> matchesForFunc = new HashMap<>();

		for (SimilarityResult simResult : response.result) {
			Iterator<SimilarityNote> noteIter = simResult.iterator();
			while (noteIter.hasNext()) {
				SimilarityNote note = noteIter.next();
				FunctionDescription matchFunc = note.getFunctionDescription();
				ExecutableRecord matchExe = matchFunc.getExecutableRecord();
				String exeName = matchExe.getNameExec();

				// Skip self-matches
				if (exeName.equals(referenceProgram)) {
					continue;
				}

				BinaryStats stats = binaryStatsMap.get(exeName);
				if (stats == null) {
					continue;
				}

				// Track best match per executable
				FunctionMatch existing = matchesForFunc.get(exeName);
				double similarity = note.getSimilarity();

				if (existing == null || similarity > existing.similarity) {
					FunctionMatch match = new FunctionMatch();
					match.sourceFunctionName = func.getName();
					match.sourceFunctionAddress = func.getEntryPoint().toString();
					match.sourceIsNamed = isNamedFunction(func);
					match.targetExecutable = exeName;
					match.targetVersion = stats.version;  // Get version from stats
					match.targetFunctionName = matchFunc.getFunctionName();
					match.targetFunctionAddress = "0x" + Long.toHexString(matchFunc.getAddress());
					match.targetAddressLong = matchFunc.getAddress();
					match.similarity = similarity;
					match.confidence = note.getSignificance();
					match.isExactMatch = similarity >= exactMatchThreshold;
					match.isHighConfidence = similarity >= 0.9;

					matchesForFunc.put(exeName, match);
				}
			}
		}

		// Record matches and update statistics
		for (FunctionMatch match : matchesForFunc.values()) {
			allMatches.add(match);

			BinaryStats stats = binaryStatsMap.get(match.targetExecutable);
			stats.matchedFunctions++;
			stats.totalSimilarity += match.similarity;

			if (match.isExactMatch) {
				stats.exactMatches++;
			} else if (match.isHighConfidence) {
				stats.highConfidenceMatches++;
			} else {
				stats.partialMatches++;
			}

			if (match.sourceIsNamed) {
				stats.matchesFromNamedSource++;
			}
		}

		if (!matchesForFunc.isEmpty()) {
			crossVersionTable.put(funcKey, matchesForFunc);
			binaryStatsMap.get(referenceProgram).functionsWithMatches++;
		}
	}

	private void propagateToPrograms() throws Exception {
		Project project = state.getProject();
		if (project == null) {
			Msg.warn(this, "No project available for name propagation");
			return;
		}

		// Group matches by target executable
		Map<String, List<FunctionMatch>> matchesByExe = new HashMap<>();
		for (FunctionMatch match : allMatches) {
			if (match.sourceIsNamed) {  // Only propagate named functions
				matchesByExe.computeIfAbsent(match.targetExecutable, k -> new ArrayList<>()).add(match);
			}
		}

		// Find and process each target program
		List<DomainFile> programFiles = new ArrayList<>();
		collectProgramFiles(project.getProjectData().getRootFolder(), programFiles);

		int totalRenamed = 0;
		int totalComments = 0;

		for (DomainFile dFile : programFiles) {
			String fileName = dFile.getName();
			List<FunctionMatch> matches = matchesByExe.get(fileName);

			if (matches == null || matches.isEmpty()) {
				continue;
			}

			monitor.setMessage("Propagating names to: " + fileName);
			Program program = null;

			try {
				program = (Program) dFile.getDomainObject(this, true, false, monitor);

				int txId = program.startTransaction("BSim Name Propagation");
				try {
					for (FunctionMatch match : matches) {
						try {
							Function targetFunc = program.getFunctionManager()
								.getFunctionAt(program.getAddressFactory()
									.getDefaultAddressSpace().getAddress(match.targetAddressLong));

							if (targetFunc == null) {
								continue;
							}

							boolean renamed = false;
							boolean commented = false;

							// Rename if appropriate
							if (propagateNames && match.sourceIsNamed) {
								boolean shouldRename = !onlyRenameDefault || isDefaultName(targetFunc.getName());

								if (shouldRename && !targetFunc.getName().equals(match.sourceFunctionName)) {
									try {
										targetFunc.setName(match.sourceFunctionName, SourceType.IMPORTED);
										renamed = true;
										match.wasRenamed = true;
										binaryStatsMap.get(fileName).functionsRenamed++;
									} catch (DuplicateNameException | InvalidInputException e) {
										// Try with suffix
										try {
											String newName = match.sourceFunctionName + "_" +
												match.targetFunctionAddress.substring(2);
											targetFunc.setName(newName, SourceType.IMPORTED);
											renamed = true;
											match.wasRenamed = true;
											binaryStatsMap.get(fileName).functionsRenamed++;
										} catch (Exception e2) {
											Msg.warn(this, "Could not rename: " + e2.getMessage());
										}
									}
								}
							}

							// Add cross-reference comment
							if (addComments) {
								String comment = String.format(
									"[BSim Match] %s @ %s (%.1f%% similar)",
									match.sourceFunctionName,
									referenceProgram,
									match.similarity * 100);

								String existing = targetFunc.getComment();
								if (existing == null || !existing.contains("[BSim Match]")) {
									targetFunc.setComment(existing == null ? comment : existing + "\n" + comment);
									commented = true;
									binaryStatsMap.get(fileName).commentsAdded++;
								}
							}

							if (renamed) totalRenamed++;
							if (commented) totalComments++;

						} catch (Exception e) {
							Msg.warn(this, "Error processing match: " + e.getMessage());
						}
					}
					program.endTransaction(txId, true);
				} catch (Exception e) {
					program.endTransaction(txId, false);
					throw e;
				}

				// Save the program
				dFile.save(monitor);

			} catch (Exception e) {
				Msg.error(this, "Error processing " + fileName + ": " + e.getMessage(), e);
			} finally {
				if (program != null) {
					program.release(this);
				}
			}
		}

		Msg.info(this, "Propagation complete: " + totalRenamed + " functions renamed, " +
			totalComments + " comments added");
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

	private void calculateDerivedStats() {
		for (BinaryStats stats : binaryStatsMap.values()) {
			if (stats.isReference) {
				// Reference stats are calculated differently
				stats.matchPercentage = stats.totalFunctions > 0 ?
					(double) stats.functionsWithMatches / stats.totalFunctions * 100 : 0;
			} else {
				// For target binaries, we estimate total functions from database
				// (we don't have exact count without opening each file)
				if (stats.matchedFunctions > 0) {
					stats.averageSimilarity = stats.totalSimilarity / stats.matchedFunctions;
				}
			}
		}
	}

	private boolean isNamedFunction(Function func) {
		return !isDefaultName(func.getName());
	}

	private boolean isDefaultName(String name) {
		return name.startsWith("FUN_") ||
			   name.startsWith("thunk_FUN_") ||
			   name.startsWith("switchD_") ||
			   name.startsWith("caseD_") ||
			   name.matches("^[A-Za-z]+_[0-9a-fA-F]+$");
	}

	private void saveReport(String path, String content) throws Exception {
		try (PrintWriter pw = new PrintWriter(new FileWriter(path))) {
			pw.print(content);
		}
	}

	private String generateSummaryReport() {
		StringBuilder sb = new StringBuilder();
		sb.append("================================================================================\n");
		sb.append("                    BSIM CROSS-VERSION FUNCTION MATCHING REPORT\n");
		sb.append("================================================================================\n\n");

		sb.append("Generated: ").append(new Date()).append("\n");
		sb.append("Reference Program: ").append(referenceProgram);
		if (referenceVersion != null) {
			sb.append(" (Version: ").append(referenceVersion).append(")");
		}
		sb.append("\n");
		sb.append("Similarity Threshold: ").append(String.format("%.0f%%", similarityThreshold * 100)).append("\n");
		sb.append("Exact Match Threshold: ").append(String.format("%.0f%%", exactMatchThreshold * 100)).append("\n");
		if (targetVersionFilter != null) {
			sb.append("Target Version Filter: ").append(targetVersionFilter).append("\n");
		}
		if (!allVersions.isEmpty()) {
			sb.append("Versions in Database: ").append(String.join(", ", allVersions)).append("\n");
		}
		sb.append("\n");

		sb.append("--------------------------------------------------------------------------------\n");
		sb.append("                              OVERALL SUMMARY\n");
		sb.append("--------------------------------------------------------------------------------\n\n");

		BinaryStats refStats = binaryStatsMap.get(referenceProgram);
		sb.append(String.format("Reference Program Functions:     %,d\n", refStats.totalFunctions));
		sb.append(String.format("  - Named Functions:             %,d (%.1f%%)\n",
			refStats.namedFunctions,
			refStats.totalFunctions > 0 ? (double) refStats.namedFunctions / refStats.totalFunctions * 100 : 0));
		sb.append(String.format("  - Functions with Matches:      %,d (%.1f%%)\n",
			refStats.functionsWithMatches,
			refStats.totalFunctions > 0 ? (double) refStats.functionsWithMatches / refStats.totalFunctions * 100 : 0));
		sb.append(String.format("\nTotal Matches Found:             %,d\n", allMatches.size()));
		sb.append(String.format("Target Binaries Analyzed:        %d\n\n", binaryStatsMap.size() - 1));

		sb.append("--------------------------------------------------------------------------------\n");
		sb.append("                          PER-BINARY STATISTICS\n");
		sb.append("--------------------------------------------------------------------------------\n\n");

		// Header
		sb.append(String.format("%-32s %-10s %10s %10s %10s %10s %10s\n",
			"Binary", "Version", "Matches", "Exact", "High", "Partial", "Avg Sim"));
		sb.append(String.format("%-32s %-10s %10s %10s %10s %10s %10s\n",
			"--------------------------------", "----------",
			"----------", "----------", "----------", "----------", "----------"));

		// Sort by version then by match count descending
		List<BinaryStats> sortedStats = new ArrayList<>(binaryStatsMap.values());
		sortedStats.sort((a, b) -> {
			// First sort by version
			String vA = a.version != null ? a.version : "";
			String vB = b.version != null ? b.version : "";
			int vCmp = vA.compareTo(vB);
			if (vCmp != 0) return vCmp;
			// Then by match count descending
			return Integer.compare(b.matchedFunctions, a.matchedFunctions);
		});

		for (BinaryStats stats : sortedStats) {
			if (stats.isReference) continue;

			sb.append(String.format("%-32s %-10s %,10d %,10d %,10d %,10d %9.1f%%\n",
				truncate(stats.binaryName, 32),
				stats.version != null ? stats.version : "-",
				stats.matchedFunctions,
				stats.exactMatches,
				stats.highConfidenceMatches,
				stats.partialMatches,
				stats.averageSimilarity * 100));
		}

		sb.append("\n");
		sb.append("Legend:\n");
		sb.append("  Exact:   >= " + String.format("%.0f%%", exactMatchThreshold * 100) + " similarity (virtually identical)\n");
		sb.append("  High:    90-" + String.format("%.0f%%", exactMatchThreshold * 100) + " similarity (same function, minor changes)\n");
		sb.append("  Partial: " + String.format("%.0f%%", similarityThreshold * 100) + "-90% similarity (same function, significant changes)\n");

		if (propagateNames) {
			sb.append("\n--------------------------------------------------------------------------------\n");
			sb.append("                          PROPAGATION RESULTS\n");
			sb.append("--------------------------------------------------------------------------------\n\n");

			sb.append(String.format("%-32s %-10s %12s %12s\n", "Binary", "Version", "Renamed", "Comments"));
			sb.append(String.format("%-32s %-10s %12s %12s\n",
				"--------------------------------", "----------", "------------", "------------"));

			for (BinaryStats stats : sortedStats) {
				if (stats.isReference) continue;
				if (stats.functionsRenamed > 0 || stats.commentsAdded > 0) {
					sb.append(String.format("%-32s %-10s %,12d %,12d\n",
						truncate(stats.binaryName, 32),
						stats.version != null ? stats.version : "-",
						stats.functionsRenamed,
						stats.commentsAdded));
				}
			}
		}

		sb.append("\n================================================================================\n");

		return sb.toString();
	}

	private String generateDetailedReport() {
		StringBuilder sb = new StringBuilder();

		sb.append("# BSim Cross-Version Function Matching - Detailed Report\n\n");
		sb.append("**Generated:** ").append(new Date()).append("\n\n");
		sb.append("**Reference Program:** `").append(referenceProgram).append("`\n\n");

		// Configuration
		sb.append("## Configuration\n\n");
		sb.append("| Setting | Value |\n");
		sb.append("|---------|-------|\n");
		sb.append("| Similarity Threshold | ").append(String.format("%.0f%%", similarityThreshold * 100)).append(" |\n");
		sb.append("| Exact Match Threshold | ").append(String.format("%.0f%%", exactMatchThreshold * 100)).append(" |\n");
		sb.append("| Name Propagation | ").append(propagateNames ? "Enabled" : "Disabled").append(" |\n");
		sb.append("| Only Rename Default | ").append(onlyRenameDefault).append(" |\n\n");

		// Per-binary detailed stats
		sb.append("## Per-Binary Analysis\n\n");

		List<BinaryStats> sortedStats = new ArrayList<>(binaryStatsMap.values());
		sortedStats.sort((a, b) -> Integer.compare(b.matchedFunctions, a.matchedFunctions));

		for (BinaryStats stats : sortedStats) {
			if (stats.isReference) continue;

			sb.append("### ").append(stats.binaryName).append("\n\n");
			sb.append("| Metric | Value |\n");
			sb.append("|--------|-------|\n");
			sb.append("| Total Matches | ").append(stats.matchedFunctions).append(" |\n");
			sb.append("| Exact Matches (>=").append(String.format("%.0f%%", exactMatchThreshold * 100)).append(") | ");
			sb.append(stats.exactMatches).append(" |\n");
			sb.append("| High Confidence (90-").append(String.format("%.0f%%", exactMatchThreshold * 100)).append(") | ");
			sb.append(stats.highConfidenceMatches).append(" |\n");
			sb.append("| Partial Matches | ").append(stats.partialMatches).append(" |\n");
			sb.append("| Average Similarity | ").append(String.format("%.2f%%", stats.averageSimilarity * 100)).append(" |\n");
			if (propagateNames) {
				sb.append("| Functions Renamed | ").append(stats.functionsRenamed).append(" |\n");
				sb.append("| Comments Added | ").append(stats.commentsAdded).append(" |\n");
			}
			sb.append("\n");
		}

		// Match quality distribution
		sb.append("## Match Quality Distribution\n\n");
		int[] histogram = new int[10];  // 0-10%, 10-20%, etc.
		for (FunctionMatch match : allMatches) {
			int bucket = Math.min((int)(match.similarity * 10), 9);
			histogram[bucket]++;
		}

		sb.append("| Similarity Range | Count | Bar |\n");
		sb.append("|------------------|-------|-----|\n");
		int maxCount = 1;
		for (int count : histogram) {
			maxCount = Math.max(maxCount, count);
		}
		for (int i = 9; i >= 0; i--) {
			String range = String.format("%d%%-%d%%", i * 10, (i + 1) * 10);
			int barLen = (int)((double)histogram[i] / maxCount * 30);
			String bar = "█".repeat(Math.max(barLen, 0));
			sb.append(String.format("| %s | %,d | %s |\n", range, histogram[i], bar));
		}

		return sb.toString();
	}

	private String generateCsvReport() {
		StringBuilder sb = new StringBuilder();

		sb.append("Source Function,Source Address,Source Named,Target Binary,Target Version,Target Function,");
		sb.append("Target Address,Similarity,Confidence,Match Type,Was Renamed\n");

		for (FunctionMatch match : allMatches) {
			sb.append("\"").append(match.sourceFunctionName).append("\",");
			sb.append(match.sourceFunctionAddress).append(",");
			sb.append(match.sourceIsNamed).append(",");
			sb.append("\"").append(match.targetExecutable).append("\",");
			sb.append("\"").append(match.targetVersion != null ? match.targetVersion : "").append("\",");
			sb.append("\"").append(match.targetFunctionName).append("\",");
			sb.append(match.targetFunctionAddress).append(",");
			sb.append(String.format("%.4f", match.similarity)).append(",");
			sb.append(String.format("%.4f", match.confidence)).append(",");
			sb.append(match.isExactMatch ? "Exact" : (match.isHighConfidence ? "High" : "Partial")).append(",");
			sb.append(match.wasRenamed).append("\n");
		}

		return sb.toString();
	}

	private String generateCrossVersionMatrix() {
		StringBuilder sb = new StringBuilder();

		// Header row
		sb.append("Source Function,Source Address");
		for (String exe : allExecutableNames) {
			if (!exe.equals(referenceProgram)) {
				sb.append(",\"").append(exe).append(" Function\"");
				sb.append(",\"").append(exe).append(" Address\"");
				sb.append(",\"").append(exe).append(" Similarity\"");
			}
		}
		sb.append("\n");

		// Data rows
		for (Map.Entry<String, Map<String, FunctionMatch>> entry : crossVersionTable.entrySet()) {
			String[] parts = entry.getKey().split("@");
			String funcName = parts[0];
			String funcAddr = parts.length > 1 ? parts[1] : "";

			sb.append("\"").append(funcName).append("\",");
			sb.append(funcAddr);

			Map<String, FunctionMatch> matches = entry.getValue();
			for (String exe : allExecutableNames) {
				if (!exe.equals(referenceProgram)) {
					FunctionMatch match = matches.get(exe);
					if (match != null) {
						sb.append(",\"").append(match.targetFunctionName).append("\"");
						sb.append(",").append(match.targetFunctionAddress);
						sb.append(",").append(String.format("%.4f", match.similarity));
					} else {
						sb.append(",,,");
					}
				}
			}
			sb.append("\n");
		}

		return sb.toString();
	}

	private String truncate(String s, int maxLen) {
		if (s.length() <= maxLen) return s;
		return s.substring(0, maxLen - 3) + "...";
	}

	// Statistics container for each binary
	private static class BinaryStats {
		String binaryName;
		String version;  // Version from BSim category
		boolean isReference = false;

		// Counts
		int totalFunctions = 0;
		int namedFunctions = 0;
		int functionsWithMatches = 0;
		int matchedFunctions = 0;
		int exactMatches = 0;
		int highConfidenceMatches = 0;
		int partialMatches = 0;
		int matchesFromNamedSource = 0;

		// Propagation results
		int functionsRenamed = 0;
		int commentsAdded = 0;

		// Calculated
		double totalSimilarity = 0;
		double averageSimilarity = 0;
		double matchPercentage = 0;

		BinaryStats(String name) {
			this.binaryName = name;
		}
	}

	// Individual match record
	private static class FunctionMatch {
		String sourceFunctionName;
		String sourceFunctionAddress;
		boolean sourceIsNamed;

		String targetExecutable;
		String targetVersion;  // Version of the target executable
		String targetFunctionName;
		String targetFunctionAddress;
		long targetAddressLong;

		double similarity;
		double confidence;
		boolean isExactMatch;
		boolean isHighConfidence;
		boolean wasRenamed = false;
	}
}
