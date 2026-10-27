/**
 * Navigation model — single source of truth for the dashboard's view
 * navigation (TASK-425 / TASK-405).
 *
 * The unified nav model (previously rendered as the content-area horizontal
 * tablist in App.svelte) now lives here and is rendered as the primary
 * navigation surface in the left sidebar (RepoSidebar). Every view — Arena,
 * Dashboard, Activity, Memories, Tasks, Codebase, Handoffs, Queue, Knowledge
 * Graph, Standards, Reference — is reachable from exactly ONE surface; no
 * dual navigation for the same view.
 *
 * `id` maps 1:1 to the `activeTab` store value that gates the view in
 * App.svelte's content shell.
 */
export type NavScope = "global" | "workspace" | "system";

export interface NavItem {
	id: string;
	label: string;
	icon: string;
	scope: NavScope;
	description: string;
}

export interface NavGroup {
	id: NavScope;
	label: string;
	items: readonly NavItem[];
}

export const NAV_ITEMS: readonly NavItem[] = [
	{
		id: "dashboard",
		label: "Overview",
		icon: "layout-dashboard",
		scope: "global",
		description: "Cross-repository health and priorities"
	},
	{ id: "arena", label: "Agent Arena", icon: "cpu", scope: "global", description: "Live agent and task coordination" },
	{
		id: "queue",
		label: "Queue",
		icon: "list",
		scope: "global",
		description: "Embedding and knowledge extraction jobs"
	},
	{
		id: "tasks",
		label: "Tasks",
		icon: "clipboard-list",
		scope: "workspace",
		description: "Plan and track repository work"
	},
	{
		id: "memories",
		label: "Memories",
		icon: "brain",
		scope: "workspace",
		description: "Repository knowledge and decisions"
	},
	{
		id: "codebase",
		label: "Codebase",
		icon: "code",
		scope: "workspace",
		description: "Files, symbols, and architecture"
	},
	{
		id: "knowledge-graph",
		label: "Knowledge Graph",
		icon: "share-2",
		scope: "workspace",
		description: "Entities and relationships"
	},
	{ id: "standards", label: "Standards", icon: "check", scope: "workspace", description: "Rules agents follow" },
	{
		id: "handoffs",
		label: "Handoffs",
		icon: "git-branch",
		scope: "workspace",
		description: "Context transfers and claims"
	},
	{ id: "activity", label: "Activity", icon: "activity", scope: "workspace", description: "Repository audit timeline" },
	{
		id: "reference",
		label: "MCP Reference",
		icon: "book-open",
		scope: "system",
		description: "Tools, prompts, and resources"
	}
];

export const NAV_GROUPS: readonly NavGroup[] = [
	{ id: "global", label: "Global", items: NAV_ITEMS.filter((item) => item.scope === "global") },
	{ id: "workspace", label: "Workspace", items: NAV_ITEMS.filter((item) => item.scope === "workspace") },
	{ id: "system", label: "System", items: NAV_ITEMS.filter((item) => item.scope === "system") }
];

export function getNavItem(id: string): NavItem | undefined {
	return NAV_ITEMS.find((item) => item.id === id);
}
