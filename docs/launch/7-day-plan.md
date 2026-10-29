# 7-day launch plan to 1,000+ stars

Follow this literally. Order matters. Each step takes 15-60 minutes.

## Day -2 (Sunday evening) — prep

1. [ ] Record a 20-second GIF of `analyze_binary <path>` on `notepad.exe`. Use [`vhs`](https://github.com/charmbracelet/vhs) or OBS. Save as `docs/launch/hero.gif`.
2. [ ] Record a 30-second GIF of three agents in a mesh — register, send, vote. Save as `docs/launch/mesh.gif`.
3. [ ] Create an SVG social card (1200×630). Dark background, big "mcp-reverse" + "111 tools · 59 backends · 4,200+ skills · multi-agent mesh". Save as `docs/launch/og.svg` + export to PNG.
4. [ ] Set GitHub repo topics: `mcp`, `reverse-engineering`, `game-hacking`, `anti-cheat`, `claude-code`, `multi-agent`, `cursor`, `codex`, `security-research`, `pe-parser`, `ida-pro`, `ghidra`, `x64dbg`, `frida`.
5. [ ] Verify the `Code -> About` section has the one-line tagline and a link to the OG image.

## Day -1 (Monday) — proof points

1. [ ] Publish v4.6.0 tag → auto release workflow fires (npm + ghcr docker).
2. [ ] Verify `npm view mcp-reverse` resolves.
3. [ ] Verify `docker pull ghcr.io/<you>/mcp-reverse:latest`.
4. [ ] Ask three friendly RE / infosec people on Twitter + Discord for a soft review. They RT on launch.
5. [ ] Draft the Dev.to blog from `docs/launch/devto-blog.md`.
6. [ ] Pre-record a 3-minute YouTube screen walkthrough. Private link.

## Day 0 (Tuesday) — launch

Timed to **US Pacific morning**:

- **05:00 PT** — Dev.to post goes live.
- **06:00 PT** — Twitter/X thread from `docs/launch/twitter-thread.md`. Pin tweet 1. Include the GIF.
- **06:15 PT** — Submit to Hacker News using `docs/launch/hn-post.md`. First comment with the architecture Mermaid.
- **06:30 PT** — ProductHunt from `docs/launch/producthunt.md`. All gallery items ready.
- **07:00 PT** — Reddit `/r/ReverseEngineering` using `docs/launch/reddit-posts.md`. Then wait 2 hours before the next sub.
- **09:00 PT** — Reddit `/r/REMath` and `/r/exploitdev`.
- **11:00 PT** — Reddit `/r/gamedev`.
- **13:00 PT** — Lobste.rs submission (link the HN post if it's doing well).
- **16:00 PT** — Email three awesome-list maintainers with the one-line pitch.
- **21:00 PT** — Post to Chinese dev communities (V2EX, 掘金) if you have an account.

Rules:
- Answer every HN / PH comment within 15 minutes for the first 4 hours.
- Don't ask for stars. The GIF asks for stars.
- Thank anyone who RTs.

## Day 1 — ride the wave

1. [ ] Second Twitter thread: "What landed in the first 24h — top 3 workflows people showed me."
2. [ ] If HN has you on the front page, post the GitHub stats growth as a reply.
3. [ ] Open a GitHub Discussion: "What anti-cheat / technique do you want documented next?"
4. [ ] Tag it as `good-first-issue` and encourage PRs.
5. [ ] Email game-sec newsletter authors (`VulnCheck`, `This Week in Security`, `TLDR Infosec`).

## Day 2-3 — awesome-* PRs

Submit PRs adding this project to:

- `awesome-mcp-servers`
- `awesome-reverse-engineering`
- `awesome-game-security`
- `awesome-anti-cheat`
- `awesome-claude-code`
- `awesome-ai-tools`
- `awesome-security`
- `awesome-sysadmin`

One PR per day so maintainers aren't overwhelmed.

## Day 4-5 — content multiplier

1. [ ] Record a 3-min YouTube demo. Title: "Three AI models reverse-engineer malware together".
2. [ ] Cross-post the Dev.to blog to Medium + Hashnode.
3. [ ] Shorter format: TikTok / Shorts / Reels of the mesh GIF with voiceover.
4. [ ] Guest post on `0xrick.dev` or `windows-internals.com` if you have a connection.

## Day 6-7 — community

1. [ ] Open a Discord server. Post invite in the README banner and in replies to every GitHub issue.
2. [ ] Host a 30-minute office hours stream on Twitch.
3. [ ] Review every PR within 24 hours.

## After day 7

The star curve plateaus. Keep momentum with:
- Weekly PR summary tweets.
- Monthly "RE technique spotlight" posts drawing from the skill library.
- `v4.7` and `v5.0` roadmap updates.
- Quarterly "state of game security" write-up.

## What NOT to do

- Don't buy stars. GitHub detects it, and the community spots it.
- Don't farm fake issues. Signal/noise matters.
- Don't launch during US holidays or finals week.
- Don't launch after another high-profile MCP project launches the same week.
- Don't call it a cheat anywhere. The framing is defensive / research.
