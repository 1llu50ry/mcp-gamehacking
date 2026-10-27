/**
 * System user registry — recognises internal service accounts that should
 * bypass the entire proxy pipeline (session init, injection, routing
 * routing, body rewriting) and be forwarded verbatim to upstream.
 *
 * Match is by `userId` on the RESOLVED user id returned by `verifyUserKey`
 * (auth service). Rationale: internal services can rotate their sk-mem key
 * without touching this config, and a stolen legacy key can't accidentally
 * unlock the bypass path — the auth service always has final say.
 *
 * Entries are supplied via `systemUsers` in config.yaml and cached in-memory
 * at startup for O(1) lookup on every request. The `userKey` field is kept
 * for logging/dashboard purposes only and is NOT part of the match key.
 *
 * Usage / credit reporting still fires for matched requests, attributed to
 * the entry's `userId` and the request path's spaceId (= memory instance id).
 */

import { log } from "./report/log.js";
import type { SystemUserEntry } from "./types.js";

export type { SystemUserEntry };

/** Match result surfaced to handlers. */
export interface SystemUserMatch {
  /** Logical name of the matched entry ("memory" / "wiki" / ...). */
  name: string;
  /** User id attributed to this internal user for usage/credit. */
  userId: string;
  /** Human-readable display name (log/dashboard only). */
  displayName: string;
}

// ── Module state ──────────────────────────────────────────────────────────────

/**
 * userId → match info. Kept module-local so callers never have to thread
 * config down to the matcher — mirrors the `auth` module's convention.
 */
let registry: Map<string, SystemUserMatch> = new Map();

/**
 * Initialize the registry from config. Idempotent — safe to call repeatedly.
 * Duplicate userIds log a warning and the last-declared entry wins; duplicate
 * `name`s also warn but do not affect matching (name is a display-only label).
 * Entries missing `userId` are silently dropped — config.ts filters them too,
 * but this guard prevents an empty userId from matching every unauth request
 * (verifyUserKey returns "" when auth is disabled).
 */
export function initSystemUsers(entries: SystemUserEntry[] | undefined): void {
  const map = new Map<string, SystemUserMatch>();
  const seenNames = new Set<string>();

  for (const e of entries ?? []) {
    if (!e.userId) continue; // defensive — config.ts already filters, keep here too
    if (map.has(e.userId)) {
      log.warn("systemUser.duplicate_userid", {
        userId: e.userId,
        prev: map.get(e.userId)?.name,
        next: e.name,
      });
    }
    if (e.name && seenNames.has(e.name)) {
      log.warn("systemUser.duplicate_name", { name: e.name });
    }
    if (e.name) seenNames.add(e.name);

    map.set(e.userId, {
      name: e.name || "unnamed",
      userId: e.userId,
      displayName: e.displayName,
    });
  }

  registry = map;
  if (map.size > 0) {
    log.info("systemUser.init", {
      count: map.size,
      names: Array.from(seenNames),
    });
  }
}

/**
 * Look up whether a resolved userId belongs to a registered internal service.
 * Returns `null` when there is no match (or the caller passed an empty id —
 * which happens when auth is disabled and `verifyUserKey` returns "").
 *
 * This is called on the request hot path — keep it a plain Map lookup, no
 * network / async work.
 */
export function matchSystemUserByUserId(userId: string): SystemUserMatch | null {
  if (!userId) return null;
  return registry.get(userId) ?? null;
}

/** True when at least one system user has been registered. Cheap gate for
 *  handlers so they can skip the lookup entirely when the feature is unused. */
export function hasSystemUsers(): boolean {
  return registry.size > 0;
}

/** Test-only reset hook — clears the registry so unit tests can start fresh. */
export function _resetSystemUsersForTest(): void {
  registry = new Map();
}
