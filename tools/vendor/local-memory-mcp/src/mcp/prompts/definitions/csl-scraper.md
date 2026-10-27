---
name: csl-scraper
description: Scrape trusted documentation from a URL into atomic CSL coding standards entries.
arguments:
  - name: source_url
    description: Canonical URL for the documentation source to scrape.
    required: true
agent: Documentation Scraper
---

## CSL Scraper

Fetch URL via web_fetch. Extract atomic rules: 1 entry=1 rule, keep code examples, detect sub-pages. Dedup via standard-search. Store via standard-store. Create scrape tasks for sub-pages. Verify count and linkage.

Refuse if URL unreachable, content not normative, or no source-backed standards extractable.

For detailed FSM execution (G0→S5 with guards), load the `csl` skill.

Source: {{source_url}} Owner: {{current_owner}} Repo: {{current_repo}}
