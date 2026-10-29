# Contributing

Love that you're here. Three ways to help.

## 1. Add a skill (easiest, highest impact)

A **skill** is a one-page `SKILL.md` that captures a specific RE technique, anti-cheat subsystem, game-engine internal, or binary-format quirk.

```bash
mkdir -p skills/your-skill-name
cat > skills/your-skill-name/SKILL.md <<'EOF'
---
name: your-skill-name
description: "One sentence a search engine should return your skill on."
metadata:
  type: tool-reference
  source: curated
  topics: [tag1, tag2, tag3]
---

# Title

## When to use

...

## How it works

...

## Related

[[other-skill]], [[yet-another]]
EOF

npm run build
./bin/mcp-reverse.mjs search your-skill-name   # confirm it shows up
```

**Good-first-issue skills we want:**

- `nvidia-reflex-pipeline`
- `aws-gamelift-session-rev`
- `riot-social-chat`
- `cs2-vacnet-3-breakdown`
- `vanguard-pcr11-measurement`
- `discord-voice-webrtc`
- `twitch-stream-overlay-detection`
- `obs-vs-streamer-mode-detect`
- `ue5-verse-vm-internals`
- `hyperion-handler-mutation-weekly`

Pick one, open a PR. Three-paragraph skills are fine — depth > breadth.

## 2. Add an MCP tool

```bash
# Add a new tool in src/your-module.ts, register it in src/index.ts.
npm run build && npm test
```

Guidelines:

- Zero npm deps unless the feature truly requires one.
- All file-reading tools must call `requirePathAllowed(path)` from `src/fs-sandbox.ts`.
- Return `{ content: [{ type: "text" as const, text }] }` for success, `isError: true as const` for failure.
- Add a test under `tests/*.test.mjs`.

## 3. Add an RE/debug backend to the hub catalog

```ts
// src/retools.ts
"your-mcp-id": {
  id: "your-mcp-id",
  name: "Your tool MCP",
  kind: "static" | "dynamic" | "both",
  os: ["windows", "linux", "macos"],
  requires: "the one-line prereq",
  install: ["pip install your-mcp"],
  launch: { cmd: "your-mcp", args: [], http: { port: 7777 } },
  mcpConfig: { "your-mcp": { command: "your-mcp", args: [] } },
  tags: ["your", "tags"],
  notes: "what makes this unique vs ida-pro-mcp / superghidra-mcp",
},
```

Add it to the id union at the top of `src/retools.ts`.

## Dev loop

```bash
npm install
npx tsc           # typecheck
npm test          # 20+ node:test cases
./bin/mcp-reverse.mjs stats
./bin/mcp-reverse.mjs tools      # inventory
```

## Code style

- TypeScript strict mode, no `any` without a `// reason:` comment.
- No bundler dependencies — the server runs on bare Node.
- Prettier default formatting.
- Keep tool descriptions under 500 chars; they go into the MCP tool catalog that models read.
- English in code; Russian/English in docs is fine.

## What we won't accept

- Turnkey cheats or aim injectors for specific live games.
- Hardcoded bypasses for a specific anti-cheat build (we document the technique, we don't publish 0-days against a game that's live right now).
- Copyrighted binaries.
- Scripts that exfiltrate secrets.

## License

By contributing you license your changes under the MIT license (`LICENSE`).
