/**
 * Keyboard shortcut handler for the Knowledge Graph.
 * Centralizes key event dispatch to keep components clean.
 */
export function handleGraphKeyDown(
	e: KeyboardEvent,
	actions: {
		clearSelectionAndCloseAll: () => void;
	}
): void {
	if (e.key === "Escape") {
		actions.clearSelectionAndCloseAll();
	}
}
