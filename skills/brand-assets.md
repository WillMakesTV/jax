Brand assets are the uploaded files that define the creator's visual identity — logos, banners, overlays, color palettes, fonts, and character/mascot art. They are managed on the Profile page (user menu → Profile → Brand Assets), stored locally on this computer, and shared app-wide so any feature that produces visuals can draw on them.

## Conventions that make assets usable

- Name files for what they are: `logo-primary.png`, `logo-mark-white.png`, `banner-twitch.png`, `palette.png`, `title-font.ttf`, `mascot-robot.png`.
- Write a description for **every** asset — it is the only context AI features get about when and how to use it. Good descriptions say what the asset is *and* how to apply it:
  - "Primary logo — place small in a lower corner, never stretched."
  - "Brand palette: purple #7C3AED on near-black #0F0F14, accent lime #B4FF39."
  - "Mascot robot — the recurring character; keep its proportions and colors exact."
- Keep one canonical version of each asset rather than many near-duplicates; delete what is no longer on-brand.

## How the assets are used

- **Thumbnail generation** (Plan Stream form) attaches the brand's image assets as references and includes every asset's name and description in the brief, alongside the "Stream thumbnails" skill. Logos get placed, palettes get matched, mascots stay consistent — driven by the descriptions above.
- **Over MCP**, `list_brand_assets` returns each asset's name, description, size, and date. The files themselves are not readable over MCP; use the names/descriptions to reason about the brand, and point the user at Profile → Brand Assets for uploads or replacements.

When advising on brand consistency (thumbnails, overlays, video plans), start from `list_brand_assets` and the descriptions found there rather than guessing the brand's look.

## Brand links

Alongside the files, the brand's outward links (social profiles, website, store) live on the Profile page's Links tab and are readable over MCP via `list_brand_links`. Every AI feature that drafts audience-facing copy — stream and video plan descriptions, edit-session directions — receives them automatically. The rule everywhere: when copy mentions the brand's socials or site, use those URLs verbatim and never invent links.
