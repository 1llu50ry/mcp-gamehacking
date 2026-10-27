# Dashboard Content Layout

> **Note (2026-09-06, v0.44.1):** Superseded by PRs #104–106 — workspace-first navigation (WorkspaceSwitcher), 9 shared primitives, lazy route splitting (-44%), arena HiDPI. See CHANGELOG 0.44.1. Content below is historical.


This document details the specific grid layouts for each primary tab in the dashboard.

## 1. Dashboard Tab (Overview)

- **Grid Strategy**: Vertical flow with nested horizontal rows.
- **Components**:
  - `StatsWidget`: Full-width row with 4 metric cards.
  - `TaskStatsWidget` + `TimeStatsWidget`: Two-column grid (Responsive: Single column on mobile).

## 2. Activity Tab (Log)

- **Grid Strategy**: Single column flex-layout.
- **Container**: Glass card with internal scrolling.
- **Scroll Pattern**: "Load More" pagination at the bottom with burst condensation.

## 3. Memories Tab (Explorer)

- **Grid Strategy**: Flex-column with persistent header (Search + New Memory buttons).
- **List Pattern**: Scrollable list of memory cards with infinite scroll.
- **Responsiveness**: Cards take 100% width of container.

## 4. Tasks Tab (Kanban)

- **Grid Strategy**: 4-column horizontal scroll group (`min-width: 260px` per column).
- **Columns**: Backlog, To Do (`pending`), In Progress, Completed.
- **Mobile Pattern**: Horizontal scroll with snap-points for single-column viewing.

## 5. Reference Tab (Engine)

- **Grid Strategy**: Master-detail or search-filtered list.
- **Filter Bar**: Sticky top inside the glass card.
- **Drawer Trigger**: Item selection persistent across search refreshes.

## 6. Standards Tab

- **Grid Strategy**: Vertical list with search/filter header.
- **Panels**: Side-by-side list + detail panel on larger screens.

## 7. Handoffs Tab

- **Grid Strategy**: Single column list with status badges.
- **Filters**: Status, from_agent, to_agent filter bar.

## 8. Knowledge Graph Tab

- **Grid Strategy**: Full-viewport canvas with overlay controls.
- **Interaction**: Force-directed graph with zoom, pan, and drag support.

## 9. Responsive Breakpoints

- **Desktop (>1024px)**: Full sidebar, multi-column grids, graph full viewport.
- **Tablet (768px - 1024px)**: Sidebar collapses to icons, main content stays multi-column where possible.
- **Mobile (<768px)**: Sidebar hidden (Mobile drawer menu available), all grids collapse to single-column, Kanban enables horizontal touch-scrolling, KG switches to touch-optimized controls.

## 10. Global Layout

```mermaid
flowchart TB
    TopBar["TopBar — Window Controls — Logo — Search Agents... — Theme Toggle"]
    TabNav["Tab Nav — Dash — Activity — Memories — Tasks — Ref — Std — Handoffs — KG"]
    Sidebar["Sidebar — Repo Avatars — Collapse"]
    MainContent["MAIN CONTENT AREA — Glass Card Container"]

    TopBar --> TabNav --> Body
    subgraph Body["Body Layout"]
        direction LR
        Sidebar --- MainContent
    end
```
