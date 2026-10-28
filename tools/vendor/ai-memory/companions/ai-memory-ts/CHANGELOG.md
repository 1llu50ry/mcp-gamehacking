# Changelog

All notable changes to the TypeScript SDK are documented here. The SDK
versions independently of the ai-memory server.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `query` takes the server's `memory_query` page filters: `kind`, `tier`,
  `pathPrefix` and `tag`, in every search mode.

## [0.1.0]

### Added

- First release (unpublished; build from a checkout). `AiMemoryClient` wraps
  the page, query, status, handoff, recent, message, briefing, explore,
  session-observation and feedback tools, plus the read-only `/api/v1` routes
  with cursor paging and `ETag` revalidation, `GET /identity` and capability
  probing. `pages.update` is a read-modify-write helper guarded by
  `expectedPageId`. `AdminClient` (from `ai-memory-ts/admin`) lists
  checkpoints, restores pages and purges sessions or projects, with dry runs
  by default. Requires ai-memory 3.0.0 or newer and Node 22 or newer. (#1165)
