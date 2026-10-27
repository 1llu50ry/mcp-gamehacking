import { createHash, randomUUID } from "node:crypto";
import { BaseEntity } from "../storage/base";
import { fingerprintSymbol } from "../utils/source-fingerprint";
import type {
	ExplorationEvidence,
	ExplorationEvidenceInput,
	ExplorationObservation,
	ExplorationObservationInput,
	ExplorationObservationRow,
	CodebaseSymbol
} from "../types";

interface EvidenceRow {
	id: string;
	observation_id: string;
	file_path: string;
	symbol_id: string | null;
	start_line: number | null;
	end_line: number | null;
	file_checksum: string | null;
	symbol_fingerprint: string | null;
	indexed_at: string | null;
	commit_sha: string | null;
	created_at: string;
}

export interface ObservationQuery {
	owner: string;
	repo: string;
	subject?: string;
	task_id?: string;
	file_path?: string;
	symbol_id?: string;
	min_confidence?: number;
	include_stale?: boolean;
	limit?: number;
	offset?: number;
}

interface EvidenceFingerprint {
	fileChecksum: string | null;
	symbolFingerprint: string | null;
	indexedAt: string | null;
	freshness: "valid" | "unverifiable";
}

export interface ObservationWriteResult {
	observation: ExplorationObservation;
	created: boolean;
}

