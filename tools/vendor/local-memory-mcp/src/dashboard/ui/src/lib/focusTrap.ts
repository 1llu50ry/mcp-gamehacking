/**
 * Reusable focus-trap for dialogs/drawers/modals (audit F4/F9, TASK-272).
 *
 * Every overlay in the dashboard previously left focus wherever it was when
 * the overlay opened: Tab could escape into the background page and Escape
 * (listened for at the app level) missed panels whose visibility is
 * component-local (e.g. the Handoff drawer). This helper gives every overlay
 * the same trusted pattern:
 *
 *   activate()  — remembers the currently focused element, moves focus INTO the
 *                 container (first focusable, or an explicit initialFocus),
 *                 wraps Tab within the container, and routes Escape to onEscape.
 *   deactivate() — restores focus to the remembered trigger element.
 *
 * Both are idempotent and SSR-safe (no DOM work at module load).
 */

export interface FocusTrapOptions {
	/** Called when Escape is pressed while focus is inside the trap. */
	onEscape?: () => void;
	/** Element to restore focus to on deactivate (defaults to the element focused at activate()). */
	restoreFocusTo?: HTMLElement | null;
	/** Specific element to focus on activate (default: first focusable descendant). */
	initialFocus?: HTMLElement | null;
}

const FOCUSABLE_SELECTOR = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"iframe",
	"audio[controls]",
	"video[controls]",
	'[contenteditable]:not([contenteditable="false"])',
	"[tabindex]:not([tabindex='-1'])"
].join(", ");

export function createFocusTrap(container: HTMLElement, options: FocusTrapOptions = {}) {
	let previousFocus: HTMLElement | null = null;
	let keyHandler: ((e: KeyboardEvent) => void) | null = null;
	let active = false;

	function getFocusable(): HTMLElement[] {
		const all = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
		// `offsetParent === null` filters hidden elements; the active element is
		// always kept so focus never gets stranded mid-tab. TASK-398: `isConnected`
		// additionally excludes DETACHED descendants — after the drawer unmounts
		// ({#if open}) the container subtree is gone, and .focus() on a detached
		// node silently no-ops, which used to strand focus on <body> and left Tab
		// with no working starting point (the post-drawer Tab-freeze precondition).
		return all.filter((el) => el.isConnected && (el.offsetParent !== null || el === document.activeElement));
	}

	/**
	 * Whether `el` is a valid focus-restore target: it can receive focus via
	 * `.focus()`, is still in the document, and is not the inert <body>.
	 * Includes `tabindex="-1"` elements (programmatically focusable but not in
	 * tab order) — the drawer trigger rows rely on that (TASK-278).
	 */
	function canReceiveFocus(el: HTMLElement | null): el is HTMLElement {
		if (!el || typeof el.focus !== "function") return false;
		if (!el.isConnected) return false;
		if (el === document.body || el === document.documentElement) return false;
		return el.hasAttribute("tabindex") || el.matches(FOCUSABLE_SELECTOR);
	}

	function focusFirst(): void {
		const target = options.initialFocus && container.contains(options.initialFocus) ? options.initialFocus : undefined;
		if (target) {
			target.focus();
			return;
		}
		const els = getFocusable();
		if (els.length > 0) {
			els[0].focus();
		} else {
			container.focus();
		}
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === "Escape") {
			// Stop propagation so app-level window handlers don't close a
			// different panel underneath this one.
			e.stopPropagation();
			options.onEscape?.();
			return;
		}
		if (e.key !== "Tab") return;

		const els = getFocusable();
		if (els.length === 0) return;
		const first = els[0];
		const last = els[els.length - 1];
		const current = document.activeElement as HTMLElement | null;
		const inside = current !== null && container.contains(current);

		if (e.shiftKey && (!inside || current === first)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && (!inside || current === last)) {
			e.preventDefault();
			first.focus();
		}
	}

	function activate(): void {
		if (active) return;
		active = true;
		previousFocus = options.restoreFocusTo ?? (document.activeElement as HTMLElement | null);
		keyHandler = onKeyDown;
		// Capture phase: Tab/Escape handled even if focus lands on a
		// child that stops propagation.
		container.addEventListener("keydown", keyHandler, true);
		focusFirst();
	}

	/**
	 * Restores focus to the element that opened the overlay — never to <body>.
	 *
	 * TASK-278: previously, when the trigger was not focusable (e.g. the
	 * Memory drawer's `.mem-row` <tr>), `previousFocus` was <body> and the
	 * `.focus()` call silently no-op'd, stranding keyboard users on the
	 * document root after Escape. Restore now checks the trigger is a real
	 * focus target, then falls back to the container, its first focusable
	 * descendant, or any focusable element in the page. Drawers unmount the
	 * panel right after deactivate, so the container/descendant fallback runs
	 * on the next tick to survive the DOM removal.
	 */
	function deactivate(): void {
		if (!active) return;
		active = false;
		if (keyHandler) container.removeEventListener("keydown", keyHandler, true);
		keyHandler = null;

		if (canReceiveFocus(previousFocus)) {
			previousFocus.focus();
			return;
		}

		window.setTimeout(() => {
			if (canReceiveFocus(container)) {
				container.focus();
				return;
			}
			// TASK-398: after the panel unmounts, `getFocusable()` (now
			// isConnected-filtered) returns [] for the detached subtree, so the
			// fallback lands on the first focusable still IN the document —
			// never on a detached node (whose .focus() would no-op) and never
			// on <body>.
			const fallback = getFocusable()[0] ?? document.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
			fallback?.focus();
		}, 0);
	}

	return {
		activate,
		deactivate,
		get active() {
			return active;
		}
	};
}
