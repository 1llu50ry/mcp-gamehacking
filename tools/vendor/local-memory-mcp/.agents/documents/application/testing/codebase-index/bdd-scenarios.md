# BDD Scenarios — Codebase Index

> **Format**: Gherkin (Given/When/Then)
> **Scope**: MVP features (P0) plus critical Should-have features (P1)


---

## Scenario 1: Successful Full Index of a TypeScript Project

```
Feature: Full Codebase Index
  As an AI agent
  I want to index a TypeScript project
  So that I can query symbols without file-by-file exploration

  Scenario: Index a standard TypeScript project
    Given a project at "/home/user/project" containing:
      | file                          | lines |
      | src/orders/orderService.ts    | 120   |
      | src/orders/orderTypes.ts      | 45    |
      | src/payments/payService.ts    | 200   |
      | src/index.ts                  | 30    |
      | node_modules/lodash/...       | 5000  |
      | dist/bundle.js                | 3000  |
    And the project has a ".gitignore" that excludes "node_modules/" and "dist/"
    When the system runs "index_project" with root "/home/user/project"
    Then the system discovers exactly 4 files to parse
    And the system parses all 4 files via tree-sitter
    And the system stores symbols in the SQLite database
    And the system returns a success response with:
      | field          | value |
      | files_indexed  | 4     |
      | symbols_stored | 28    |
      | duration_ms    | <5000 |
```

---

## Scenario 2: Search for a Symbol by Exact Name

```
Feature: Symbol Search
  As an AI agent
  I want to search for symbols by name
  So that I can find relevant code quickly

  Scenario: Exact match search returns correct results
    Given an indexed project containing symbols:
      | name            | kind      | file                    | line |
      | formatOrder     | function  | src/orders/orderService | 42   |
      | formatOrderItem | function  | src/orders/orderService | 78   |
      | OrderFormatter  | class     | src/orders/formatting   | 15   |
      | orderTotal      | function  | src/payments/payService | 33   |
    When the agent calls "search_symbols" with query "formatOrder"
    Then the results contain exactly 3 symbols
    And the first result is "formatOrder" with kind "function"
    And each result includes: name, kind, file, line, signature
```

---

## Scenario 3: List All Symbols in a File

```
Feature: File Symbol Listing
  As an AI agent
  I want to list all symbols in a file
  So that I can understand a module's API

  Scenario: Get all symbols from a utility file
    Given an indexed project with file "src/utils/format.ts" containing:
      - Exported function "formatCurrency"
      - Exported class "DateFormatter"
      - Internal function "padNumber"
      - Exported type "FormatOptions"
    When the agent calls "get_file_symbols" with path "src/utils/format.ts"
    Then the response contains 4 symbols
    And the symbols are ordered by declaration position
    And symbol "formatCurrency" has "exported": true
    And symbol "padNumber" has "exported": false
    And symbol "DateFormatter" includes methods "format" and "parse"
```

---

## Scenario 4: Index an Empty Directory

```
Feature: Edge Case — Empty Directory
  As an AI agent
  I want to handle empty projects gracefully
  So that indexing does not fail on repositories with no source files

  Scenario: Index a directory with no matching source files
    Given a project directory containing only:
      | file           | type     |
      | README.md      | markdown |
      | package.json   | json     |
      | .gitignore     | git      |
    When the system runs "index_project"
    Then the system discovers 0 files to parse
    And the system returns a success response with "files_indexed": 0
    And the system does not create any symbol records
    And subsequent "search_symbols" queries return empty arrays (not errors)
```

---

## Scenario 5: Index with Unsupported and Binary Files

```
Feature: Edge Case — Mixed File Types
  As an AI agent
  I want indexing to skip unsupported file types without crashing
  So that projects with mixed languages still index correctly

  Scenario: Project contains binary and unsupported files alongside TypeScript
    Given a project directory containing:
      | file                 | type        |
      | src/app.ts           | typescript  |
      | src/logo.png         | binary      |
      | src/data.json        | json        |
      | src/setup.py         | python      |
      | src/helpers.js       | javascript  |
    When the system runs "index_project"
    Then the system parses "src/app.ts" and "src/helpers.js"
    And the system skips "src/logo.png" (binary detection)
    And the system skips "src/data.json" (unsupported extension)
    And the system skips "src/setup.py" (unsupported extension)
    And the system logs a DEBUG message for each skipped file
    And the total "files_indexed" is 2
```

---

## Scenario 6: Incremental Re-Index After File Changes

```
Feature: Incremental Re-Index
  As a developer
  I want the index to update incrementally when files change
  So that the code graph stays current without full re-indexing

  Scenario: Modified and new files are re-indexed incrementally
    Given a fully indexed project with 20 files
    And the index timestamp is "2026-07-22T08:00:00Z"
    When a developer modifies file "src/orders/service.ts" at "2026-07-22T09:00:00Z"
    And a developer adds file "src/orders/validator.ts" at "2026-07-22T09:01:00Z"
    And the system runs "index_project" with "incremental: true"
    Then the system re-parses "src/orders/service.ts" (mtime > index timestamp)
    And the system parses new file "src/orders/validator.ts"
    And the system processes exactly 2 files (not 22)
    And the system updates the index timestamp to the current time
```

---

## Scenario 7: Very Large File Handling

```
Feature: Edge Case — Large File Limits
  As an AI agent
  I want indexing to handle very large files gracefully
  So that a single huge file does not block the entire index

  Scenario: Project contains one extremely large generated file
    Given a project directory containing:
      | file                        | lines   | note                   |
      | src/index.ts                | 50      | normal entry point     |
      | src/generated/graphql.ts    | 120000  | auto-generated schema  |
      | src/services/smallService.ts| 200     | normal service file    |
    When the system runs "index_project"
    Then "src/index.ts" and "src/services/smallService.ts" are fully parsed
    And "src/generated/graphql.ts" is skipped (exceeds 50,000 line limit)
    And the system logs "WARN: Skipping src/generated/graphql.ts (120000 lines)"
    And the index completes successfully with 2 files indexed
    And subsequent "search_symbols" queries work for symbols in the 2 indexed files
```

---

## Scenario 8: Search with No Matches

```
Feature: Empty Search Results
  As an AI agent
  I want search to handle queries with no matches gracefully
  So that I can distinguish "no results" from errors

  Scenario: Search for a non-existent symbol
    Given an indexed project with symbols ["formatOrder", "calculateTotal", "UserModel"]
    When the agent calls "search_symbols" with query "NonExistentSymbol_XYZ"
    Then the response is an empty array []
    And the response status is "success" (not an error)
    And the response includes a "total_matches": 0 field
```

---

## Scenario Mapping

| Scenario                | Feature(s) | Quality Attribute          |
| :---------------------- | :--------- | :------------------------- |
| 1. Full index           | M1, M2, M3 | Correctness, Completeness  |
| 2. Search symbol        | M4         | Relevance, Accuracy        |
| 3. File symbols         | M5         | Completeness               |
| 4. Empty directory      | M1         | Robustness                 |
| 5. Mixed file types     | M1, M2     | Robustness, Error handling |
| 6. Incremental re-index | S4         | Correctness, Performance   |
| 7. Large file           | M2         | Robustness, Limits         |
| 8. No match search      | M4         | UX, Error handling         |
