# Codebase Index — Component Inventory

>
> **IMPLEMENTED (verified 2026-08-10, CG-1/CG-2/TASK-329):** the 2026-08-08 "no CallGraph/FileViewer/IndexStats — NEXT PHASE" claim is superseded. Shipped Codebase tab components (src/dashboard/ui/src/components/): `CodebasePage.svelte` (orchestrator), `CodebaseSearchBar.svelte`, `CodebaseIndexStatus.svelte` + `IndexProgress.svelte`/`IndexStatusBadge.svelte` (the design's `IndexStats` role — status + index stats), `CodebaseLanguageBreakdown.svelte` (kind/file breakdown), `CodebaseFileTree.svelte` + `FileTreeNode.svelte`/`FileTreeHeader.svelte`, **`CodebaseFileViewer.svelte`** (file content viewer — the design's `FileViewer`), `CodebaseSymbolList.svelte`, `CodebaseSymbolDetail.svelte` + `CodebaseSymbolTrace.svelte`, **`CodebaseCallGraph.svelte`** (canvas call-DAG inside `CodebaseSymbolDetail`, mounted at `CodebaseSymbolDetail.svelte:158` — rendered via `lib/callGraphLayout.ts`; **not** Mermaid, the design's Mermaid DAG is design intent), **`CodebaseGraphPanel.svelte`** (code-graph force panel — the design's full call-graph view; `GET /api/codebase/graph` via `lib/codebaseGraph.ts:76-87`, reuses `KGGraphCanvas`, kind filter All/Calls/Imports/Co-defined, zoom, index-required/error/empty overlays, mounted in `CodebasePage.svelte:243` after `CodebaseIndexStatus`), **`CodebaseGraphLegend.svelte`** (legend footer: node-kind color dots + 6 edge kinds + `N nodes · M edges` stats; props `{nodeCount, edgeCount, truncated, stats}`), plus `CodebaseDeadCode.svelte` and `CodebaseEmptyState.svelte`. Shared: symbol-kind palette/color mapping `PALETTE` + `TYPE_COLOR_INDEX` (`lib/kg/kg-neural-renderer/layout.ts:51-76`, amber added at index 5 for `variable`), legend vocabulary `CODEBASE_KIND_ORDER`/`EDGE_KIND_LABELS`/`kindColor` (`lib/codebaseGraph.ts:95-113`).

This document details the new Svelte components needed for the Codebase Index tab, following the existing composable pattern from the dashboard.

---

## 1. Component Tree

```
CodebaseTab.svelte                    ← Main orchestrator for the Codebase tab
├── SearchBar.svelte                  ← Global symbol search with autocomplete
├── IndexStatus.svelte                ← Index state indicator + progress
├── FileTree.svelte                   ← Recursive file browser
│   └── FileTreeNode.svelte           ← Single file/directory node
├── FileViewer.svelte                 ← Syntax-highlighted file content
├── SymbolList.svelte                 ← Search results table
├── SymbolDetail.svelte               ← Right-panel symbol metadata
├── CallGraph.svelte                  ← Mermaid DAG for symbol relations
└── IndexStats.svelte                 ← Statistics dashboard (Stats tab)
```

---

## 2. Component Specifications

### 2.1 `CodebaseTab.svelte` (Main Orchestrator)

| Property   | Type     | Default | Description                                        |
| :--------- | :------- | :------ | :------------------------------------------------- |
| `repoSlug` | `string` | —       | Active repository slug from global sidebar context |

**State managed** (via `createCodebaseHandler()` composable):

| State          | Type                             | Description                                                       |
| :------------- | :------------------------------- | :---------------------------------------------------------------- |
| `activeFile`   | `string \| null`                 | Currently selected file path in the tree                          |
| `activeSymbol` | `string \| null`                 | Currently selected symbol name in detail panel                    |
| `mainTab`      | `'file' \| 'results' \| 'stats'` | Active sub-tab in the main content area                           |
| `rightTab`     | `'detail' \| 'callgraph'`        | Active sub-tab in the right panel                                 |
| `searchQuery`  | `string`                         | Current search query text                                         |
| `indexState`   | `IndexState`                     | Current index status (Idle/Indexing/Complete/Partial/Stale/Error) |

