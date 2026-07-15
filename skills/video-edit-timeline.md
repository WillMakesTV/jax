The timeline is the producer's manual pass over a rendered video, in the Editor tab beneath the player. The video arrives pre-split into the segments the editing session recorded in `edit/cuts.json`, and the producer reshapes the cut by hand: split at the playhead, delete a segment, move one earlier or later, expand a segment into the footage on either side of it, then reprocess. This document is the contract that model and app both work to.

## The segment model

A segment is one kept span of the rendered video, in playback order:

- `start` / `end` — seconds in the rendered video. These are what the strip draws and what the export cuts.
- `source`, `sourceStart`, `sourceEnd` — where the span came from in the original footage. Present only for segments cut from a source video; a title card or generated overlay has no source and is not expandable.
- `padStart` / `padEnd` — seconds of extra original footage to restore *before* and *after* the segment. This is what the expansion controls set.

## Expanding a segment

A cut is often a frame or a word too tight: a reaction gets clipped, a sentence loses its last syllable, the joke lands after the cut. Expanding restores that context from the original source video rather than re-editing from scratch.

- Expansion only ever *adds* original footage on the outside of a segment. The rendered span between `start` and `end` is kept exactly as it was, so burned-in captions, title cards, colour grade, and audio treatment inside the segment survive untouched.
- The restored frames come straight from the source file, so they carry no overlays or grading. Expect a visible seam on long expansions — a second or two of context reads fine, twenty seconds looks like a different video. When a segment needs more than a few seconds back, ask the editing session for another pass instead.
- Expansion is bounded by the source video: a segment cannot be padded back past the start of its source or forward past its end.
- Expanding never moves the neighbouring segments' own source spans; two adjacent segments from the same source can be expanded into overlapping footage, and that overlap will simply play twice. Trim one of them if that isn't wanted.

## Reprocessing

Reprocess renders the current timeline back to `edit/final.mp4`:

- The render it replaces is archived first, so every previous version stays playable and restorable — reprocessing is never destructive.
- Kept spans are cut from the current render; padding is cut from the original source files and normalized to the render's resolution, frame rate, and audio layout before it is joined on.
- `edit/cuts.json` is rewritten from the reprocessed timeline, so the next pass — manual or AI — sees the video as it now is.

## When the editing session re-renders after a timeline edit

- Treat the producer's timeline as decided. Do not re-cut, re-order, or "improve" segments they kept; the manual pass is the approval.
- Re-render overlays, captions, and title cards against the *new* segment boundaries — a caption burned at the old timing will be wrong after a split or an expansion.
- Rewrite `edit/cuts.json` from what you actually rendered, and note the timeline pass in `project.md`.
