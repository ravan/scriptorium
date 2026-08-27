# What Lolly can make

The capability map: **a job on the left, the tool that does it on the right.** Read this to find out whether Lolly already covers a visual you were about to hand-draw. It almost always does.

`bun scripts/lolly.ts catalog [query]` prints the live list (68 tools today) with each tool's `_v` version — that command is authoritative, this page is the map. `describe <id>` gives the real inputs.

**Looking for a visual specifically?** `bun scripts/lolly.ts catalog --image` returns the 63 tools that can produce a picture — the same set the app's own *Choose Visual* picker offers. Add `--format=svg` to narrow to one output format. That set is derived from the live catalog, not hand-maintained, and `scripts/image-tools.json` pins it so `LOLLY_LIVE=1 bun test` fails loudly if a tool disappears or stops producing images.

Marks: **[exp]** = experimental. The watermark this implies is Lolly's raster `imprint`, so it lands on png/jpg/webp/tiff and on Lolly-rendered rasters inside pdf/pptx — **an `svg` export is clean** (verified on `diagram-builder`). Experimental tools are therefore fine for client-facing work as SVG, which is the format the wiki pipeline wants anyway; look at the render before trusting it. **[device]** = operates on a file on the user's machine, so it cannot be driven from a URL; hand the user the share link instead.

## Data and information graphics

| Job | Tool |
|---|---|
| Any statistical chart — 31 types: bar, bar-horizontal, line, area, scatter, pie, donut, radial-bar, radar, treemap, pack, heatmap, histogram, box, violin, beeswarm, lollipop, dumbbell, slope, bump, stream, waterfall, marimekko, parallel, polar, funnel, gauge, waffle, sunburst, icicle, chord, wordcloud | `d3` |
| Flow chart, org chart, timeline, mindmap, pyramid, gantt, matrix — from a `::` dsl, Mermaid, DOT, ASCII, pikchr or CSV | `diagram-builder` **[exp]** — SVG export is clean; see composing.md for the settings that actually work |
| Flow chart drawn on an open canvas with routed connectors | `org-chart` |
| Plans as columns, features as rows, one plan highlighted | `pricing-table` |
| A table turned into a deck of cards, one card per row | `battlecards` |
| A meeting time shown in every teammate's timezone | `meeting-planner` |
| A palette grown from one seed colour, with WCAG/APCA badges | `color-palette` |
| Contrast check of a pair or a whole palette, colour-blind sim | `contrast-check` |

## Codes, links and small utilities that produce a file

| Job | Tool |
|---|---|
| QR, Micro QR, Data Matrix, Aztec, PDF417; EAN-13, Code 128, ITF-14, GS1-128, GS1 DataBar, MaxiCode | `qr-code` |
| Read a code that already exists | `scan-code` **[exp] [device]** |
| Favicon, app-icon set, or the whole icon kit as a zip | `web-icon` |
| A calendar `.ics` file from event details | `calendar-ics` |
| An on-brand email signature (html/txt/vcf) | `email-signature` |
| A one-link landing page that lives inside its own URL | `jump` |
| A live countdown with a progress ring | `countdown-timer` |
| Format, decode, hash or de-identify text (JSON, JWT) | `text-helper` |

## Brand marks and lockups

| Job | Tool |
|---|---|
| The SUSE logo, right variant auto-picked, as vector | `tool-logo` |
| Official chameleon / wordmark / name lockups | `brand-lockup` |
| SUSE beside a partner logo, with a divider | `logo-lockup-partner` |
| A sponsor grid — the "NASCAR" wall | `logo-wall` |
| A word as a pure-path vector wordmark in the brand font | `wordmark` |
| The Geeko posed with sliders, print-ready still | `pose-geeko` |
| Any catalog asset (or any tool link) re-rendered to any format and size | `asset-export` |

## Cards, layouts and documents