**Layout responsibilities:**

- Manages the 4-zone layout (top bar, left sidebar, main area, right panel).
- Coordinates data flow between child components.
- Handles responsive breakpoints (collapsing right panel to drawer on tablet/mobile).

---

### 2.2 `SearchBar.svelte`

Global symbol search with autocomplete dropdown.

| Prop          | Type      | Default               | Description              |
| :------------ | :-------- | :-------------------- | :----------------------- |
| `placeholder` | `string`  | `'Search symbols...'` | Input placeholder text   |
| `disabled`    | `boolean` | `false`               | Disabled during indexing |

**Events dispatched:**

| Event    | Detail                   | Description                                    |
| :------- | :----------------------- | :--------------------------------------------- |
| `search` | `{ query: string }`      | Emitted on Enter or debounce completion        |
| `select` | `{ symbol: SymbolInfo }` | Emitted when user selects an autocomplete item |

**States:**

| State      | Visual                           | Behavior                                                      |
| :--------- | :------------------------------- | :------------------------------------------------------------ |
| Resting    | Input with magnifying glass icon | Placeholder text visible                                      |
| Typing     | Text in input                    | Dropdown shows up to 10 matching symbols after 200ms debounce |
| Selected   | Input filled with symbol name    | Emits `select` event; clears input                            |
| No matches | "No results found" in dropdown   | Dropdown shows empty state message                            |
| Disabled   | Grayed out with spinner          | Indexing in progress; input not interactive                   |
| Focused    | Blue ring border                 | Keyboard navigation active (arrow keys + Enter)               |

---

### 2.3 `IndexStatus.svelte`

Index state badge with progress and details.

| Prop        | Type         | Default  | Description                   |
| :---------- | :----------- | :------- | :---------------------------- |
| `state`     | `IndexState` | `'idle'` | Current index state           |
| `stats`     | `IndexStats` | —        | Index statistics object       |
| `onReindex` | `() => void` | —        | Callback for re-index trigger |

**IndexStats type:**

```typescript
interface IndexStats {
	totalFiles: number;
	totalSymbols: number;
	lastIndexed: Date | null;
	fileTypeBreakdown: Record<string, number>;
	symbolKindBreakdown: Record<string, number>;
	errors: IndexError[];
	progress: { scanned: number; total: number } | null;
}
```

**States:**

| State    | Icon                | Label         | Extra                            |
| :------- | :------------------ | :------------ | :------------------------------- |
| Idle     | Gray circle         | "Indexed"     | Shows last-indexed time          |
| Indexing | Blue pulsing circle | "Indexing..." | Progress bar below label         |
| Complete | Green checkmark     | "Complete"    | Timestamp + file count           |
| Partial  | Yellow half-circle  | "Partial"     | File count difference            |
| Stale    | Orange exclamation  | "Stale"       | "Re-index recommended" tooltip   |
| Error    | Red X               | "Error"       | Error count + "View errors" link |

**Interaction:** Clicking the badge opens a `DetailTooltip` popover with full stats.

---

### 2.4 `FileTree.svelte`

Recursive collapsible file tree for the left sidebar.

| Prop         | Type             | Default | Description                       |
| :----------- | :--------------- | :------ | :-------------------------------- |
| `rootPath`   | `string`         | `'/'`   | Root directory to display in tree |
| `filter`     | `string`         | `''`    | Client-side filename filter       |
| `activeFile` | `string \| null` | `null`  | Currently selected file path      |
| `loading`    | `boolean`        | `false` | Loading state during indexing     |

**Events dispatched:**

| Event    | Detail             | Description                                   |
| :------- | :----------------- | :-------------------------------------------- |
| `select` | `{ path: string }` | User selected a file                          |
| `expand` | `{ path: string }` | User expanded a directory (lazy load trigger) |

