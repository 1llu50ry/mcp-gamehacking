# User Flow Descriptions


This document maps the primary user journeys within the Local Memory Dashboard.

## Flow 1: Contextual Information Audit

1. **Entry Point:** User opens the dashboard (http://127.0.0.1:3456).
2. **Action:** User selects a repository from the sidebar.
3. **Observation:** Dashboard widgets update to show the memory count, task status, and recent hits/misses for that specific repo.
4. **Transition:** User clicks the **Activity** tab to see the latest agent queries and ensure the memory is being retrieved as expected.

## Flow 2: Knowledge Seeding (Bulk Import)

1. **Entry Point:** User navigates to the **Memories** tab.
2. **Action:** User clicks the "Bulk Import" button (icon: upload).
3. **Modal:** A specialized modal appears requesting a JSON or Markdown file.
4. **Validation:** System checks file format and provides immediate feedback.
5. **Execution:** User clicks "Import".
6. **Result:** The memory list refreshes dynamically, showing the newly seeded knowledge items.

## Flow 3: Inspecting Agent Capabilities

1. **Entry Point:** User needs to know what tools the agent has available.
2. **Action:** User clicks the **Reference** tab.
3. **Filter:** User types "task" into the Filter bar.
4. **Inspection:** User clicks on `task-list`.
5. **Detail:** A drawer opens showing the JSON Schema for parameters, the expected output format, and the tool's description.

## Flow 4: Task Recovery & Promotion

1. **Entry Point:** User identifies a "Stalled" task in the Kanban board.
2. **Action:** User clicks the task card.
3. **Audit:** User reads the comments within the task detail to see which agent last interacted with it.
4. **Correction:** User updates the task status to **In Progress** to resume the work, or **Completed** to finalize it.
5. **Promotion:** System enforces the Gradual Promotion model (transitions must pass through `in_progress`).
6. **Refresh:** The Kanban board updates in real-time.

## Flow 5: Knowledge Graph Exploration

1. **Entry Point:** User navigates to the **Knowledge Graph** tab.
2. **Action:** User selects a repository from the sidebar.
3. **Visualization:** A force-directed graph displays entities (nodes) and relations (edges).
4. **Interaction:** User can drag nodes, zoom/pan, and hover to see entity details.
5. **Drill-down:** User clicks an entity node to view its observations and related entities.

## Flow 6: Coding Standards Review

1. **Entry Point:** User navigates to the **Standards** tab.
2. **Action:** Browse the list of coding standards for the active repository.
3. **Filter:** User filters by language (e.g., TypeScript) or stack (e.g., React).
4. **Detail:** User clicks a standard to see full description, rationale, and recommendation.
5. **Action:** User can edit or deprecate outdated standards.

## Flow 7: Multi-Agent Coordination

1. **Entry Point:** User navigates to the **Handoffs** tab.
2. **View:** User sees all pending, accepted, and expired handoffs between agents.
3. **Inspect:** User clicks a handoff to view the full context payload.
4. **Manage:** User can view active task claims and release stale claims if needed.
