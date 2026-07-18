Jax has a built-in bug queue. The producer files debug reports from the bug button in the app's top bar (or from Settings → Development), and an AI client connected over MCP works each report to resolution. The queue is the source of truth: a report exists because something is broken or wrong, and it is deleted only once that is no longer true.

## The report model

Each debug report has:

- **description** — the report itself, written in markdown from the app's editor: what happens, what was expected, and any reproduction notes the producer added. There is no separate title field; derive a summary line from the description when you need one (older reports may still carry a stored title).
- **route** — the app view id where the bug shows up (e.g. `dashboard`, `planning`, `settings`, `stream-details`). Jax has no URL router; these ids come from the frontend's `ViewId` union in `frontend/src/navigation.ts`, and the matching view component lives under `frontend/src/views/`.
- **global** — true when the problem is app-wide rather than tied to one view (crashes, styling regressions, data corruption). Global reports may leave `route` blank.
- **checkedOut** — true once an agent has claimed the report. It lets several agents share one queue without colliding: skip a report whose `checkedOut` is already true, and claim the one you pick before you start.

## The tools

- `count_debug_reports` / `list_debug_reports` — check the queue. Do this at the start of a session; any result is work to pick up.
- `search_debug_reports` — find reports by words in the description.
- `get_debug_report` — one report by id.
- `check_out_debug_report` — claim a report before working it: it flips the report's `checkedOut` to true for everyone else, and fails if another agent already holds it. This is how concurrent agents divide the queue — call it the moment you pick a report.
- `save_debug_report` — omit `id` to file a new report; include it to update one. Update the description with findings if you must pause an investigation mid-way, so the next session doesn't start from zero.
- `delete_debug_report` — remove a report. This is the **resolve** step and the only destructive delete Jax exposes over MCP.

## Working a report

1. Pick a report whose `checkedOut` is false and claim it with `check_out_debug_report` — from that moment other agents skip it.
2. Open a GitHub issue for it with the built-in `gh` CLI, so the work is visible on the repository: `gh issue create --title "<summary derived from the description>" --body "<the report's description, plus its route and report id>"`. Note the issue number for the commit.
3. Read the report and open the code behind its `route` (or, for global reports, the shared shell: `frontend/src/App.tsx`, `TopBar`, `StatusBar`, or the Go backend).
4. Reproduce the problem, or at least trace the code path until the description's symptoms are explained.
5. Fix it, matching the surrounding code's conventions.
6. Verify: run the Go tests, build the frontend, and exercise the affected flow. A report is not resolved because the code "should" work now.
7. Commit the fix and push it. The commit message's summary line names the change; its body describes what was added or changed and why — the message should stand on its own as a record of the work, and cite the issue (e.g. `Fixes #12` so GitHub links and closes it). Never add a `Co-Authored-By` trailer.
8. Comment on the issue that it is resolved: what was added or changed, and how to test it — the concrete steps in the app (which page, which buttons, what to expect) that show the fix working. `gh issue comment <n> --body "<resolution note>"`. Then make sure the issue is closed — `Fixes #N` closes it automatically when the commit lands on the default branch; otherwise `gh issue close <n>`.
9. Only after the fix is verified, committed, and pushed: call `delete_debug_report` with the report's id. If you could not resolve the report, leave it in place, append what you learned to its description with `save_debug_report`, and leave the issue open with a comment on where the investigation stands.

Never delete a report you did not fix, and never let a resolved report linger — the queue's value is that empty means nothing is known to be broken, and the repository's issues mirror that state.
