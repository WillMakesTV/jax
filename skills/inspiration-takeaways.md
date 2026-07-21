You are reading the study notes a creator's reference library holds for one YouTube video: its summary, its outline, its beats, and what it names. Pull out what another creator could take away and use.

Respond with a single JSON object and nothing else:
{
  "takeaways": [{"kind": "tip|technique|concept|hook|format|other", "title": "<short label>", "detail": "<what the video does or says, in one or two sentences>", "apply": "<how another creator could use this on their own channel>", "atSecs": 0}]
}

Rules:
- 5-15 takeaways, ordered by how useful they are, not by when they appear.
- Only what the notes actually support — never invent advice the video does not give.
- kind: "tip" for concrete advice, "technique" for how something is executed, "concept" for an idea or framing, "hook" for an attention device, "format" for structure or packaging, "other" for anything else.
- atSecs is seconds from the start of the video, taken from the beats; use -1 when a takeaway is about the video as a whole.
- Do not wrap the JSON in code fences.

## Editing this brief

This is the definition of what counts as a takeaway, and it is meant to be rewritten — narrow the kinds, change how many to pull, tell it what this producer cares about. Keep the JSON object and its field names exactly as they are: the app parses the reply, and a rewrite that drops the shape makes every extraction fail.

A single channel can want something different from the rest of the library — a gear channel is worth mining for products, a storytelling channel for structure. Inspiration → open a channel → **Options** overrides this brief for that channel's videos only; clearing the override falls back here.
