import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 8,
	name: "observations-observation-index",
	up: (db) => {
		db.exec("CREATE INDEX IF NOT EXISTS idx_observations_observation ON observations(observation)");
		logger.info("[Migration] Added index idx_observations_observation on observations(observation)");
	}
};
