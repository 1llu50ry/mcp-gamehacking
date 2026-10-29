# Roadmap

Rolling list of what we want to build next. Order is best-effort; priority follows community interest.

## v4.7 — polish & distribution

- [ ] Publish `mcp-reverse` to npm (automated via tag `v*`).
- [ ] Ship multi-arch Docker image to `ghcr.io/<org>/mcp-reverse:latest`.
- [ ] Awesome-list submissions: `awesome-mcp-servers`, `awesome-reverse-engineering`, `awesome-game-security`.
- [ ] Dev.to launch post.
- [ ] 3-minute YouTube demo of the agent-mesh orchestration.
- [ ] Discord server.
- [ ] GitHub Discussions enabled.
- [ ] GitHub Sponsors enabled (`FUNDING.yml`).

## v4.8 — perf & observability

- [ ] Persistent BM25 index on disk (`.index.bin`), rebuild on skill-tree mtime change.
- [ ] OpenTelemetry traces per tool.
- [ ] Response caching layer with content-addressed hash of args.
- [ ] Per-tool `/metrics` histograms.
- [ ] Streaming tool responses for `grep_sources` + `pattern_mine`.

## v4.9 — native parsers continued

- [ ] CAB / MSI
- [ ] DWARF v5 line program
- [ ] PDB stream directory (not just RSDS)
- [ ] ETW provider manifest parser
- [ ] Unity AssetBundle inner structure (not just header)
- [ ] UE4/UE5 .pak index walker (encrypted + unencrypted)
- [ ] Full IL2CPP metadata decoder in TS

## v5.0 — intelligence layer

- [ ] Local embedding model for semantic skill search (optional dep).
- [ ] "Agent playbook" templates: `playbook_bypass`, `playbook_offset_migration`, etc.
- [ ] LLM-as-judge for `hub_consensus_call` disagreements.
- [ ] Automated changelog from mesh audit log.
- [ ] Semantic diff of two SKILL.md versions.

## v5.x — platform support

- [ ] WebSocket transport (in addition to stdio + streamable HTTP).
- [ ] gRPC transport.
- [ ] Browser extension that acts as an MCP client.
- [ ] REST API shim for non-MCP clients.
- [ ] i18n of hero skills (RU first — much of the game-RE scene).

## Non-goals

- We will NOT ship cheats, aim injectors, or anti-cheat bypasses that are turnkey against live services.
- We will NOT bundle copyrighted game binaries.
- We will NOT help impersonate another player.

## How to contribute to the roadmap

Open an issue or PR, or vote with 👍 on existing issues. [CONTRIBUTING.md](CONTRIBUTING.md) explains the dev loop.