function normalizeIdentityText(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function evidenceIdentity(evidence: ExplorationEvidenceInput): string {
	return [
		evidence.file_path.trim(),
		evidence.symbol_id?.trim() ?? "",
		evidence.start_line ?? "",
		evidence.end_line ?? ""
	].join("\u001f");
}

export function observationIdentity(input: ExplorationObservationInput): string {
	const normalizedEvidence = [...new Set(input.evidence.map(evidenceIdentity))].sort();
	return createHash("sha256")
		.update(
			[normalizeIdentityText(input.subject), normalizeIdentityText(input.fact), ...normalizedEvidence].join("\u001e")
		)
		.digest("hex");
}

export class ExplorationObservationEntity extends BaseEntity {
	upsertMany(
		owner: string,
		repo: string,
		inputs: ExplorationObservationInput[],
		updateId?: string
	): ObservationWriteResult[] {
		return this.transaction(() => inputs.map((input) => this.upsert(owner, repo, input, updateId)));
	}

	private fingerprintEvidence(repo: string, evidence: ExplorationEvidenceInput): EvidenceFingerprint {
		const file = this.get<{ checksum: string | null; last_indexed_at: string | null }>(
			"SELECT checksum, last_indexed_at FROM derived.codebase_files WHERE repo = ? AND file_path = ?",
			[repo, evidence.file_path]
		);
		if (!file?.checksum) {
			return {
				fileChecksum: null,
				symbolFingerprint: null,
				indexedAt: null,
				freshness: "unverifiable"
			};
		}
		if (!evidence.symbol_id) {
			return {
				fileChecksum: file.checksum,
				symbolFingerprint: null,
				indexedAt: file.last_indexed_at,
				freshness: "valid"
			};
		}
		const symbol = this.get<CodebaseSymbol>(
			"SELECT * FROM derived.codebase_symbols WHERE id = ? AND repo = ? AND file_path = ?",
			[evidence.symbol_id, repo, evidence.file_path]
		);
		return {
			fileChecksum: file.checksum,
			symbolFingerprint: symbol ? fingerprintSymbol(symbol) : null,
			indexedAt: file.last_indexed_at,
			freshness: symbol ? "valid" : "unverifiable"
		};
	}

	private upsert(
		owner: string,
		repo: string,
		input: ExplorationObservationInput,
		updateId?: string
	): ObservationWriteResult {
		const identityHash = observationIdentity(input);
		const existing = updateId
			? this.get<ExplorationObservationRow>(
					"SELECT *, 0 AS evidence_count FROM exploration_observations WHERE id = ? AND owner = ? AND repo = ?",
					[updateId, owner, repo]
				)
			: this.get<ExplorationObservationRow>(
					"SELECT *, 0 AS evidence_count FROM exploration_observations WHERE owner = ? AND repo = ? AND identity_hash = ?",
					[owner, repo, identityHash]
				);

		const now = new Date().toISOString();
		const fingerprints = input.evidence.map((evidence) => this.fingerprintEvidence(repo, evidence));
		const freshness = fingerprints.every((fingerprint) => fingerprint.freshness === "valid") ? "valid" : "unverifiable";
		if (existing) {
			// A hash match without an explicit id is an idempotent retry: return the
			// existing row byte-for-byte instead of churning updated_at/evidence.
			if (!updateId) {
				return { observation: this.getById(owner, repo, existing.id, true)!, created: false };
			}
			this.run(
				`UPDATE exploration_observations
				 SET subject = ?, fact = ?, confidence = ?, task_id = ?, agent = ?, identity_hash = ?, freshness = ?,
				     stale_reason = ?, last_verified_at = ?, updated_at = ?
				 WHERE id = ? AND owner = ? AND repo = ?`,
				[
					input.subject,
					input.fact,
					input.confidence,
					input.task_id ?? null,
					input.agent ?? null,
					identityHash,
					freshness,
					freshness === "valid" ? null : "source_not_indexed",
					freshness === "valid" ? now : null,
					now,
					existing.id,
					owner,
					repo
				]
			);
			this.replaceEvidence(existing.id, input.evidence, fingerprints, now);
			if (input.supersedes_id) this.markSuperseded(owner, repo, input.supersedes_id, existing.id, now);
			return { observation: this.getById(owner, repo, existing.id, true)!, created: false };
		}

		if (updateId) throw new Error(`Exploration observation not found: ${updateId}`);
		const id = randomUUID();
		this.run(
			`INSERT INTO exploration_observations
			 (id, owner, repo, subject, fact, confidence, task_id, agent, identity_hash, freshness, stale_reason, last_verified_at, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				owner,
				repo,
				input.subject,
				input.fact,
				input.confidence,
				input.task_id ?? null,
				input.agent ?? null,
				identityHash,
				freshness,
				freshness === "valid" ? null : "source_not_indexed",
				freshness === "valid" ? now : null,
				now,
				now
			]
		);
		this.replaceEvidence(id, input.evidence, fingerprints, now);
		if (input.supersedes_id) this.markSuperseded(owner, repo, input.supersedes_id, id, now);
		return { observation: this.getById(owner, repo, id, true)!, created: true };
	}

	private replaceEvidence(
		observationId: string,
		evidence: ExplorationEvidenceInput[],
		fingerprints: EvidenceFingerprint[],
		now: string
	): void {
		this.run("DELETE FROM exploration_evidence WHERE observation_id = ?", [observationId]);
		const unique = new Map(
			evidence.map((item, index) => [evidenceIdentity(item), { item, fingerprint: fingerprints[index]! }])
		);
		for (const { item, fingerprint } of unique.values()) {
			this.run(
				`INSERT INTO exploration_evidence
				 (id, observation_id, file_path, symbol_id, start_line, end_line,
				  file_checksum, symbol_fingerprint, indexed_at, commit_sha, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					randomUUID(),
					observationId,
					item.file_path,
					item.symbol_id ?? null,
					item.start_line ?? null,
					item.end_line ?? null,
					fingerprint.fileChecksum,
					fingerprint.symbolFingerprint,
					fingerprint.indexedAt,
					item.commit_sha ?? null,
					now
				]
			);
		}
	}

	private markSuperseded(owner: string, repo: string, oldId: string, newId: string, now: string): void {
		if (oldId === newId) throw new Error("An observation cannot supersede itself");
		const result = this.run(
			`UPDATE exploration_observations
			 SET freshness = 'stale', stale_reason = 'superseded', superseded_by = ?, updated_at = ?
			 WHERE id = ? AND owner = ? AND repo = ?`,
			[newId, now, oldId, owner, repo]
		);
		if (result.changes === 0) throw new Error(`Superseded exploration observation not found: ${oldId}`);
	}

	markFilesStale(repo: string, filePaths: string[], reason: string): number {
		if (filePaths.length === 0) return 0;
		const placeholders = filePaths.map(() => "?").join(",");
		return this.run(
			`UPDATE exploration_observations
			 SET freshness = 'stale', stale_reason = ?, updated_at = ?
			 WHERE repo = ? AND id IN (
				SELECT DISTINCT observation_id FROM exploration_evidence WHERE file_path IN (${placeholders})
			 )`,
			[reason, new Date().toISOString(), repo, ...filePaths]
		).changes;
	}

	transferEvidencePath(repo: string, oldPath: string, newPath: string): number {
		return this.run(
			`UPDATE exploration_evidence SET file_path = ?
			 WHERE file_path = ? AND observation_id IN (
				SELECT id FROM exploration_observations WHERE repo = ?
			 )`,
			[newPath, oldPath, repo]
		).changes;
	}

	refreshByIds(owner: string, repo: string, ids: string[]): ExplorationObservation[] {
		const uniqueIds = [...new Set(ids)].slice(0, 100);
		return this.transaction(() =>
			uniqueIds.flatMap((id) => {
				const observation = this.getById(owner, repo, id, true);
				return observation ? [this.refreshOne(observation)] : [];
			})
		);
	}

	refreshForFiles(repo: string, filePaths: string[], limit = 1000): number {
		if (filePaths.length === 0) return 0;
		const placeholders = filePaths.map(() => "?").join(",");
		const rows = this.all<{ owner: string; id: string }>(
			`SELECT DISTINCT o.owner, o.id
			 FROM exploration_observations o
			 JOIN exploration_evidence e ON e.observation_id = o.id
			 WHERE o.repo = ? AND e.file_path IN (${placeholders})
			 ORDER BY o.id LIMIT ?`,
			[repo, ...filePaths, limit]
		);
		this.transaction(() => {
			for (const row of rows) {
				const observation = this.getById(row.owner, repo, row.id, true);
				if (observation) this.refreshOne(observation);
			}
		});
		return rows.length;
	}

	private refreshOne(observation: ExplorationObservation): ExplorationObservation {
		const evidence = observation.evidence ?? [];
		let state: "valid" | "stale" | "unverifiable" = "valid";
		let reason: string | null = null;
		const setState = (next: "stale" | "unverifiable", nextReason: string): void => {
			if (state === "stale" || (state === "unverifiable" && next === "unverifiable")) return;
			state = next;
			reason = nextReason;
		};
		const now = new Date().toISOString();
		if (observation.superseded_by) return observation;
		for (const item of evidence) {
			const file = this.get<{ checksum: string | null; last_indexed_at: string | null }>(
				"SELECT checksum, last_indexed_at FROM derived.codebase_files WHERE repo = ? AND file_path = ?",
				[observation.repo, item.file_path]
			);
			if (!file?.checksum) {
				setState("unverifiable", "source_not_indexed");
				continue;
			}
			if (!item.symbol_id) {
				if (item.file_checksum && item.file_checksum !== file.checksum) {
					setState("stale", "file_changed");
				} else {
					this.updateEvidenceFingerprint(item.id, file.checksum, null, null, file.last_indexed_at);
				}
				continue;
			}
			const symbols = this.all<CodebaseSymbol>(
				"SELECT * FROM derived.codebase_symbols WHERE repo = ? AND file_path = ? ORDER BY start_line",
				[observation.repo, item.file_path]
			);
			if (!item.symbol_fingerprint) {
				const exact = symbols.find((symbol) => symbol.id === item.symbol_id);
				if (!exact) {
					setState("unverifiable", "symbol_not_indexed");
					continue;
				}
				this.updateEvidenceFingerprint(
					item.id,
					file.checksum,
					exact.id,
					fingerprintSymbol(exact),
					file.last_indexed_at
				);
				continue;
			}
			const current = symbols.find((symbol) => fingerprintSymbol(symbol) === item.symbol_fingerprint);
			if (!current) {
				setState("stale", symbols.length > 0 ? "symbol_changed" : "symbol_deleted");
				continue;
			}
			this.updateEvidenceFingerprint(
				item.id,
				file.checksum,
				current.id,
				fingerprintSymbol(current),
				file.last_indexed_at
			);
		}
		this.run(
			`UPDATE exploration_observations
			 SET freshness = ?, stale_reason = ?, last_verified_at = ?, updated_at = ?
			 WHERE id = ? AND owner = ? AND repo = ?`,
			[
				state,
				reason,
				state === "valid" ? now : observation.last_verified_at,
				now,
				observation.id,
				observation.owner,
				observation.repo
			]
		);
		return this.getById(observation.owner, observation.repo, observation.id, true)!;
	}

	private updateEvidenceFingerprint(
		id: string,
		fileChecksum: string,
		symbolId: string | null,
		fingerprint: string | null,
		indexedAt: string | null
	): void {
		this.run(
			`UPDATE exploration_evidence
			 SET file_checksum = ?, symbol_id = ?, symbol_fingerprint = ?, indexed_at = ?
			 WHERE id = ?`,
			[fileChecksum, symbolId, fingerprint, indexedAt, id]
		);
	}

	getById(owner: string, repo: string, id: string, hydrateEvidence = false): ExplorationObservation | null {
		const row = this.get<ExplorationObservationRow>(
			`SELECT o.*, COUNT(e.id) AS evidence_count
			 FROM exploration_observations o
			 LEFT JOIN exploration_evidence e ON e.observation_id = o.id
			 WHERE o.id = ? AND o.owner = ? AND o.repo = ?
			 GROUP BY o.id`,
			[id, owner, repo]
		);
		return row ? this.hydrate(row, hydrateEvidence) : null;
	}

	list(query: ObservationQuery, hydrateEvidence = false): ExplorationObservation[] {
		const conditions = ["o.owner = ?", "o.repo = ?", "o.confidence >= ?"];
		const values: unknown[] = [query.owner, query.repo, query.min_confidence ?? 0];
		if (!query.include_stale) conditions.push("o.freshness = 'valid' AND o.superseded_by IS NULL");
		if (query.subject) {
			conditions.push("o.subject LIKE ?");
			values.push(`%${query.subject}%`);
		}
		if (query.task_id) {
			conditions.push("o.task_id = ?");
			values.push(query.task_id);
		}
		if (query.file_path) {
			conditions.push(
				"EXISTS (SELECT 1 FROM exploration_evidence ef WHERE ef.observation_id = o.id AND ef.file_path = ?)"
			);
			values.push(query.file_path);
		}
		if (query.symbol_id) {
			conditions.push(
				"EXISTS (SELECT 1 FROM exploration_evidence es WHERE es.observation_id = o.id AND es.symbol_id = ?)"
			);
			values.push(query.symbol_id);
		}
		values.push(query.limit ?? 20, query.offset ?? 0);
		const rows = this.all<ExplorationObservationRow>(
			`SELECT o.*, COUNT(e.id) AS evidence_count
			 FROM exploration_observations o
			 LEFT JOIN exploration_evidence e ON e.observation_id = o.id
			 WHERE ${conditions.join(" AND ")}
			 GROUP BY o.id
			 ORDER BY o.confidence DESC, o.updated_at DESC, o.id ASC
			 LIMIT ? OFFSET ?`,
			values
		);
		return rows.map((row) => this.hydrate(row, hydrateEvidence));
	}

	private hydrate(row: ExplorationObservationRow, includeEvidence: boolean): ExplorationObservation {
		const observation: ExplorationObservation = { ...row, evidence_count: Number(row.evidence_count ?? 0) };
		if (includeEvidence) {
			observation.evidence = this.all<EvidenceRow>(
				`SELECT id, observation_id, file_path, symbol_id, start_line, end_line,
				        file_checksum, symbol_fingerprint, indexed_at, commit_sha, created_at
				 FROM exploration_evidence WHERE observation_id = ? ORDER BY file_path, start_line, id`,
				[row.id]
			) as ExplorationEvidence[];
		}
		return observation;
	}
}
