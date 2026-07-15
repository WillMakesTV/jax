Jax has a built-in bug queue. The producer files debug reports from the bug button in the app's top bar (or from Settings → Development), and an AI client connected over MCP works each report to resolution. The queue is the source of truth: a report exists because something is broken or wrong, and it is deleted only once that is no longer true.

## The report model

Each debug report has:

- **title** — a short summary line.
- **description** — the long-form description of the bug: what happens, what was expected, and any reproduction notes the producer added.
- **route** — the app view id where the bug shows up (e.g. `dashboard`, `planning`, `settings`, `stream-details`). Jax has no URL router; these ids come from the frontend's `ViewId` union in `frontend/src/navigation.ts`, and the matching view component lives under `frontend/src/views/`.
- **global** — true when the problem is app-wide rather than tied to one view (crashes, styling regressions, data corruption). Global reports may leave `route` blank.

## The tools

- `count_debug_reports` / `list_debug_reports` — check the queue. Do this at the start of a session; any result is work to pick up.
- `search_debug_reports` — find reports by words in the title or description.
- `get_debug_report` — one report by id.
- `save_debug_report` — omit `id` to file a new report; include it to update one. Update the description with findings if you must pause an investigation mid-way, so the next session doesn't start from zero.
- `delete_debug_report` — remove a report. This is the **resolve** step and the only destructive delete Jax exposes over MCP.

## Working a report

1. Read the report and open the code behind its `route` (or, for global reports, the shared shell: `frontend/src/App.tsx`, `TopBar`, `StatusBar`, or the Go backend).
2. Reproduce the problem, or at least trace the code path until the description's symptoms are explained.
3. Fix it, matching the surrounding code's conventions.
4. Verify: run the Go tests, build the frontend, and exercise the affected flow. A report is not resolved because the code "should" work now.
5. Only after the fix is verified, call `delete_debug_report` with the report's id. If you could not resolve it, leave the report in place and append what you learned to its description with `save_debug_report`.

Never delete a report you did not fix, and never let a resolved report linger — the queue's value is that empty means nothing is known to be broken.
