/**
 * Call/instantiation/member expression name helpers for the TypeScriptVisitor
 * (extracted from ts-reference-emission during the TASK-552 split).
 *
 * Purely structural lookups over the AST — no symbol resolution or alias
 * following; the reference walker in the visitor handles traversal and
 * caller-name tracking.
 */

import type { Node as TSNode } from "web-tree-sitter";
import { CALL_EXPRESSION, MEMBER_EXPRESSION } from "../ts-node-types";

/** Resolve the referenced name of a call/instantiation expression. */
export function calledExpressionName(node: TSNode): string | null {
	const fn = node.firstNamedChild;
	if (!fn) return null;
	if (fn.type === MEMBER_EXPRESSION) {
		return memberPropertyName(fn);
	}
	if (fn.type === CALL_EXPRESSION) {
		// `foo().bar()` — the outer call's target is `foo().bar`, so the
		// member property is the meaningful callee.
		const member = fn.firstNamedChild;
		if (member?.type === MEMBER_EXPRESSION) {
			return memberPropertyName(member);
		}
	}
	return fn.text;
}

/** Name of the property accessed by a member expression (e.g. `helper` from `ns.helper`). */
export function memberPropertyName(member: TSNode): string | null {
	return member.childForFieldName("property")?.text ?? member.lastNamedChild?.text ?? null;
}

export function constructorName(ctor: TSNode | null | undefined): string | null {
	if (!ctor) return null;
	if (ctor.type === MEMBER_EXPRESSION) {
		return memberPropertyName(ctor) ?? ctor.text;
	}
	return ctor.text;
}