| Job | Tool |
|---|---|
| Quote card for social or a slide | `quotes` |
| Branded social/OG card from a link | `link-card` |
| Colour blocks — text, image, logo — auto-arranged in a grid | `color-block` |
| A layout that recomposes around whatever you add, at any size | `dynamic-layout` |
| Free arrangement on an open canvas, including live tool renders | `design` |
| Markdown or a JSON spec → a native editable PowerPoint deck | `deck-studio` |
| A deck laid out by hand on a live canvas, or animated to mp4/gif | `deck-builder` |
| A multi-page document — rich text, tables, inserted renders | `doc-studio` |
| A multi-page PDF — cover, flowing content, back page | `multi-page-pdf` |
| Completion or award certificates, one or a CSV roster | `certificate` |
| Conference name badges with role colour and QR | `event-name-badge` |
| Business cards, letterhead, compliments slips at print trim | `stationery` |
| One artwork laid out n-up on A4/Letter/A3 with crop marks | `print-sheet` |
| Directional event signs, print-ready | `wayfinding-signage` |
| Foil, spot UV, emboss and soft-touch preview + printer spot plate | `finish-preview` |
| A code snippet as a clean syntax-highlighted image | `code-canvas` |
| A long prompt typeset as one compact image for a multimodal model | `prompt-to-image` |

## Backgrounds, textures and generative art

| Job | Tool |
|---|---|
| Gradients from brand swatches — radial, Coons mesh, warp, animated flow | `mesh-gradient` |
| Differential growth — a line that folds into coral, seeded from a logo or headline | `growth` |
| Live GPU scenes: fluid ink, particle swarm, feedback field | `synth` **[exp]** |
| Halftone, scanline, posterize, voronoi, dither, ASCII, duotone, glitch | `filter` |
| Full photo grading: film looks, .cube LUTs, PSD layers | `darkroom` |

## Screens, photos and 3D scenes

| Job | Tool |
|---|---|
| A screenshot framed, padded and shadowed on a brand backdrop | `screenshot-frame` |
| Arrows, boxes, numbered steps, callouts on your own screenshot | `annotate` **[device]** |
| Any live web page captured at any scroll depth, with custom CSS | `url-shot` |
| Capture your own screen, window or tab | `screencap` **[device]** |
| A flat photo given real depth and parallax | `spatial-photo` **[exp]** |
| A 3D camera flown through a screenshot, exported as video | `flythrough` **[exp]** |
| A 3D model lit, posed and rendered as a still or turntable | `3d` **[exp]** |
| A 3D event booth dressed with sponsor artwork | `booth-studio` **[exp]** |

## Motion, audio and video

| Job | Tool |
|---|---|
| Animated ads from layered scenes, any standard size | `digi-ad` |
| The same, carrying Lottie motion assets | `lottie-digi-ad` |
| A voice clip or song as a branded video that moves with the sound | `audiogram` |
| A clip recorded with your own top and tail cards | `record` |
| A clip auto-wrapped with branded bookends, lower-third, music bed | `top-tail-recorder` **[exp]** |
| Subtitles: transcribe on device or style an SRT/VTT, burn in or export sidecars | `captions` |
| A voice note with a live level meter | `voice-recorder` **[exp] [device]** |
| A handwritten signature on transparency, no scanner | `signature` **[device]** |

## File surgery — always on the user's own machine

These need the app because a device file cannot travel in a URL. Give the user the share link from `bun scripts/lolly.ts url <id>`.

| Job | Tool |
|---|---|
| Shrink a PDF by recompressing its images | `compress-pdf` **[device]** |
| Reveal and remove hidden metadata from images and PDFs | `strip-data` **[device]** |
| Black out sensitive content by rebuilding the file | `redact` **[device]** |
| HEIC/TIFF/any photo → WebP, JPEG or PNG | `convert-image` **[device]** |
| A font between TTF, OTF and WOFF | `font-convert` **[device]** |
| Stamp author, copyright and licence as Content Credentials | `embed-track-image` **[device]** |
| Run pasted HTML/CSS/JS or a JSX component in an offline sandbox | `run-web-code` |

## Reading this from another skill

A skill that produces a deliverable — a deck, a document, a page, a PDF — should route every visual through this map before drawing anything itself. The three questions, in order:

1. **Is there a tool for this shape?** Check the map, then `bun scripts/lolly.ts catalog <keyword>` for anything the map missed.
2. **Can one tool do the whole picture?** Chart plus frame plus backdrop is one chained call, not three assets you composite by hand. See composing.md.
3. **What are the real inputs?** `describe <id>`. Never write an input id from memory — unknown URL params fail silently and you get a default-looking asset with none of your settings applied.

Only when all three fail is a hand-drawn SVG the right answer, and say so out loud when you do it.
