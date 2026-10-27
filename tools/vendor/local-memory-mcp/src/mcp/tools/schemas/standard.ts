import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";

export const StandardDeleteSchema = z
	.object({
		id: z
			.string()
			.optional()
			.describe("Single standard UUID or code to delete (auto-inferred: UUID→direct, string→code lookup)."),
		code: z.string().max(20).optional().describe("Single standard code to delete."),
		ids: z
			.array(z.string())
			.min(1)
			.optional()
			.describe("Array of standard UUIDs or codes to delete (bulk, auto-inferred per item)."),
		codes: z.array(z.string().max(20)).min(1).optional().describe("Array of standard codes to delete (bulk)."),
		owner: z.string().optional().describe("GitHub org or username. Auto-inferred."),
		repo: z.string().transform(normalizeRepo).optional().describe("Repo name. Auto-inferred."),
		json: z.boolean().default(false).describe("Returns JSON if true.")
	})
	.refine(
		(data) => data.id !== undefined || data.ids !== undefined || data.code !== undefined || data.codes !== undefined,
		{
			message: "Either 'id', 'code', 'ids', or 'codes' must be provided for deletion"
		}
	)
	.describe("Delete coding standards. Single or bulk. Auto-infers: UUID→direct ID, non-UUID→code lookup.");
