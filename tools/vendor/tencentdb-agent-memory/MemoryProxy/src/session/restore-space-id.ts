/**
 * restoreSessionSpaceId — repopulate a SessionInfo's `space_id` from the URL
 * path when it was hydrated (from Redis / SQLite / recovery) without one.
 *
 * Why this exists
 * ---------------
 * Legacy sessions were persisted before `space_id` was tracked, so on
 * recovery the value comes back as `""` or missing. The kernel routes tenants
 * by the `x-tdai-service-id` header; a request that carries no `space_id`
 * falls back to `config.coreSkill.serviceId` (usually the platform default
 * `context-proxy`), which then answers as the wrong tenant — returning empty
 * skill lists or `invalid_user_key`.
 *
 * The URL path (`/{agent}/{spaceId}/...`) is authoritative for the current
 * request; use it to fill any hole.
 *
 * This helper MUST be called BEFORE the injection prewarm — otherwise the
 * prewarm produces empty blocks (kernel returns nothing for the fallback
 * tenant), those empty blocks are dropped by `prewarmAll` (empty results are
 * skipped, see `prewarm.ts`), and every subsequent turn misses the cache and
 * re-executes with no `<available_skills>` injection.
 *
 * See `BUG-skill-injection-multinode.md` §3.3(B) for the full trace.
 *
 * Behavior
 * --------
 * - Mutates in place (callers hold references shared with prewarm/pipeline).
 * - Only writes when `sessionInfo.space_id` is missing or empty string —
 *   never overwrites a valid pre-existing value.
 * - No-op when `spaceId` is missing/empty (single-tenant deployments).
 * - No-op on null/undefined `sessionInfo` (defensive).
 */
export function restoreSessionSpaceId(
  sessionInfo: Record<string, unknown> | null | undefined,
  spaceId: string | undefined,
): void {
  if (!sessionInfo) return;
  if (!spaceId) return;
  const existing = sessionInfo.space_id;
  if (existing && typeof existing === "string" && existing.length > 0) return;
  sessionInfo.space_id = spaceId;
}
