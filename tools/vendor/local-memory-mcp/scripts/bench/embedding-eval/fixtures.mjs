import { createHash } from "crypto";
import { OWNER, REPO } from "./constants.mjs";

export function contentHash(text) {
	return createHash("sha256").update(text).digest("hex");
}

export function makeMemoryEntry(id, updatedAtIso, seq) {
	return {
		id,
		type: "code_fact",
		title: `bench queue memory ${id.slice(-6)}`,
		content: `bench queue content ${id.slice(-6)} seq ${seq} workspace memory embedding semantic search`,
		importance: 3,
		owner: OWNER,
		repo: REPO,
		created_at: updatedAtIso,
		updated_at: updatedAtIso,
		tags: ["bench"],
		metadata: {}
	};
}
