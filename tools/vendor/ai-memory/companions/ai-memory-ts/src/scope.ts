/**
 * Scope validation. The SDK is a static MCP client: every project-scoped call
 * sends `workspace` and `project` together, taken from the call or from the
 * client's default. It never derives a project from the working directory,
 * never relies on the server's active-project pointer and never sends `cwd`.
 *
 * @module
 */

import { ScopeError } from "./errors.js";

/** A workspace and project pair. Both names are required and non-empty. */
export interface Scope {
  /** Workspace name. */
  readonly workspace: string;
  /** Project name inside the workspace. */
  readonly project: string;
}

function checkName(value: unknown, field: string, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ScopeError(`${where}: scope.${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Validate one scope object and return a plain copy of it.
 * @internal
 */
export function validateScope(scope: unknown, where: string): Scope {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) {
    throw new ScopeError(`${where}: scope must be an object with workspace and project`);
  }
  const record = scope as Record<string, unknown>;
  return {
    workspace: checkName(record["workspace"], "workspace", where),
    project: checkName(record["project"], "project", where),
  };
}

/**
 * The scope a project call uses: the call's own, else the client default.
 * Neither is a {@link ScopeError} before any request.
 * @internal
 */
export function resolveScope(
  callScope: Scope | undefined,
  defaultScope: Scope | undefined,
  where: string,
): Scope {
  if (callScope !== undefined) return validateScope(callScope, where);
  if (defaultScope !== undefined) return defaultScope;
  throw new ScopeError(
    `${where}: no scope; pass { scope: { workspace, project } } or set a default scope on the client`,
  );
}

/**
 * Validate a non-empty list of scopes for a multi-project read.
 * @internal
 */
export function validateScopes(scopes: unknown, where: string): Scope[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new ScopeError(`${where}: scopes must be a non-empty array`);
  }
  return scopes.map((scope, index) => validateScope(scope, `${where} scopes[${index}]`));
}