**States:**

| State        | Visual                    | Behavior                                         |
| :----------- | :------------------------ | :----------------------------------------------- |
| Resting      | Full tree visible         | Scrollable with directory arrows                 |
| Filtering    | Non-matching nodes dimmed | Matched nodes highlighted with yellow background |
| Loading tree | Skeleton placeholders     | 5–8 placeholder lines while initial tree loads   |
| Empty        | "No files found"          | When filter matches nothing                      |
| Disabled     | Reduced opacity overlay   | During indexing, tree is non-interactive         |
| Error        | "Failed to load tree"     | Error message with retry button                  |

**Implementation notes:**

- Uses `<FileTreeNode.svelte>` recursively for each directory node.
- Lazy loads children on expand via API call.
- Sorts: directories first (alphabetical), then files (alphabetical).
- Supports `node_modules`, `.git`, and `dist` directory exclusion by default.
- Virtual scrolling for repos with >10,000 files (future optimization).

---

### 2.5 `SymbolList.svelte`

Tabular display of symbol search results.

| Prop         | Type           | Default | Description             |
| :----------- | :------------- | :------ | :---------------------- |
| `symbols`    | `SymbolInfo[]` | `[]`    | Array of symbol results |
| `loading`    | `boolean`      | `false` | Loading state           |
| `kindFilter` | `string[]`     | `[]`    | Active kind filters     |

**SymbolInfo type:**

```typescript
interface SymbolInfo {
	name: string;
	kind: "function" | "class" | "variable" | "type" | "interface" | "enum" | "method" | "property";
	file: string;
	line: number;
	column: number;
	signature: string;
	docComment: string | null;
}
```

**Events dispatched:**

| Event        | Detail                   | Description         |
| :----------- | :----------------------- | :------------------ |
| `select`     | `{ symbol: SymbolInfo }` | User clicked a row  |
| `kindFilter` | `{ kinds: string[] }`    | Kind filter changed |

**States:**

| State    | Visual                        | Behavior                            |
| :------- | :---------------------------- | :---------------------------------- |
| Resting  | Table with sortable columns   | Name, Kind, File, Line columns      |
| Loading  | Skeleton rows (5 rows)        | Animated placeholder while fetching |
| Empty    | "No symbols found"            | Centered message with illustration  |
| Filtered | Active kind pills above table | Results filtered by selected kinds  |
| Error    | "Search failed"               | Error message with retry            |

**Columns:**

| Column | Width | Sortable | Description                       |
| :----- | :---- | :------- | :-------------------------------- |
| Name   | 30%   | Yes      | Symbol name with kind icon prefix |
| Kind   | 15%   | Yes      | Badge (function, class, etc.)     |
| File   | 40%   | Yes      | File path relative to repo root   |
| Line   | 15%   | Yes      | Line number right-aligned         |

---

### 2.6 `SymbolDetail.svelte`

Detailed view of a single symbol in the right panel.

| Prop      | Type                 | Default | Description              |
| :-------- | :------------------- | :------ | :----------------------- |
| `symbol`  | `SymbolInfo \| null` | `null`  | The symbol to display    |
| `callers` | `CallRef[]`          | `[]`    | Incoming call references |
| `callees` | `CallRef[]`          | `[]`    | Outgoing call references |
| `loading` | `boolean`            | `false` | Loading state            |

**CallRef type:**

```typescript
interface CallRef {
	symbolName: string;
	file: string;
	line: number;
	kind: string;
}
```

**Events dispatched:**

| Event      | Detail                           | Description                      |
| :--------- | :------------------------------- | :------------------------------- |
| `navigate` | `{ symbolName: string }`         | Navigate to caller/callee symbol |
| `openFile` | `{ file: string; line: number }` | Open file at specific line       |

**States:**

