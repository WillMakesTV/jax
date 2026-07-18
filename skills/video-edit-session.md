These are the ground rules for the automated editing session that produces a plan's video. The session runs headless in the plan's workspace with the video-use skill, the downloaded source footage, and pre-cached transcripts. The producer's script for this pass arrives with the prompt; these rules govern how it is executed — the first cut, every later revision pass, and the re-render after a manual timeline edit.

## Source material

- Word-level transcripts for every source are pre-cached in `edit/transcripts/`. Never re-transcribe and never call ElevenLabs — treat the cached transcripts as authoritative. Their word timings are interpolated rather than measured, so pad every cut by at least 150ms and prefer cutting in silence.
- Read `project.md` first: it carries the plan and the notes from prior sessions.
- Read `edit/source-notes.md` next: the app's per-source overviews and timestamped outlines of what happened in each stream. Use them with the transcripts to locate the moments worth keeping.

## Producing the cut

- Title cards, end cards, and other overlay graphics are done with the video-use skill's HyperFrames engine (Node 22+). When the directions change an existing card or overlay, edit its composition and re-render it — don't rebuild unrelated parts of the video.
- Produce `edit/final.mp4` (and `edit/preview.mp4` for drafts).
- Run non-interactively: never ask questions, pick sensible defaults, and record every decision in `project.md`.

## Revision passes

- When `edit/final.mp4` already exists, treat the directions as a revision of that cut: keep the prior decisions recorded in `project.md` except where the new directions say otherwise.
- Change only what the directions ask for. A revision that quietly re-cuts untouched segments wastes the render and loses the producer's approved work.
- A previous session may have been cancelled mid-render: before building, delete stale intermediates (e.g. `edit/*_prenorm*`, partial clip extracts) rather than diagnosing them at length.

## The cuts manifest (required)

Every session must finish by writing `edit/cuts.json` — the map from the finished video back to the footage it came from. It is what lets the producer's timeline pre-split the video and pull extra context from either side of a segment.

```json
{
  "video": "final.mp4",
  "segments": [
    {
      "start": 0.0,
      "end": 12.5,
      "source": "EP04 - Boss Fight.mp4",
      "sourceStart": 4210.2,
      "sourceEnd": 4222.7,
      "label": "cold open — the boss finally dies"
    }
  ]
}
```

- `start`/`end` are seconds **in the finished video**, contiguous and in playback order, covering it end to end.
- `source` is the source video's file name in the workspace root, with `sourceStart`/`sourceEnd` the span it was taken from — this is what makes a segment expandable. Omit all three for material that has no single source (title cards, generated overlays, montages); the segment still needs `start`/`end`.
- `label` is a short human description of the beat. Keep it under ~60 characters.
- Write the manifest as soon as the cut is locked — before starting the long render, not after it. A session cancelled or killed mid-render then still leaves the segment map behind, and the timeline can pre-split the video the moment the render lands.
- If the render changes the cut in any way (a segment dropped, a duration trimmed), re-write the manifest afterwards so it describes the video that was actually rendered — never leave it describing a plan the render diverged from.

## Rendering discipline

- The producer watches this session's log live, and a silent multi-minute step reads as hung — they WILL cancel it. Never run a long step (render, loudnorm pass, batch extract) silently in the foreground: run it in the background (or tee its output to a file) and post a short progress note in text at least every minute or two until it completes.
- Every direct ffmpeg invocation must include `-nostdin` and `-y` so it can never sit waiting on console input or an overwrite confirmation.
- Never chain several PTS-shifted overlay inputs (`setpts=...+N/TB` on looped images) into one `filter_complex`: that graph deadlocks at zero CPU with an empty output file. Burn overlays in one pass per card, or go through the skill's `render.py`, which shifts overlays per segment.
- Babysit every render you start: if its output file has not grown for ~60 seconds and the process is using no CPU, it is deadlocked — kill it and rework the command instead of waiting on it.
