# Release 5.0.0

The on-disk project drops from **19 GiB working tree** to **3.3 GiB**
by replacing every `skills/*/source.txt` with its gzip-6 compressed
counterpart. The read helpers inside the server decompress on demand,
so every existing tool keeps working — nothing to opt into.

## For users

### `npm` — the smallest install

```bash
npx -y mcp-gamehacking           # ~a few MiB tarball, no skills/
# or
npm i -g mcp-gamehacking
mcp-gamehacking serve
```

`package.json` `files[]` ships `dist/` + `bin/` + `signatures/` +
`plugins-side/` + `examples/` + `deploy/` + `docs/`. The skills tree
is NOT in the npm tarball to keep the package small; the server
degrades gracefully to "no source" for `grep_sources` /
`read_source` when it's absent.

To add the skills tree later:

```bash
git clone --depth=1 https://github.com/1llu50ry/mcp-gamehacking \
  --branch claude/mcp-gamehacking-skills-docs-1d668c \
  --single-branch /path/to/mcp-gamehacking
```

A shallow clone fetches ~3.3 GiB instead of the full history.

### Docker — zero local Node

```bash
docker run --rm -p 7777:7777 \
  -e MCP_AUTH_TOKEN=$(openssl rand -hex 32) \
  -v /path/to/samples:/samples:ro \
  ghcr.io/1llu50ry/mcp-gamehacking:5.0.0
```

Or `docker compose up -d` from the compose file in the repo.

Image is multi-arch (amd64 + arm64), ~400 MiB after the gzipped
skills tree.

### Working with the compressed sources

```bash
# Unpack everything into source.txt files for external grep tools
node bin/mcp-gamehacking.mjs unpack

# Repack back to .gz when you're done
node bin/mcp-gamehacking.mjs pack

# Or just one skill
node bin/mcp-gamehacking.mjs unpack ags-apex-legends-cheat
```

The server itself reads `.gz` transparently; you only need to unpack
if you want to use `rg` / `grep` / your editor's search directly.

## For maintainers

### Cutting a new release

1. Bump `package.json#version`.
2. Prepend a `CHANGELOG.md` section.
3. `git commit -am "release vX.Y.Z"`.
4. `git tag -a vX.Y.Z -m "..."` and `git push --follow-tags`.

The `.github/workflows/release.yml` workflow does the rest:
- `npm publish --provenance` (needs `NPM_TOKEN` secret)
- `docker buildx build --push` → `ghcr.io/<owner>/mcp-gamehacking:<ver>`
- GitHub Release with auto-generated notes

### Shrinking the git history further

The current pack still carries every historical `skills/*/source.txt`
(roughly 3 GiB of pack after v5.0.0, down from ~6 GiB without the
gzip migration). To rewrite history and strip those blobs:

```bash
# One-shot: nuke uncompressed source.txt from every commit.
# DESTRUCTIVE — force-push will follow, every collaborator must re-clone.
pip install git-filter-repo
git filter-repo --path-glob 'skills/*/source.txt' --invert-paths
git remote add origin https://github.com/1llu50ry/mcp-gamehacking
git push --force --all && git push --force --tags
```

Expect the pack to drop from ~3 GiB to ~500 MiB. If you'd rather
keep history intact and give collaborators a shallow option instead,
leave this alone and tell them to `git clone --depth=1`.