| State             | Visual                          | Behavior                            |
| :---------------- | :------------------------------ | :---------------------------------- |
| Resting           | Full detail panel               | All sections visible                |
| Loading           | Skeleton card                   | Animated placeholder while fetching |
| Empty (no symbol) | "Select a symbol"               | Prompt to click a symbol            |
| No callers        | "No callers found"              | Subdued text in Callers section     |
| No callees        | "No callees found"              | Subdued text in Callees section     |
| Error             | "Failed to load symbol details" | Error with retry                    |

**Sections:**

1. **Header**: Symbol name (monospace), kind badge, file path + line link.
2. **Signature**: Full type signature in a code-styled block.
3. **Doc Comment**: Rendered markdown if present, or "No documentation" placeholder.
4. **Definition Snippet**: 5-line context window around the definition with syntax highlighting.
5. **Callers**: Ordered list of call references (most common first). Each item is clickable.
6. **Callees**: Ordered list of call references. Each item is clickable.

---

### 2.7 `CallGraph.svelte`

Renders a simple DAG of symbol call relationships using Mermaid.

| Prop         | Type                               | Default  | Description              |
| :----------- | :--------------------------------- | :------- | :----------------------- |
| `symbolName` | `string`                           | —        | Center node of the graph |
| `callers`    | `CallRef[]`                        | `[]`     | Incoming edges           |
| `callees`    | `CallRef[]`                        | `[]`     | Outgoing edges           |
| `loading`    | `boolean`                          | `false`  | Loading state            |
| `direction`  | `'callers' \| 'callees' \| 'both'` | `'both'` | Which edges to show      |

**Events dispatched:**

| Event      | Detail                   | Description                    |
| :--------- | :----------------------- | :----------------------------- |
| `navigate` | `{ symbolName: string }` | Navigate to a connected symbol |

**States:**

| State            | Visual                      | Behavior                               |
| :--------------- | :-------------------------- | :------------------------------------- |
| Resting          | Mermaid flowchart centered  | Graph rendered in scrollable container |
| Loading          | Pulsing placeholder         | While graph data is fetched            |
| Empty (no edges) | "No call relationships"     | Message + icon                         |
| Error            | "Failed to load call graph" | Error with retry                       |

**Implementation notes:**

- Generates Mermaid flowchart source code on the client.
- Renders inside a fixed-height (400px default) scrollable container with zoom controls.
- Center node (selected symbol) rendered with a distinct color (e.g., indigo border).
- Callers use dashed incoming arrows; callees use solid outgoing arrows.
- Clicking a connected symbol emits `navigate` event.
- For graphs with >30 nodes, falls back to a simplified list view with a "Graph too large" note.

---

### 2.8 `FileViewer.svelte`

Syntax-highlighted file content viewer for the main content area.

| Prop            | Type             | Default | Description                      |
| :-------------- | :--------------- | :------ | :------------------------------- |
| `filePath`      | `string \| null` | `null`  | Path of the file to display      |
| `content`       | `string \| null` | `null`  | Raw file content                 |
| `language`      | `string \| null` | `null`  | Language for syntax highlighting |
| `highlightLine` | `number \| null` | `null`  | Line to scroll to and highlight  |
| `loading`       | `boolean`        | `false` | Loading state                    |

**States:**

| State                    | Visual                          | Behavior                                                     |
| :----------------------- | :------------------------------ | :----------------------------------------------------------- |
| Resting                  | Code with line numbers          | Monospace rendering with syntax highlighting                 |
| Loading                  | Skeleton lines (20 lines)       | Animated placeholder                                         |
| Empty (no file)          | "Select a file"                 | Centered prompt with sidebar visual hint                     |
| Large file (>5000 lines) | Warning banner + truncated view | "File is large, showing first 5000 lines" with expand button |
| Error                    | "Failed to load file"           | Error message with retry                                     |
| Binary file              | "Cannot display binary file"    | Warning with download option                                 |

**Status bar** (bottom of viewer):

- Line number, column number
- Language detected
- File encoding
- File size

---

