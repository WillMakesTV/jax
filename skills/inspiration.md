The Inspiration library is the producer's reference shelf: YouTube channels and videos worth studying, indexed locally. A video that has been "studied" carries a full set of notes — an AI summary, a timestamped outline and beats, the links and products/services/tools it names, the takeaways lifted out of it, and a local transcript of everything said.

## The pipeline

Adding a video downloads it under the Videos workspace and runs it through: `downloading` → `transcribing` → `analyzing` (the manifest: summary, outline, beats, links, mentions) → `extracting` (the takeaways) → `ready`. A channel can be indexed on its own, in which case its recent videos are listed as `tracked` — known, but not downloaded and not studied. Only `ready` videos have notes worth reading.

The pipeline is driven from the app (Inspiration → Add, or a tracked video's Download button); it is not exposed over MCP because it downloads gigabytes and runs the machine's AI runner.

## Reading the library

- `list_inspiration_channels` — the tracked channels, with the branding and metrics the indexer pulled in: avatar and banner, subscriber and video counts, the channel's own description, its tags, and the links it publishes. Every video indexed from a channel refreshes this.
- `list_inspiration_videos` — what is indexed, with each video's status and how much has been derived from it. Bodies are omitted; the counts tell you what is worth fetching.
- `get_inspiration_video` — one video in full: description, summary, outline, beats, takeaways, links, mentions. Pass `includeTranscript: true` only when you actually need the words — transcripts run to thousands of lines.
- `get_inspiration_transcript` — just the timestamped transcript.

## Searching it

`search_inspiration` is the way in when you do not already know which video holds the answer. It ranks every passage in the library — summaries, outlines, beats, takeaways, mentions, links, descriptions, and transcript windows — against a query and returns the best ones, each with the video, the moment inside it, and a `citation` string carrying a URL that opens at that timestamp.

- Search first, fetch second: find the passages, then `get_inspiration_video` for the one or two videos worth reading in full.
- Narrow with `kinds` when the question has a shape: `["takeaway"]` for advice, `["mention", "link"]` for gear and tools, `["transcript"]` for what was actually said.
- **Always cite.** When an answer draws on the library, quote the `citation` from the hits it came from. An uncited claim is indistinguishable from a guess, and the point of studying these videos is being able to point at them.
- Nothing back means nothing studied covers it — say so rather than answering from general knowledge and implying it came from the shelf.

## What it is for

The library is reference material for the producer's own work: how other creators structure an episode, hook an audience, package a topic, or use a tool. Draw on it when planning streams and videos, drafting descriptions, or answering "how do others do this?" — and keep the distinction clear between what a studied video says and what you are adding.
