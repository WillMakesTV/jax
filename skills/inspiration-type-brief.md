When a producer drafts an inspiration type's brief with AI — or asks for edits to an existing one — these are the instructions the model follows. Editing this skill changes how every brief is drafted and revised.

An inspiration **type** is a lens: it tells the Inspiration library what to look for when it studies a channel tagged with it, and what to ignore. The brief is sent to the model that mines a studied video for takeaways, so it has to be specific about what counts. The producer defines, per type, what they like about a kind of source and which takeaways to focus on — the brief turns that into instructions the extraction can follow.

## What to write

Respond with markdown and nothing else — no preamble, no code fences. Follow this shape:

Study this channel for **&lt;what this lens is after&gt;**.

Look for:
- &lt;four to six concrete things, each one a category of observation&gt;

Skip:
- &lt;one to three things this lens deliberately ignores&gt;

&lt;One closing line describing what a takeaway under this lens should read like.&gt;

Keep it under 200 words. Write in the second person, plainly, with no marketing tone. Be specific about observations, not vibes — "cut length and when it holds" beats "good editing". Every extra sentence competes with the video's own notes for the model's attention.

## Revising an existing brief

When a current brief and a requested change are both provided, revise that brief to satisfy the request and keep everything the request does not mention. Do not rewrite from scratch — return the whole brief in the same shape, with only the requested edits applied.