### 2.9 `IndexStats.svelte`

Statistics dashboard for the codebase index (Stats sub-tab).

| Prop      | Type                 | Default | Description      |
| :-------- | :------------------- | :------ | :--------------- |
| `stats`   | `IndexStats \| null` | `null`  | Index statistics |
| `loading` | `boolean`            | `false` | Loading state    |

**Sections:**

1. **Summary Cards** (horizontal row):
   - Total files indexed
   - Total symbols extracted
   - Index size on disk
   - Last indexing duration

2. **Symbols by Kind** (bar chart or pill list):
   - Functions: X
   - Classes: X
   - Interfaces: X
   - Variables: X
   - Types: X

3. **File Types** (bar chart or pill list):
   - `.ts`: X files
   - `.svelte`: X files
   - `.json`: X files
   - etc.

4. **Recent Errors** (table, if any):
   - File path, error message, timestamp

---

## 3. Composables

### `createCodebaseHandler()`

Following the project's composable pattern (factory function returning stores and actions):

```typescript
interface CodebaseHandler {
	// State stores
	indexState: Writable<IndexState>;
	indexStats: Writable<IndexStats | null>;
	fileTree: Writable<TreeNode[]>;
	searchResults: Writable<SymbolInfo[]>;
	activeFile: Writable<string | null>;
	activeSymbol: Writable<SymbolInfo | null>;
	symbolCallers: Writable<CallRef[]>;
	symbolCallees: Writable<CallRef[]>;

	// Actions
	loadFileTree: (path: string) => Promise<void>;
	loadFileContent: (path: string) => Promise<string>;
	searchSymbols: (query: string) => Promise<void>;
	getSymbolDetail: (name: string) => Promise<SymbolInfo>;
	getCallGraph: (name: string) => Promise<{ callers: CallRef[]; callees: CallRef[] }>;
	triggerReindex: () => Promise<void>;
	getIndexStats: () => Promise<IndexStats>;
}
```

---

## 4. API Contract (Backend Routes)

New Express routes needed under `/api/codebase`:

| Method | Route                                      | Description                                        |
| :----- | :----------------------------------------- | :------------------------------------------------- |
| `GET`  | `/api/codebase/:repo/status`               | Get index state and stats                          |
| `POST` | `/api/codebase/:repo/index`                | Trigger re-index                                   |
| `GET`  | `/api/codebase/:repo/tree`                 | Get file tree (supports `?path=` for lazy load)    |
| `GET`  | `/api/codebase/:repo/file`                 | Get file content (`?path=` required)               |
| `GET`  | `/api/codebase/:repo/search`               | Search symbols (`?q=` required, `?kind=` optional) |
| `GET`  | `/api/codebase/:repo/symbol/:name`         | Get symbol details                                 |
| `GET`  | `/api/codebase/:repo/symbol/:name/callers` | Get caller references                              |
| `GET`  | `/api/codebase/:repo/symbol/:name/callees` | Get callee references                              |
| `GET`  | `/api/codebase/:repo/stats`                | Get index statistics                               |

---

## 5. Component States Matrix

| Component    | Resting | Loading | Empty | Error | Disabled | Filtered |
| :----------- | :------ | :------ | :---- | :---- | :------- | :------- |
| SearchBar    | ✅      | ✅      | ✅    | —     | ✅       | —        |
| IndexStatus  | ✅      | ✅      | —     | ✅    | —        | —        |
| FileTree     | ✅      | ✅      | ✅    | ✅    | ✅       | ✅       |
| SymbolList   | ✅      | ✅      | ✅    | ✅    | —        | ✅       |
| SymbolDetail | ✅      | ✅      | ✅    | ✅    | —        | —        |
| CallGraph    | ✅      | ✅      | ✅    | ✅    | —        | —        |
| FileViewer   | ✅      | ✅      | ✅    | ✅    | —        | —        |
| IndexStats   | ✅      | ✅      | ✅    | ✅    | —        | —        |
