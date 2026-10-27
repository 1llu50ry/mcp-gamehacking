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
//Adds the "Version" executable category to an existing BSim PostgreSQL database.
//Run this once on existing databases to enable version tracking for binaries.
//@category BSim
import org.apache.commons.lang3.StringUtils;

import ghidra.app.script.GhidraScript;
import ghidra.features.base.values.GhidraValuesMap;
import ghidra.features.bsim.query.*;
import ghidra.features.bsim.query.BSimServerInfo.DBType;
import ghidra.features.bsim.query.FunctionDatabase.BSimError;
import ghidra.features.bsim.query.description.DatabaseInformation;
import ghidra.features.bsim.query.protocol.*;
import ghidra.util.MessageType;

public class AddVersionCategoryToDatabase extends GhidraScript {

	private static final String HOST = "Host";
	private static final String PORT = "Port";
	private static final String DATABASE_NAME = "Database Name";
	private static final String USERNAME = "Username";
	private static final String CATEGORY_NAME = "Category Name";

	private static final int DEFAULT_POSTGRES_PORT = 5432;
	private static final String DEFAULT_CATEGORY = "Version";

	@Override
	protected void run() throws Exception {
		if (isRunningHeadless()) {
			popup("This script requires GUI interaction.");
			return;
		}

		GhidraValuesMap values = new GhidraValuesMap();
		values.defineString(HOST, "localhost");
		values.defineInt(PORT, DEFAULT_POSTGRES_PORT);
		values.defineString(DATABASE_NAME, "bsim");
		values.defineString(USERNAME, System.getProperty("user.name"));
		values.defineString(CATEGORY_NAME, DEFAULT_CATEGORY);

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
			String dbName = valueMap.getString(DATABASE_NAME);
			if (StringUtils.isBlank(dbName)) {
				status.setStatusText("Database Name cannot be empty!", MessageType.ERROR);
				return false;
			}
			String categoryName = valueMap.getString(CATEGORY_NAME);
			if (StringUtils.isBlank(categoryName)) {
				status.setStatusText("Category Name cannot be empty!", MessageType.ERROR);
				return false;
			}
			return true;
		});

		askValues("Add Executable Category to BSim Database",
			"This will add a new executable category to enable version tracking.", values);

		String host = values.getString(HOST);
		int port = values.getInt(PORT);
		String dbName = values.getString(DATABASE_NAME);
		String username = values.getString(USERNAME);
		String categoryName = values.getString(CATEGORY_NAME);

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
				popup("Failed to retrieve database information. Is this a valid BSim database?");
				return;
			}

			// Check if category already exists
			if (dbInfo.execats != null) {
				for (String existingCat : dbInfo.execats) {
					if (existingCat.equals(categoryName)) {
						popup("Category '" + categoryName + "' already exists in database '" + dbName + "'.\n\n" +
							"Existing categories: " + String.join(", ", dbInfo.execats));
						return;
					}
				}
			}

			// Install the new category
			InstallCategoryRequest req = new InstallCategoryRequest();
			req.type_name = categoryName;
			ResponseInfo resp = req.execute(pgDatabase);

			if (resp == null) {
				BSimError lastError = pgDatabase.getLastError();
				String errorMsg = lastError != null ? lastError.message : "Unknown error";
				popup("Failed to install category '" + categoryName + "': " + errorMsg);
				return;
			}

			StringBuilder successMsg = new StringBuilder();
			successMsg.append("Successfully added category '").append(categoryName).append("' to database '");
			successMsg.append(dbName).append("'!\n\n");
			successMsg.append("You can now use AddProgramToPostgresBSimDatabaseScript with\n");
			successMsg.append("'Use Parent Folder as Version' enabled to tag binaries\n");
			successMsg.append("with their version based on folder structure.\n\n");
			successMsg.append("Example folder structure:\n");
			successMsg.append("  /1.00/Game.exe    -> Version: 1.00\n");
			successMsg.append("  /1.09d/Game.exe   -> Version: 1.09d\n");
			successMsg.append("  /1.14d/Game.exe   -> Version: 1.14d\n");

			popup(successMsg.toString());
		}
	}
}
