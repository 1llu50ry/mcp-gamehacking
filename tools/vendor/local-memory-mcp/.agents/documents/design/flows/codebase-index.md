# Codebase Index — User Flow Descriptions

>
> **IMPLEMENTED (verified 2026-08-10, CG-1/CG-2/TASK-329):** Flow 3's "call graph" step is now shipped — `CodebaseCallGraph.svelte` renders a **canvas call-DAG** (callers/callees via `lib/callGraphLayout.ts`) inside `CodebaseSymbolDetail` (`CodebaseSymbolDetail.svelte:158`), and the tab additionally exposes a full **code-graph force panel**: `CodebaseGraphPanel.svelte` (KGGraphCanvas reuse, kind filter All/Calls/Imports/Co-defined, zoom/refresh, index-required + error/empty overlays, node click → symbol detail) + `CodebaseGraphLegend.svelte` (legend + stats), mounted in `CodebasePage.svelte:243` after `CodebaseIndexStatus`. The design's Mermaid rendering stayed design intent only — the shipped graphs are canvas-based.

This document maps the primary user journeys within the Codebase Index tab of the Local Memory Dashboard.

---

## Flow 1: Browsing Project File Tree

The user explores the repository file structure and views source files.

```mermaid
flowchart TD
    A(["User opens Codebase tab"]) --> B{"Repo selected?"}
    B -- "No" --> C["Select repository from sidebar"]
    B -- "Yes" --> D["File tree loads in left panel"]
    C --> D
    D --> E["User expands directory node"]
    E --> F["Children load on demand"]
    F --> G{"Goal?"}
    G -- "Browse" --> H["User expands deeper directories"]
    G -- "Select file" --> I["User clicks file node"]
    H --> E
    I --> J["File content loads in main area"]
    J --> K["Syntax-highlighted source displayed"]
    K --> L["User scrolls through file"]
    L --> M{"Next action?"}
    M -- "Navigate" --> E
    M -- "Search" --> N["Focus search bar"]
    M -- "Done" --> O(["Exit to another tab"])
```

**Key UX Decisions:**

- File tree loads lazily — children fetched on directory expand, not upfront.
- Active file highlighted in tree with a distinct background color.
- Scroll position of tree preserved when navigating between files.
- Keyboard navigation: arrow keys move through tree, Enter opens files.

---

## Flow 2: Searching for Symbols by Name

The user finds a function, class, or variable by name using the search bar.

```mermaid
flowchart TD
    A(["User focuses search bar"]) --> B["Autocomplete dropdown appears with top-10 symbol matches"]
    B --> C["User types query, e.g. 'createTask'"]
    C --> D["Results filter in real-time as user types"]
    D --> E{"User action"}
    E -- "Select from autocomplete" --> F["Symbol selected"]
    E -- "Press Enter" --> G["Full search results page loads"]
    G --> H["SymbolList shows: name, kind, file, line, signature preview"]
    H --> I["User filters results by kind, e.g. function, class, variable"]
    I --> J["User clicks a result"]
    F --> J
    J --> K(["Symbol detail panel opens on the right"])
```

**Key UX Decisions:**

- Autocomplete debounced at 200ms to avoid excessive queries.
- Search scope = active repository only; cross-repo search is a future enhancement.
- Kind filters are rendered as pill-shaped toggle buttons above the result list.
- Empty state shows "No symbols found matching your query."

---

## Flow 3: Viewing Symbol Details and Call Graph

The user drills into a symbol to see its definition, callers, and callees.

```mermaid
flowchart TD
    A["Symbol selected in search or file tree"] --> B["Symbol detail panel opens on the right side"]
    B --> C["Panel shows name, kind badge, signature, doc comment, file path, line number, definition snippet"]
    C --> D{"Tabs in detail panel"}
    D -- "Callers" --> E["CallGraph renders incoming call edges"]
    D -- "Callees" --> F["CallGraph renders outgoing call edges"]
    D -- "References" --> G["All references list with file locations"]
    E --> H["User clicks a caller to navigate to it"]
    F --> I["User clicks a callee to navigate to it"]
    H --> A
    I --> A
    G --> J["User clicks a reference to open in file viewer"]
    J --> K["File scrolls to reference line"]
```

**Key UX Decisions:**

- Call graph uses Mermaid flowchart rendering inside a scrollable container.
- Call graph depth limited to direct edges (no transitive expansion in v1).
- Clicking a caller/callee navigates the file viewer to that symbol's definition and updates the detail panel.
- References tab shows a flat list with file path, line number, and a 3-line context snippet.

---

## Flow 4: Triggering a Re-index

The user initiates a fresh scan of the codebase to update the symbol index.

```mermaid
flowchart TD
    A(["User clicks Re-index button in top bar"]) --> B["Confirmation tooltip: 'This will re-scan all files. Continue?'"]
    B --> C{"User confirms?"}
    C -- "Yes" --> D["Index status changes to 'Indexing...'"]
    D --> E["Progress bar appears in top bar"]
    E --> F["File tree greys out during indexing"]
    F --> G{"Indexing completes?"}
    G -- "Success" --> H["Status changes to 'Complete' with timestamp"]
    G -- "Error" --> I["Status shows error count with details"]
    H --> J["File tree refreshes with new data"]
    I --> K["User can view error log or retry"]
    K --> A
    C -- "No" --> L(["No action taken"])
```

**Key UX Decisions:**

- Re-index is a manual trigger only (auto-index on file watch is future scope).
- Progress bar shows `files scanned / total files` with an ETA estimate.
- Indexing is non-blocking — user can browse other tabs during re-index.
- Error log is accessible from the status indicator after a failed index.

---

## Flow 5: Viewing Index Status

The user checks the health and freshness of the codebase index.

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Indexing : Manual trigger
    Idle --> Partial : File watcher detects single change
    Indexing --> Complete : All files scanned
    Partial --> Complete : Changed files re-indexed
    Complete --> Stale : File system changes detected
    Complete --> Idle : Manual full re-index
    Stale --> Indexing : Auto-trigger after debounce
    Stale --> Partial : Single file changed
    Indexing --> Error : Parse failure
    Error --> Idle : Retry on next trigger
    Complete --> [*]
    note right of Indexing : Files scanned / Total files with ETA shown in UI
```

**Index Status States:**

| State        | Indicator                       | Description                                                   |
| :----------- | :------------------------------ | :------------------------------------------------------------ |
| **Idle**     | Gray dot                        | Index exists and is up-to-date. No scan in progress.          |
| **Indexing** | Blue pulsing dot + progress bar | Actively scanning files and extracting symbols.               |
| **Complete** | Green checkmark                 | Index finished successfully with last-indexed timestamp.      |
| **Partial**  | Yellow half-circle              | Some files updated via incremental scan.                      |
| **Stale**    | Orange exclamation              | Files changed on disk since last index; re-index recommended. |
| **Error**    | Red X                           | Indexing failed; count of errors shown.                       |

**Key UX Decisions:**

- Status indicator lives in the top bar, always visible when the Codebase tab is active.
- Clicking the status indicator opens a small dropdown with detailed stats:
  - Total files indexed
  - Total symbols extracted
  - Last indexed timestamp
  - File types breakdown (`.ts`, `.svelte`, `.json`, etc.)
  - Error count (if any)
- Stale state triggers a subtle toast notification: "Files changed — re-index recommended."
