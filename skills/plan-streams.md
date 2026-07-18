Stream plans are the blueprint for an upcoming broadcast: a title, a markdown description (talking points, segments, links), target channels, optional tags, and an optional series/episode assignment. Plans live on the Broadcasting page, where they surface with their go-live actions until they are concluded.

## Creating and editing plans

- `list_planned_streams` returns every open plan with its id, title, description, channels, series/episode, and tags.
- `save_planned_stream` creates a plan (omit `id`) or updates one (pass the existing `id`). Only the fields you send change.
- `delete_planned_stream` removes a plan by id. Confirm with the user first — plans can hold significant prep writing.

In the app, plans are created from **Broadcasting → Plan a stream**, which offers AI helpers: a whole-plan generate button (drafts title, description, and tags from the series context and previous episodes' outlines) and selection-scoped "request edits" on the description. The brand's links (Profile → Links; `list_brand_links` over MCP) always ride along in those prompts — drafted descriptions close with a short follow/links line, and any social or site reference must use those URLs verbatim, never invented ones. Follow the same rule when writing or editing descriptions over MCP, and consult the brand's written guidelines first (`get_brand_guidelines`; Profile → Brand Assets) — they outrank generic style choices.

## Writing a good plan

- Title: what the audience sees on the target channels when the plan is applied — write it like a broadcast title, not a filename.
- Description: markdown; structure it as run-of-show segments with rough timings, and link any assets or docs referenced during the show.
- Tags feed the platforms' discovery when the plan is pushed.
- Thumbnail: generate one from the title and description (OpenAI connection — ChatGPT account or API key), or upload a hand-made image. The "Stream thumbnails" skill is the creative brief and the brand's assets (see the "Brand assets" skill) ride along as references. Generated images save onto the plan immediately, and every replaced thumbnail is kept in the plan's history (`thumbnailHistory`) for one-click restore in the editor. Over MCP: `generate_plan_thumbnail` (fresh, or revise with feedback) and `set_plan_thumbnail` (from a local image file, or empty path to clear); restoring an old version = `save_planned_stream` with a `thumbnailFile` from the history.
- Reset vs conclude: after a broadcast, concluding (app button) attaches the plan to the past stream and removes it. A false start instead gets `reset_planned_stream` (or the plan form's "Reset broadcast" button): the sessions and go-live assignments are forgotten and the plan stays for a future stream.

## Series and episodes

If the stream belongs to a recurring show, set the series and episode on the plan:

- `list_content_series` shows available series and their types.
- `get_episode_numbers` returns the numbers a series has used and the next free one — use it instead of guessing.

Series context is what powers episode-info smart sources and AI plan generation, so assigning it early pays off.

## What happens on stream day

Applying a plan (pushing its title/category/tags to the platforms and going live) is done from the plan's **Broadcast** page in the app and is deliberately not exposed over MCP. See the "Going live" skill.
