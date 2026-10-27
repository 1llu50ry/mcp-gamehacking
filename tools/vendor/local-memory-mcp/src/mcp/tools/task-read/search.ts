import { SQLiteStore } from "../../storage/sqlite";
import { Task, VectorStore, TASK_STATUSES, TaskComment } from "../../types";
import { buildTableResult, createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { TaskStatusValues } from "../schemas/index";
import { logger } from "../../utils/logger";
import { fetchAggregatedTaskKgContext } from "../kg-archivist/query";
import { capitalize } from "./shared";
import { TASK_SCORING } from "../../utils/scoring";
import { HybridSearchEngine } from "../../utils/hybrid-search";
import type { ScoredEntity } from "../../utils/hybrid-search";
import { SEARCH_THRESHOLDS } from "../../utils/constants";
import { renderGroupedSummary, enumOrderComparator, formatOutputLegend } from "../../utils/summary";
import { collectIssueRefsFrom, extractQueryIssueTokens } from "../../utils/issue-ref";

// ── Task-specific scoring helpers ─────────────────────────────────────
// Task domain/recency/confidence live in TASK_SCORING (utils/scoring.ts,
// OPT-DRY-04) — see its docblock for the task-specific semantics
// (query-coverage domain denominator, 30-day recency half-life, 0.7/0.4
// confidence buckets).

// ── ScoredTask internal type ───────────────────────────────────────────

interface ScoredTask {
	task: Task;
	similarityScore: number;
	keywordScore: number;
	recencyScore: number;
	domainScore: number;
	finalScore: number;
}

/** Why a task made the result set (TASK-422): structurally linked to an
 * issue the query is about, vs. a plain fuzzy keyword/semantic text match. */
type MatchReason = "issue" | "text";

function toScoredTask(st: ScoredEntity<Task>): ScoredTask {
	return {
		task: st.entity,
		similarityScore: st.similarityScore,
		keywordScore: st.keywordScore,
		recencyScore: st.recencyScore,
		domainScore: st.domainScore,
		finalScore: st.finalScore
	};
}

// ── SEARCH mode — Hybrid vector + keyword + recency + domain scoring ──────

export async function handleSearchMode(
	owner: string,
	repo: string,
	query: string | undefined,
	status: string | undefined,
	phase: string | undefined,
	priority: number | undefined,
	issueRef: string | undefined,
	limit: number,
	offset: number,
	isJsonRequest: boolean,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	// query can be absent when only `issue_ref` was given (TASK-422) — the
	// search then lists/ranks every task structurally linked to the issue.
	const queryText = (query ?? "").trim();
	const hasQuery = queryText.length > 0;
	const searchTerm = hasQuery ? queryText : undefined;

	// 1. Get keyword candidates from SQL (existing approach)
	let keywordTasks: Task[];
	if (status) {
		if (status === "all") {
			keywordTasks = storage.tasks.getTasksByMultipleStatuses(owner, repo, [], undefined, undefined, searchTerm);
		} else {
			const statuses = status
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			if (statuses.length > 1) {
				keywordTasks = storage.tasks.getTasksByMultipleStatuses(
					owner,
					repo,
					statuses,
					undefined,
					undefined,
					searchTerm
				);
			} else {
				keywordTasks = storage.tasks.getTasksByRepo(owner, repo, status, undefined, undefined, searchTerm);
			}
		}
	} else {
		keywordTasks = storage.tasks.getTasksByMultipleStatuses(
			owner,
			repo,
			[...TaskStatusValues],
			undefined,
			undefined,
			searchTerm
		);
	}

	// 2. Hybrid vector scoring through the shared engine (OPT-DRY-01).
	// The engine owns vector+keyword merge, sort, threshold, guarantee,
	// the FTS5 supplement + phase/priority filters (postFilter), and
	// pagination. This file keeps ONLY the candidate fetch + domain/recency
	// signal computation (EntityScorer below).
	const queryTerms = queryText.split(/\s+/).filter(Boolean);
	const fetchLimit = (offset + limit) * 3;

	// No free-text query → skip the vector search entirely (an empty-embedding
	// query has nothing to rank against); the engine's keyword-only fallback
	// path scores every candidate uniformly and the issue_ref postFilter
	// narrows the pool.
	const vectorResults = hasQuery
		? await vectors.search(queryText, fetchLimit, repo, "task").catch((error) => {
				logger.warn("[Tool] task-read/search vector search failed, using keyword-only fallback", {
					error: String(error)
				});
				return null;
			})
		: null;
	const vectorScoreMap = new Map((vectorResults ?? []).map((vr) => [vr.id, vr.score]));

	// Vector-only results (semantic matches not caught by SQL LIKE) are
	// fetched here and merged in by the engine (merge: "supplement"). A DB
	// failure fetching them (SQLITE_BUSY/corruption) must NOT reject the whole
	// search — degrade to an empty map: vector scores still apply to keyword
	// candidates, only the vector-only supplement is dropped.
	//
	// issue #108: the vector store search is REPO-scoped (getTaskVectorCandidates
	// filters on `repo` only) while the keyword fetch is OWNER-scoped. Without an
	// owner guard a same-code task that lives under a DIFFERENT owner in the same
	// repo enters as a vector-only supplement, so the search renders the "same"
	// task twice at different scores (keyword 1.0 vs vector-only 0.0). Keep the
	// supplement inside the requested owner scope.
	let vectorEntities: ReadonlyMap<string, Task> = new Map();
	if (vectorResults) {
		const keywordIdSet = new Set(keywordTasks.map((t: Task) => t.id));
		const vectorOnlyIds = vectorResults.filter((vr) => !keywordIdSet.has(vr.id)).map((vr) => vr.id);
		if (vectorOnlyIds.length > 0) {
			try {
				const vectorOnlyTasks = storage.tasks
					.getTasksByIds(vectorOnlyIds)
					.filter((t: Task) => !owner || t.owner === owner);
				vectorEntities = new Map(vectorOnlyTasks.map((t: Task) => [t.id, t]));
			} catch (error) {
				logger.warn("[Tool] task-read/search vector-entity fetch failed, dropping vector-only supplement", {
					error: String(error)
				});
			}
		}
	}

	// ── Issue-reference analysis (TASK-422) ──────────────────────────────
	// Issue tokens the query is ABOUT ("#544", "issue 544") — a task is
	// "linked" when one of its structural refs matches a query token.
	const queryIssueTokens = extractQueryIssueTokens(queryText);
	// Filled by postFilter for every item of the final eligible pool:
	// task id → structural #NNN refs. Comment content is only scanned for
	// issue-scoped searches (issueRef set / query carries issue tokens) —
	// a generic text query fills this from title + description alone
	// (TASK-436, gated comment fetch).
	const issueRefsByTaskId = new Map<string, string[]>();

	const { items, total, eligible } = HybridSearchEngine.run<Task>({
		candidates: keywordTasks.map((t: Task) => ({ entity: t, similarity: vectorScoreMap.get(t.id) ?? 0 })),
		queryTerms,
		vectorResults,
		vectorEntities,
		scorer: {
			idOf: (task) => task.id,
			scoreCandidate: (task, similarity) => ({
				similarity,
				keyword: 1.0, // Task matched the SQL LIKE query
				recency: TASK_SCORING.recency(task),
				domain: TASK_SCORING.domain(task, { queryTerms })
			}),
			scoreVectorOnly: (task, hit) => ({
				similarity: hit.score,
				keyword: 0,
				recency: TASK_SCORING.recency(task),
				domain: TASK_SCORING.domain(task, { queryTerms })
			}),
			scoreFallback: (task, _similarity) => ({
				similarity: 0,
				keyword: 1.0,
				recency: TASK_SCORING.recency(task),
				domain: TASK_SCORING.domain(task, { queryTerms })
			})
		},
		thresholds: SEARCH_THRESHOLDS.task,
		merge: "supplement",
		offset,
		limit,
		postFilter: (eligible, context) => {
			let list = eligible;
			// 5. FTS5 fallback — if eligible results are fewer than requested
			// limit, supplement with keyword-only scored results (tasks that
			// matched SQL LIKE)
			if (list.length < offset + limit) {
				const eligibleIdSet = new Set(list.map((st) => st.entity.id));
				const fallbackTasks = context.allScored
					.filter((st) => !eligibleIdSet.has(st.entity.id) && st.keywordScore > 0)
					.slice(0, offset + limit - list.length);
				list = [...list, ...fallbackTasks];
			}
			// 6. In-memory phase filter
			if (phase) {
				const phaseLower = phase.toLowerCase();
				list = list.filter((st) => st.entity.phase && st.entity.phase.toLowerCase() === phaseLower);
			}
			// 7. In-memory priority filter
			if (priority !== undefined) {
				list = list.filter((st) => st.entity.priority === priority);
			}
			// 8. Issue-reference analysis (TASK-422): detect structural #NNN
			// refs for every item of the final pool — the markers/filter below
			// reuse this map.
			//
			// TASK-436 (perf): comment-based ref detection is GATED to
			// issue-scoped searches (`issueRef` set OR the query carries issue
			// tokens). Comment rows only matter for proving an issue link: a
			// generic text query consumes `issue_refs` purely as a display
			// column (title/description suffice), and a task whose
			// title/description ALREADY reference the requested issue passes
			// the issueRef filter regardless of what its comments contain. This
			// keeps the previously unconditional batched fetch from reading
			// O(total comments) on every search — e.g. an issue_ref-only search
			// (searchTerm undefined) whose un-thresholded pool is the whole
			// repo, or any generic keyword query.
			if (list.length > 0) {
				const wantsCommentRefs = Boolean(issueRef) || queryIssueTokens.length > 0;
				const preMatchedIds = new Set<string>();
				if (issueRef) {
					for (const st of list) {
						if (collectIssueRefsFrom([st.entity.title, st.entity.description]).includes(issueRef)) {
							preMatchedIds.add(st.entity.id);
						}
					}
				}
				// When issueRef is set, skip comment fetches for tasks already
				// linked via title/description — their comments cannot change
				// the filter outcome, so they only cost I/O.
				const commentFetchIds = wantsCommentRefs
					? list.filter((st) => !preMatchedIds.has(st.entity.id)).map((st) => st.entity.id)
					: [];
				const commentFetchSet = new Set(commentFetchIds);
				let commentsByTask = new Map<string, TaskComment[]>();
				if (commentFetchIds.length > 0) {
					try {
						const comments = storage.taskComments.getTaskCommentsByTaskIds(commentFetchIds);
						for (const c of comments) {
							if (!commentsByTask.has(c.task_id)) commentsByTask.set(c.task_id, []);
							commentsByTask.get(c.task_id)!.push(c);
						}
					} catch (error) {
						// A comment-fetch failure must not reject the whole search —
						// degrade to title/description-only ref detection.
						commentsByTask = new Map();
						logger.warn("[Tool] task-read/search comment fetch failed, issue refs limited to title/description", {
							error: String(error)
						});
					}
				}
				for (const st of list) {
					const task = st.entity;
					const sources = [task.title, task.description];
					if (commentFetchSet.has(task.id)) {
						sources.push(...(commentsByTask.get(task.id) ?? []).map((c) => c.comment));
					}
					issueRefsByTaskId.set(task.id, collectIssueRefsFrom(sources));
				}
			}
			// 9. Explicit issue_ref filter — keep ONLY tasks structurally linked
			// to the requested issue ("hanya task dengan [#544]").
			if (issueRef) {
				list = list.filter((st) => (issueRefsByTaskId.get(st.entity.id) ?? []).includes(issueRef));
			}
			return list;
		}
	});

	const paginated: ScoredTask[] = items.map(toScoredTask);

	// FULL match pool (pre-pagination, post-filter) — used so the text
	// summary groups EVERY status that matched, not just the top-N page.
	// Without this, a page that happens to be all `completed` hides the
	// pending/in_progress/backlog/blocked matches entirely (TASK-421).
	const scoredPool: ScoredTask[] = eligible.map(toScoredTask);

	const COLUMNS = [
		"id",
		"task_code",
		"title",
		"status",
		"priority",
		"score",
		"confidence",
		"updated_at",
		"phase",
		// TASK-422 (appended — additive, does not reorder the existing contract)
		"issue_refs",
		"match_reason"
	] as const;
	const rows = paginated.map((st: ScoredTask) => {
		const refs = issueRefsByTaskId.get(st.task.id) ?? [];
		const matchedTokens = issueRef
			? refs.includes(issueRef)
				? [issueRef]
				: []
			: queryIssueTokens.filter((t) => refs.includes(t));
		const matchReason: MatchReason = matchedTokens.length > 0 ? "issue" : "text";
		return [
			st.task.id,
			st.task.task_code,
			st.task.title,
			st.task.status,
			st.task.priority,
			Number(st.finalScore.toFixed(4)),
			TASK_SCORING.confidence({ finalScore: st.finalScore, keywordScore: st.keywordScore }),
			st.task.updated_at,
			st.task.phase,
			refs.map((r) => `#${r}`).join(","),
			matchReason
		];
	});

	const structuredData = buildTableResult(COLUMNS, rows, {
		schema: "task-read/search",
		mode: "search",
		key: "results",
		count: paginated.length,
		total,
		offset,
		limit,
		extra: { query: queryText }
	});

	// Best-effort KG context (REFACTOR-KG-004) — gated on the json flag
	// (audit F3): the payload only ships inside `structuredContent`.
	if (isJsonRequest && paginated.length > 0) {
		const kgData = fetchAggregatedTaskKgContext(
			storage,
			repo,
			paginated.map((st: ScoredTask) => st.task)
		);
		if (kgData) structuredData.kg = kgData;
	}

	let contentSummary: string | undefined;
	{
		if (scoredPool.length > 0) {
			const lines: string[] = [];
			// Header shows TOTAL matches; the grouped body below represents the
			// entire pool (all statuses), capped at 5 visible lines per group.
			// (showing N) = number of result rows fed to the grouped renderer
			// (= total here, since TASK-421 renders the full eligible pool).
			// TASK-422: an issue_ref filter makes the header state the linkage
			// explicitly, and an issue-intent query gets a text-vs-linked
			// breakdown so "N tasks" cannot be misread as "N tasks FOR the issue".
			if (issueRef) {
				lines.push(`### Results: ${total} tasks linked to issue #${issueRef} (showing ${scoredPool.length})`);
			} else {
				lines.push(`### Results: ${total} tasks for "${queryText}" (showing ${scoredPool.length})`);
				if (queryIssueTokens.length > 0) {
					const linkedCount = scoredPool.filter((st) =>
						queryIssueTokens.some((t) => (issueRefsByTaskId.get(st.task.id) ?? []).includes(t))
					).length;
					const textCount = total - linkedCount;
					const tokenLabel = queryIssueTokens.length === 1 ? "issue" : "issues";
					lines.push(
						`- ${linkedCount} linked to ${tokenLabel} ${queryIssueTokens.map((t) => `#${t}`).join(", ")} · ${textCount} text matches`
					);
				}
			}
			// Shared metadata legend (TASK-424): documents [N] = relevance score
			// and the per-group cap (+N more) so the output is unambiguous.
			lines.push(
				formatOutputLegend({
					scoreLabel: "relevance score",
					scoreRange: "0.00–1.00",
					groupBy: "status",
					perGroupCap: 5
				})
			);
			lines.push("");

			// Fused grouped by status (enum order), with global rank #N.
			// Renders EVERY status group with matches (cap 5 per group +
			// "+N more in this group"), not just the highest-scored page.
			const STATUS_ORDER = [...TASK_STATUSES];
			lines.push(
				renderGroupedSummary<ScoredTask>({
					items: scoredPool,
					getGroup: (st) => st.task.status,
					groupOrder: enumOrderComparator(STATUS_ORDER),
					formatGroupLabel: (key) => (key === "in_progress" ? "In Progress" : capitalize(key)),
					formatLine: (st, rank) => {
						const refs = issueRefsByTaskId.get(st.task.id) ?? [];
						const matched = issueRef
							? refs.includes(issueRef)
								? [`#${issueRef}`]
								: []
							: queryIssueTokens.filter((t) => refs.includes(t)).map((t) => `#${t}`);
						const marker =
							matched.length === 0
								? ""
								: matched.length === 1
									? ` [issue ${matched[0]}]`
									: ` [issues ${matched.join(", ")}]`;
						return `#${rank} ${st.task.task_code} [${st.finalScore.toFixed(2)}] ${st.task.title}${marker}`;
					},
					footer: "Use task-detail with task_code for full details."
				})
			);
			contentSummary = lines.join("\n");
		} else {
			contentSummary = issueRef
				? `No tasks linked to issue #${issueRef} in repo "${repo}".`
				: `No tasks found for "${queryText}" in repo "${repo}".`;
		}
	}

	logger.info("[Tool] task-read/search", {
		repo,
		query: queryText,
		issue_ref: issueRef,
		total,
		offset,
		returned: paginated.length
	});

	return createMcpResponse(
		structuredData,
		issueRef ? `Found ${total} tasks linked to issue #${issueRef}.` : `Found ${total} tasks for "${queryText}".`,
		{
			contentSummary,
			structuredContentPathHint: "results",
			includeJson: isJsonRequest
		}
	);
}
