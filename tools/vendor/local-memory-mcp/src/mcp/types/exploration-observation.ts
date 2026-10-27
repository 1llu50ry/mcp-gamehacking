export type ObservationFreshness = "valid" | "stale" | "unverifiable";

export interface ExplorationEvidenceInput {
	file_path: string;
	symbol_id?: string | null;
	start_line?: number | null;
	end_line?: number | null;
	commit_sha?: string | null;
}

export interface ExplorationEvidence extends ExplorationEvidenceInput {
	id: string;
	observation_id: string;
	file_checksum: string | null;
	symbol_fingerprint: string | null;
	indexed_at: string | null;
	commit_sha: string | null;
	created_at: string;
}

export interface ExplorationObservationInput {
	subject: string;
	fact: string;
	confidence: number;
	evidence: ExplorationEvidenceInput[];
	task_id?: string | null;
	agent?: string | null;
	supersedes_id?: string | null;
}

export interface ExplorationObservation {
	id: string;
	owner: string;
	repo: string;
	subject: string;
	fact: string;
	confidence: number;
	task_id: string | null;
	agent: string | null;
	identity_hash: string;
	freshness: ObservationFreshness;
	stale_reason: string | null;
	last_verified_at: string | null;
	superseded_by: string | null;
	created_at: string;
	updated_at: string;
	evidence_count: number;
	evidence?: ExplorationEvidence[];
}

export interface ExplorationObservationRow extends Omit<
	ExplorationObservation,
	"confidence" | "evidence_count" | "evidence"
> {
	confidence: number;
	evidence_count?: number;
}
