import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";

export const ExplorationEvidenceSchema = z
	.object({
		file_path: z.string().min(1).max(1024),
		symbol_id: z.string().min(1).max(255).nullable().optional(),
		start_line: z.number().int().positive().nullable().optional(),
		end_line: z.number().int().positive().nullable().optional(),
		commit_sha: z.string().min(7).max(64).nullable().optional()
	})
	.superRefine((item, ctx) => {
		if (item.end_line && !item.start_line) {
			ctx.addIssue({
				code: "custom",
				path: ["start_line"],
				message: "start_line is required when end_line is provided"
			});
		}
		if (item.start_line && item.end_line && item.end_line < item.start_line) {
			ctx.addIssue({
				code: "custom",
				path: ["end_line"],
				message: "end_line must be greater than or equal to start_line"
			});
		}
	});

export const ExplorationObservationItemSchema = z.object({
	subject: z.string().trim().min(1).max(255),
	fact: z.string().trim().min(10).max(5000),
	confidence: z.number().min(0).max(1),
	evidence: z.array(ExplorationEvidenceSchema).min(1).max(50),
	task_id: z.string().min(1).max(255).nullable().optional(),
	agent: z.string().min(1).max(255).nullable().optional(),
	supersedes_id: z.string().uuid().nullable().optional()
});

export const ExplorationObservationWriteSchema = z
	.object({
		owner: z.string().min(1),
		repo: z.string().min(1).transform(normalizeRepo),
		id: z.string().uuid().optional(),
		subject: z.string().trim().min(1).max(255).optional(),
		fact: z.string().trim().min(10).max(5000).optional(),
		confidence: z.number().min(0).max(1).optional(),
		evidence: z.array(ExplorationEvidenceSchema).min(1).max(50).optional(),
		task_id: z.string().min(1).max(255).nullable().optional(),
		agent: z.string().min(1).max(255).nullable().optional(),
		supersedes_id: z.string().uuid().nullable().optional(),
		observations: z.array(ExplorationObservationItemSchema).min(1).max(100).optional(),
		refresh_ids: z.array(z.string().uuid()).min(1).max(100).optional(),
		json: z.boolean().default(false)
	})
	.superRefine((data, ctx) => {
		if (data.refresh_ids) {
			if (data.id || data.observations || data.subject || data.fact || data.confidence !== undefined || data.evidence) {
				ctx.addIssue({ code: "custom", message: "refresh_ids cannot be combined with create, update, or bulk fields" });
			}
			return;
		}
		if (data.observations && data.id)
			ctx.addIssue({ code: "custom", message: "observations cannot be combined with id" });
		if (data.observations) return;

		for (const field of ["subject", "fact", "confidence", "evidence"] as const) {
			if (data[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: `${field} is required` });
		}
	});

export const ExplorationObservationReadSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	id: z.string().uuid().optional(),
	subject: z.string().min(1).optional(),
	task_id: z.string().min(1).optional(),
	file_path: z.string().min(1).optional(),
	symbol_id: z.string().min(1).optional(),
	min_confidence: z.number().min(0).max(1).default(0),
	include_stale: z.boolean().default(false),
	hydrate_evidence: z.boolean().default(false),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	offset: z.coerce.number().int().min(0).default(0),
	json: z.boolean().default(false)
});

export type ExplorationObservationWriteInput = z.infer<typeof ExplorationObservationWriteSchema>;
export type ExplorationObservationReadInput = z.infer<typeof ExplorationObservationReadSchema>;
