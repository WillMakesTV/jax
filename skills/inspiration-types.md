An **inspiration type** is a lens. The Inspiration library studies other creators' channels, and a type says what a given channel is being studied *for* — process advice, the way its videos are cut, how it packages a topic. A channel can carry several.

Two ship by default: **Tips** (how the work gets done — steps, rules of thumb, tools in service of a result) and **Editing Style** (how the video is made — pacing, sound, grade, graphics, structure).

## What a type actually does

Tagging a channel with a type appends that type's brief to the takeaway extraction for its videos. The pass still follows the "Inspiration takeaways" skill (or the channel's own override); the type steers what it weighs and what it leaves out. Untagged channels are studied generically.

Every type publishes its brief as an application skill — `inspiration-type-<id>`, listed in Settings → Skills and readable with `get_skill`. Editing the type's page and editing its skill are the same document.

## Writing a new type

Inspiration → **Types** → Add a type. Name it, then write the brief (or draft it with AI and edit). A good brief is specific about observations, not vibes:

- **Study this channel for …** — one line naming the lens.
- **Look for:** four to six concrete categories of observation. "Cut length and when it holds" beats "good editing".
- **Skip:** what this lens deliberately ignores, so the pass does not dilute itself.
- A closing line describing what a takeaway under this lens should read like — an instruction to follow, a production decision to reproduce, a framing to borrow.

Keep it under about 200 words. It is prompt text: every extra sentence competes with the video's own notes for the model's attention.

## Working with types over MCP

`list_inspiration_channels` reports each channel's `typeIds`, and the type briefs are readable as skills. When you are asked what the library says about a topic, the type a channel carries tells you what its takeaways were collected for — a takeaway from an Editing Style channel is a production note, not advice about the subject.
