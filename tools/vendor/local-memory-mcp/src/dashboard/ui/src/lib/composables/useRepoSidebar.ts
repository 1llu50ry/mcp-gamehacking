import { currentRepo, pinnedRepos, isRepoSidebarCollapsed } from "../stores";
import { getRepoInitials } from "../utils";

export function createRepoSidebarHandler(onRepoSelect?: (repo: string) => void) {
	let draggedRepo: string | null = null;

	function selectRepo(repo: string) {
		currentRepo.set(repo);
		localStorage.setItem("selectedRepo", repo);
		if (onRepoSelect) onRepoSelect(repo);
	}

	function togglePin(repo: string, e: Event) {
		e.preventDefault();
		e.stopPropagation();
		pinnedRepos.update((pinned: string[]) => {
			if (pinned.includes(repo)) return pinned.filter((p) => p !== repo);
			return [...pinned, repo];
		});
	}

	function toggleCollapse() {
		isRepoSidebarCollapsed.update((v: boolean) => !v);
	}

	function onDragStart(repo: string, e: DragEvent) {
		draggedRepo = repo;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", repo);
		}
		(e.currentTarget as HTMLElement).classList.add("opacity-50");
	}

	function onDragOver(target: string, e: DragEvent) {
		if (!draggedRepo || draggedRepo === target) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
	}

	function onDrop(target: string, e: DragEvent) {
		e.preventDefault();
		const dragged = draggedRepo || e.dataTransfer?.getData("text/plain");
		if (!dragged || dragged === target) return;
		pinnedRepos.update((pinned: string[]) => {
			const next = pinned.filter((p) => p !== dragged);
			const idx = next.indexOf(target);
			next.splice(idx, 0, dragged);
			return next;
		});
		draggedRepo = null;
	}

	function onDragEnd(e: DragEvent) {
		draggedRepo = null;
		(e.currentTarget as HTMLElement).classList.remove("opacity-50");
		document.querySelectorAll(".repo-item.drag-over").forEach((el) => el.classList.remove("drag-over"));
	}

	return {
		selectRepo,
		togglePin,
		toggleCollapse,
		onDragStart,
		onDragOver,
		onDrop,
		onDragEnd,
		getRepoInitials
	};
}
