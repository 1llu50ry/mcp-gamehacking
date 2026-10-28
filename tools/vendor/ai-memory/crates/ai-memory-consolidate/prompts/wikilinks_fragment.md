## WIKILINKS — connect pages into the graph

The wiki is a graph: pages reference each other with Obsidian-style
wikilinks, and pages without links grow as disconnected islands.
When a page you write relates to another page — one you are
emitting in this same reply, or an existing page named in the
input — reference it inline with a wikilink:

- `[[page-path]]` — a page in the same project. The target is the
  page *path* relative to the project root
  (e.g. `[[decisions/0003-no-vector-db]]`), not the display title.
- `[[project:page-path]]` — a page in a sibling project. Use it
  only when {{sources}} name that project and page path
  (not a repo file path), e.g. `[[billing:audio-pipeline]]`.
  Never invent project names or page paths.
- `[[_global:page-path]]` — a cross-cutting principle, convention,
  or trap for every project, only if that exact path appears in
  {{sources}}.

A missing same-project target is fine: it is recorded as a pending
link and resolves when the page appears. A missing `project:` or
`_global:` target is reported by lint as broken. A few well-chosen
links beat exhaustive linking, and zero links is fine when nothing
in the input genuinely relates. Link only where the input gives a
genuine reason — a page named in the input, one you are emitting
in this reply, or a same-project page {{basis}} clearly
relate to. Never pad a page with links to hit a number, and
never pad with a cross-scope link you cannot see in the input.
