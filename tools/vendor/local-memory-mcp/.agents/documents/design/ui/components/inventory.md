# Svelte Component Inventory

> **Note (2026-09-06, v0.44.1):** Superseded by PRs #104–106 — workspace-first navigation (WorkspaceSwitcher), 9 shared primitives, lazy route splitting (-44%), arena HiDPI. See CHANGELOG 0.44.1. Content below is historical.


This document tracks the UI components implemented in the Svelte 5 dashboard (`src/dashboard/ui/src/components/`).

## 1. Top-Level Layout

- **`App.svelte`**
  - Path: `src/dashboard/ui/src/App.svelte`
  - Purpose: Root application shell, tab orchestration, global state coordination.
- **`RepoSidebar.svelte`**
  - Purpose: Repository switcher with collapsible state, active status indicators, and recent repo list.
- **`TopBar.svelte`**
  - Purpose: Header containing global refresh, sync status, and mobile menu triggers.
- **`FloatingChat.svelte`**
  - Purpose: Floating chat interface for manual MCP tool invocation from the dashboard.

## 2. Feature-Specific Components

### Memory Management

- **`MemoryList.svelte`**: Interactive feed for memory units with infinite scroll, search, and type/importance filters.
- **`MemoryDrawer.svelte`**: Multi-purpose drawer for creating, viewing, and editing memories.
- **`BulkImportModal.svelte`**: Standardized file upload interface for importing JSON/Markdown data.

### Task Orchestration

- **`KanbanBoard.svelte`**: Visual task management board implementing the 4 primary swimlanes (`backlog`, `pending`, `in_progress`, `completed`) with drag-and-drop.
- **`DetailDrawer.svelte`**: Unified viewer for Task and Memory details with action buttons.
- **`AddTaskModal.svelte`**: Focused modal for manual task entry with all metadata fields.
- **`QuickCreateFAB.svelte`**: Floating action button for quick task creation from any tab.

### Telemetry & Stats

- **`StatsWidget.svelte`**: Real-time database and memory metrics (total memories, active tasks, hit/miss rates).
- **`TaskStatsWidget.svelte`**: Visual summary of task completion rates and priority distribution.
- **`TimeStatsWidget.svelte`**: Metrics tracking task duration and efficiency across daily/weekly/monthly views.
- **`RecentActions.svelte`**: Paginated audit log of all system tool calls with burst condensation.

### Reference System

- **`ReferenceTab.svelte`**: Dedicated view for inspecting MCP Capabilities (Tools, Prompts, Resources).
- **`ReferenceDrawer.svelte`**: Displays detailed JSON schemas and documentation for individual reference items.

### Knowledge Graph

- **`KGGraph.svelte`**: Force-directed graph canvas renderer for entity-relation visualization.
- **`KGGraphShell.svelte`**: Full-page KG visualization container with zoom/pan controls.
- **`KGGraphHeader.svelte`**: Header with KG controls, refresh, and entity filter.
- **`KGZeroEdgeStatus.svelte`**: Empty state component for repos with no KG relations.

### Coordination

- **`HandoffsPanel.svelte`**: List and manage agent-to-agent handoffs with status filters.
- **`AgentArena.svelte`**: Multi-agent coordination overview showing active claims and handoffs.

### Standards

- **`StandardsPanel.svelte`**: Browse and search coding standards with language/stack filters.
- **`StandardDetailPanel.svelte`**: Detailed view of a coding standard with full description and rationale.

### Other

- **`GlobalCommandCenter.svelte`**: Global search and command interface for quick access.

## 3. Utility Components

- **`Icon.svelte`**: SVG icon wrapper with Lucid-inspired iconography (16x16 standard).
- **`MemoryDrawer.svelte`**: Reused for both create and edit memory operations.

## 4. Composables (Logic Modules)

Logic is extracted to `composables/` for code organization:

- `useApp.ts`, `useBulkImport.ts`, `useReference.ts`, `useRecentActions.ts`
- `useDetailStandard.ts`, `useMemoryList.ts`, `useTopBar.ts`
- `useDetailTypes.ts`, `useStatsWidget.ts`, `useRepoSidebar.ts`
- Plus additional composables for task, KG, and coordination state management.

## 5. Knowledge Graph Rendering

- **`KGForceLayout.ts`** (`src/dashboard/ui/src/lib/kg/`): Force-directed graph layout algorithm with velocity Verlet integration.
- **`KGCanvasRenderer.ts`** (`src/dashboard/ui/src/lib/kg/`): HTML5 Canvas-based renderer for the force-directed graph.
