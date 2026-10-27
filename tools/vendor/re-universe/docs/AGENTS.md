# AGENTS.md — RE Universe Project

You are a coding agent working on **re-universe**, a comprehensive reverse engineering platform that integrates Ghidra, BSim, and AI-powered analysis tools.

## 🔴 MANDATORY WORKFLOW

### Every Change Must Follow This Process:

1. **Make incremental changes** (small, testable units)
2. **Test locally** — run health-check.sh or relevant tests
3. **Verify on website** — check https://d2docs.xebyte.com if change affects web
4. **Commit with clear message** — `git add -A && git commit -m "descriptive message"`
5. **Report results** — confirm what changed and that it's working

### Website Verification Checklist
For ANY change that could affect d2docs.xebyte.com:
- [ ] Restart relevant Docker service: `docker compose restart <service>`
- [ ] Wait 10s for service to be healthy
- [ ] Check website loads: `curl -s https://d2docs.xebyte.com | head -20`
- [ ] Verify specific feature/change is visible
- [ ] Take screenshot or capture output as proof

### Commit Practices
- Commit after EVERY verified working change
- Use semantic commit messages: `fix:`, `feat:`, `docs:`, `chore:`
- Never leave working changes uncommitted
- Push to remote after significant milestones

## Project Context

- **Repo**: https://github.com/bethington/re-universe
- **Live Site**: https://d2docs.xebyte.com
- **Stack**: Docker Compose orchestration with multiple services

## Key Services

| Service | Purpose | Port |
|---------|---------|------|
| ghidra-mcp | MCP server | 8080 |
| ghidra-server | Ghidra headless | - |
| bsim-postgres | BSim database | 5432 |
| vector-search | Embedding search | - |
| ai-orchestration | AI coordination | - |
| d2-docs-website | Web frontend | 80/443 |

## Directory Structure

- `services/` — Individual service configurations
- `docker-compose.yml` — Main orchestration
- `ghidra-mcp/` — MCP integration (submodule)
- `web/` — Web interfaces (serves d2docs.xebyte.com)
- `scripts/` — Utility scripts
- `docs/` — Documentation

## Current Priorities

See TODO.md for current task list.

## Commands

```bash
# Service management
docker compose up -d              # Start all
docker compose down               # Stop all
docker compose restart <service>  # Restart one
docker compose logs -f <service>  # View logs

# Health & testing
./health-check.sh                 # Check all services
./integration-tests.sh            # Run tests

# Verification
curl -s https://d2docs.xebyte.com | head -50  # Check website
```

## Guidelines

- Use `docker compose` for service management
- Check logs: `docker compose logs -f <service>`
- Test changes in isolation before deploying
- Update TODO.md with progress
- **ALWAYS verify web changes are live before moving on**
