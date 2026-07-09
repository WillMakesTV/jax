Projects are containers for a body of work — a launch, a campaign, a rebrand — holding a markdown overview, a nestable tree of markdown docs, and asset files with descriptions. They are the app's general-purpose writing and reference space, and the most natural place to store research, briefs, and drafts you produce.

## Reading projects

- `list_projects` — summaries: ids, titles, descriptions, asset and doc counts.
- `get_project` — one project in full, including the entire doc tree with content. Doc content can be large; list first, fetch the one project you need.

## Writing

- `save_project` creates a project (omit `id`) or updates its title and markdown description. It never touches assets or docs.
- `save_project_doc` creates or updates a doc in the project's tree:
  - omit the doc `id` to create, pass it to update;
  - `parentId` nests the doc under another doc (`""` = top level);
  - `content` is markdown.

There are no delete tools — removing projects, docs, or assets happens in the app only.

## Conventions that keep projects useful

- One project per initiative, not per task. Use the doc tree for structure: a top-level doc per workstream, children for details.
- When saving generated work (research, summaries, plans), give the doc a title that states what it is and when it was made; update an existing doc rather than piling up near-duplicates.
- The project description is the landing page — keep it a short orientation (goal, status, links to the key docs), not a dumping ground.
- Asset files are added in the app (native file dialogs are not exposed over MCP); you can still reference them by name in docs.

In the app, projects live under **Projects**, with Overview, Files, and Docs tabs; docs are edited with the same markdown editor used elsewhere.
