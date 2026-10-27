# Acceptance Criteria: Task Management

State management for work-in-progress goals.


## 1. Lifecycle Integrity (`task-update`)

- **Given** a task is in state `pending` or `backlog`,
- **When** an agent attempts to change status to `completed`,
- **Then** the system MUST reject with a Validation Error (Must be `in_progress` first).

## 2. Active Focus Enforcement (`task-update`)

- **Given** another task is already `in_progress` in the current repo,
- **When** a new task is moved to `in_progress`,
- **Then** the system SHOULD allow context grouping (based on client configuration).

## 3. Transparency & Token Usage (`task-update`)

- **Given** a task is moved to `completed`,
- **When** the update call is processed,
- **Then** the system MUST REQUIRE `est_tokens` to be provided in the request body.

## 4. Bulk Transactability

- **Given** a list of multiple creation/deletion/update operations,
- **When** any single operation within the list fails validation,
- **Then** the ENTIRE set of operations MUST be rolled back to maintain database consistency.

## 5. Audit Logging

- **Given** any task state change (Transition),
- **When** the operation finishes,
- **Then** an entry MUST be automatically created in `task_comments` containing the comment, agent, and previous/next status.

## 6. Auto-Archiving

- **Given** a task is moved to `completed`,
- **Then** the system MUST automatically generate a `task_archive` type memory containing the task's full description and comment history.

## 7. Claim Integrity (`task-claim`)

- **Given** a task is claimed by an agent,
- **When** another agent attempts to claim the same task,
- **Then** the system MUST reject with a conflict error (unique constraint on task_id).

## 8. Task Search (`task-search`)

- **Given** tasks exist in the database,
- **When** searched by `task_code` or `title` keyword,
- **Then** the system MUST return matching tasks with ranking.
