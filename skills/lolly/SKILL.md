---
name: lolly
description: Use when a deliverable needs a generated visual or media asset - QR or barcodes, data charts, diagrams, quote cards, badges, certificates, gradient or generative backgrounds, photo treatments, icons, print PDFs, short video loops - or when the user mentions lolly, lolly.tools, lolly.art, or wants brand-true images for slides, documents, PDFs, markdown or web pages.
---

# Lolly

Lolly (https://lolly.tools) is a hosted, template-driven asset generator. Every tool is a URL: the same inputs give the same output, and brand rules (fonts, colours, layout) are enforced by the template, not by you. **Never substitute another generator** (qrencode, matplotlib, hand-drawn QR/chart SVG) for an asset a Lolly tool produces - a substitute is off-brand, carries no editable link, and cannot be reproduced from its inputs.

There is **no local install and no MCP**. Everything runs through `scripts/lolly.ts` (bun, zero npm dependencies) over two tiers:

1. **GET tier** - `https://lolly.art/tool/<id>.<ext>?<inputs>` serves bytes instantly for community tools in browser-free formats (svg/png for SVG-native tools, `emf`/`eps`/`eps-cmyk`/`dxf`, `html`/`md`/`txt`/`json`/`csv`/`ics`/`vcf`).
2. **Browser tier** - for everything else (script-drawn SVG like `d3` charts, brand-pack tools like `quotes` and `org-chart`, pdf, raster, pptx, video), the script launches **local headless Chrome**, opens the public web shell at `#/tool/<id>?...&format=<fmt>&export`, and captures the file the app's own export path downloads. Same bytes a human's Download button produces, ~8s, still one call. Chrome is found automatically (`LOLLY_CHROME` overrides); the wiki's PDF pipeline already requires it.

The share link is only a last resort when no Chrome exists on the machine. A 404 from `lolly.tools/tool/<id>.svg` never means "no API" - that GET route is off there by policy and live on `lolly.art`; the catalog JSON (tool index, manifests, assets) is public on both hosts.

## What Lolly can make

68 tools. Before hand-drawing any visual, check whether one of these already covers it - it usually does:

- **Charts** - `d3`, 31 types from bar and line to treemap, sunburst, waterfall, chord and wordcloud
- **Diagrams** - `org-chart` (flow charts, no watermark), `diagram-builder` (Mermaid/DOT/CSV, experimental)
- **Codes** - `qr-code`: QR, Micro QR, Data Matrix, Aztec, PDF417, plus every retail barcode
- **Brand marks** - `tool-logo`, `brand-lockup`, `logo-lockup-partner`, `logo-wall`, `wordmark`, `pose-geeko`
- **Cards and layouts** - `quotes`, `link-card`, `color-block`, `dynamic-layout`, `code-canvas`, `design`
- **Documents and decks** - `deck-studio` (Markdown → editable pptx), `doc-studio`, `multi-page-pdf`, `certificate`, `stationery`, `print-sheet`
- **Backgrounds** - `mesh-gradient`, `growth`, `filter`, `darkroom`, `synth`
- **Screens and photos** - `screenshot-frame`, `url-shot`, `annotate`, `spatial-photo`, `flythrough`
- **Motion and audio** - `digi-ad`, `audiogram`, `record`, `captions`
- **Tables and data objects** - `pricing-table`, `battlecards`, `color-palette`, `contrast-check`, `meeting-planner`, `calendar-ics`

**references/catalog.md is the full job → tool map**, with which tools are experimental (watermarked) and which need a file on the user's device. Any other skill that produces a deliverable should route its visuals through that map.

## Workflow

Run from this skill's folder. **Never guess input ids, asset ids or formats - describe first** (unknown URL params fail silently).

```bash
bun scripts/lolly.ts catalog [query]          # the whole surface, grouped, with _v versions
bun scripts/lolly.ts catalog --image          # only tools that make a picture (63 of them)
bun scripts/lolly.ts tools <query> [--image] [--format=svg]   # find a tool
bun scripts/lolly.ts describe <id>            # real inputs, defaults, formats + AUTHORED EXAMPLES
bun scripts/lolly.ts assets <query>           # catalog asset ids (logos, palettes)
bun scripts/lolly.ts render <id> k=v ... --format=svg -o out.svg   # one tool → a file
bun scripts/lolly.ts chain <id> k=v ... --then <id>:<slot> k=v ... -o out.png   # a pipeline → a file
bun scripts/lolly.ts url <id> k=v ...         # the editable link, no render
bun scripts/lolly.ts probe <file.svg>         # a render's coordinate space + its anchors
bun scripts/lolly.ts annotate <base.svg> --layer=<file|-> -o out.svg [--pad-right=N]
bun scripts/lolly.ts finish <in.gif> [--ground=<hex> -o out.gif] [--mp4=out.mp4]   # repair an animated export
```

**Annotating a render works the same for every tool**: `render --format=svg`, `probe` it to learn the coordinate space and the shapes worth aiming at, then `annotate` to lay your own group over an untouched base. That is how a generated chart or diagram gains the callout, badge or side note a template cannot know. See references/composing.md, "The hybrid, for any tool".

`describe` ends with the tool author's own **authored examples** - complete, known-good input sets. Start from the closest one and change the data; that is faster and looks better than assembling a look from single inputs.

**The output is a file path, not a URL.** Every render writes the asset plus a sidecar `<file>.lolly.json` holding the editable share link and the exact inputs. Pass the path around; read the sidecar when the user wants the link to tweak it. No long encoded URL ever needs to travel through a conversation or be retyped.

Exit codes: 0 ok, 1 render failed, 2 your usage error, 3 needs a human (no Chrome found). Catalog lookups are cached in `.cache/` for 24 hours (`--fresh` bypasses; stale cache serves offline). Rendered bytes are never cached.

Two input types have a non-obvious URL form, and `describe` flags both: a **vector** input has no single value - pass each field dotted (`imageFraming.zoom=140`); a **file** input takes a file on the user's device and can never travel in a URL at all.

## Daisy-chaining tools

**Composition is Lolly's own feature, not something this skill invents.** Any `asset` input accepts a portable embed URL, and the engine renders that child locally and substitutes the result. `chain` is the driver: you name the tools and their inputs, it builds Lolly's embed URLs correctly and executes the pipeline once.

```bash
bun scripts/lolly.ts chain \
  d3 ct=bar-horizontal d='Grain,Units
Dimension,20' cb=category pl=suse \
  --then screenshot-frame:image \
  --format=png -o framed.png
```

**A deck slide's visual is a block slot, not a plain input.** `deck-studio` and
`deck-builder` keep their slides in a `blocks` input - a JSON array of records -
and the visual slot lives inside one record. Name the record and the field:

```bash
bun scripts/lolly.ts chain \
  d3 ct=bar-horizontal d='Region,Units
EMEA,120' cb=category pl=suse \
  --then deck-studio:deck.0.visual size=wide \
  deck='[{"layout":"split","heading":"Units by region","body":"Americas leads"}]' \
  --format=pdf -o deck.pdf
```

`deck[0].visual` and `deck.0.visual` mean the same thing; **prefer the dotted
form**, because zsh and bash glob on `[0]` and an unquoted bracket slot dies as
"no matches found" before the script runs. The index is 0-based and must exist
in the records you passed; with no `deck=` at all it addresses the manifest's own
default slides. `describe` marks every chainable field with `<- chain here:`, and
warns you here when a record's layout does not show that field - a visual set on
the wrong layout is silently dropped by the tool, not reported.

**Which deck route actually paints the chart** (verified end to end 2026-08-27,
by rasterising the PDF and by unzipping the pptx and reading its slide rels):

| Route | Chained visual |
|---|---|
| `deck-studio` → `pdf` | **lands on the slide** - use this for a chart-bearing deck |
| `deck-studio` → `pptx` | **dropped.** Text, bullets and tables are fine and stay natively editable; the slide's only image is the logo |
| `deck-builder` → `pdf` | **dropped.** The slot boxes draw empty |

So: charts in a deck → PDF. Editable pptx → build the text deck with
`deck-studio`, then drop the chart into the slot yourself in the app (the share
link in the sidecar opens exactly that deck). Do not assume a pptx carries the
chart because the PDF of the same inputs did.

`--then <tool>:<asset-input>` feeds the previous step's render into that named input. The script builds and URL-encodes the nested embed links, checks the named input really exists and really is an `asset`, fits each step to the next tool's canvas so nothing gets zoom-cropped, and executes the whole pipeline once on the last tool. Verified working end to end, three steps deep (2026-08-27).

**Never hand-write an embed URL.** Encoding a nested query by hand is the one way to make this fail, and the failure is silent - the child renders with its defaults instead of your inputs, and the chain looks "broken".

Chain steps by need: make (`d3`, `qr-code`, `mesh-gradient`, `growth`) → treat (`filter`, `darkroom`) → place in a scene (`screenshot-frame`, `booth-studio`, `print-sheet`, `link-card`, `quotes` bgImage) → animate/export video (`flythrough`, `top-tail-recorder`, `audiogram`). Which tools take asset inputs is in references/composing.md, and `chain` names them for you when you get the slot wrong. Chains with script-drawn or brand-pack children go to the browser tier automatically. `annotate` takes a device file, not a URL - put callouts in the parent tool's own text inputs instead.

## Verified tool limits

Found by hitting them, not by reading docs. Each one costs an hour to rediscover.

**Animated exports ignore `background` and land on transparency.** `d3` and
`mesh-gradient` honour the input at `--format=svg` and drop it for `gif`, `mp4`
and `webm`, so the render arrives on black wherever you put it. Their `mp4` is
also AV1, which PowerPoint and QuickTime will not open. Both are fixed after the
render, in one command:

```bash
bun scripts/lolly.ts finish scores.gif --ground=0c322c -o scores.pine.gif --mp4=scores.mp4
```

It coalesces the frames before recolouring (a GIF frame is a delta on the one
before it), encodes H.264 with `yuv420p`, and copies the `.lolly.json` sidecar
onto everything it makes. Say in your summary that you post-processed, and why.

**`org-chart` only draws `card` and `text` from a URL.** Its `path` and `box`
primitives render nothing, and `bindStart`/`bindEnd` with `route=elbow` draws
nothing either, whatever geometry you give them. Connectors have to be thin
rotated `card` shapes (`shape=pill`, `h=8..10`, `rot=<angle>`), which do render.
The `{w200|...}` weight markup only works on the `row`, `stacked` and `icon`
layouts, and all three add an avatar circle; `layout=plain` is clean but renders
the markup literally, so split a title and its detail into two boxes instead.

**`chain` children have a hard 4096-character cap.** The whole pipeline is one
URL, so a large `blocks` payload as a child fails server-side with
`{"error":"Query too long (max 4096 characters)."}`. A ten-card `org-chart` is
already too big to be chained. Render it on its own and place it as a file.

**Not every `asset` input accepts a chained child.** Verified working:
`quotes:bgImage`, `screenshot-frame:image`. Verified failing: `filter:image`,
which renders a "Could not read this image" placeholder instead of the child, at
full size and with no error. Look at the output rather than trusting the exit
code, because that failure is silent.

## Hard rules

1. **Describe before render** - input ids come from the manifest, never from memory.
2. **Set the presentation inputs, then look at the result.** A tool called with only its data renders correct but ugly - flat colour, no title, wrong aspect ratio. Every tool has heading, palette, size and layout inputs; `describe` lists them. Read the rendered file back as an image before you ship it. The recipe for `d3` is in references/composing.md.
3. **Always deliver the editable share link with any file** so the user can tweak and re-export.
4. **No secrets or personal data in render URLs** - a GET query lands in server access logs; share-link inputs are public by construction.
5. **Pin `_v=<tool version>`** (`catalog` prints it) in any URL embedded in a document.
6. **The `[experimental]` watermark is a RASTER imprint, not a blanket ban.** Lolly's `imprint` marks raster exports (png/jpg/webp/avif/tiff) and Lolly-rendered rasters embedded in pdf/pptx. A **vector `svg` export carries no visible mark** - verified on `diagram-builder`, whose SVG is clean apart from a "Made with lolly.tools" string in `<desc>` metadata. So an experimental tool is usable for client-facing work *as SVG*; check the render yourself before trusting it, and pass `imprint=off` where you need a raster unmarked. Browser-tier renders default `c2pa=off` for byte determinism; pass `c2pa=30` to re-opt in.
7. Byte-stable: `svg`, `emf`, `eps`, `dxf`, data formats, SVG-native `png`. Not: `ics`, `pdf`, browser-tier rasters, video. Never hash-gate the unstable ones.

## Tests

```bash
bun test                      # 154 tests, under a second, fully offline
LOLLY_LIVE=1 bun test         # + 80 live contract tests against the real catalog
```

`scripts/lolly-core.ts` holds the rules (arg parsing, input validation, URL encoding, chain assembly, canvas fitting, filtering, output formatting) as pure functions; `scripts/lolly.ts` is the I/O shell around them. `scripts/lolly.test.ts` covers the core directly and drives the CLI against a **local fake catalog server**, so the default suite never touches lolly.tools and a failure always means our code broke.

`scripts/lolly.live.test.ts` answers the other question - *has the catalog moved under us?* It is skipped unless `LOLLY_LIVE=1`, and it gives **every image tool its own test**, so a failure names the tool. It also checks the chain slots and the `d3` inputs our documented recipes depend on. Run it after a Lolly release, or when a tool id stops working.

**No test may launch Chrome.** `LOLLY_NO_BROWSER=1` blocks the browser tier outright - the suite sets it, and the browser-tier cases assert the refusal path instead. Setting `LOLLY_CHROME` to a bad path is not enough: it only prepends a candidate, so the search still finds the real Chrome. Use `LOLLY_NO_BROWSER=1` in CI and sandboxes too.

Run the tests after any change to either script. If you add a rule, put it in the core and test it there.

## Composing into slides, docs, PDF, markdown

See references/composing.md for the routing table (need → tool), asset-input chaining table, reserved output params, and per-target embed recipes. Short version: `render` SVG (either tier) and reference the file for slides/docs; hot-link the `lolly.art` raw URL as `<img>` only for markdown that stays online; print PDF and video render fine via the browser tier.

## Common mistakes

| Mistake | Fix |
|---|---|
| "lolly.tools returned 404/SPA shell, so there's no API" | Catalog JSON is public on both hosts; bytes come from `lolly.art` or the browser tier. Use the script. |
| Falling back to qrencode/matplotlib/hand-drawn SVG | `render` handles every tool and format via local Chrome. Substituting is never needed. |
| Guessing `color=green` or an input id | `describe` first; colours are hex (`0c322c`, `#` optional). |
| Hand-compositing two renders in an image editor | `chain` them - one execution. |
| Hand-writing a nested embed URL | Use `chain`. Hand-encoding fails silently: the child renders with its defaults. |
| `"deck" is a <blocks> list` when chaining a chart onto a slide | Name the record and field: `deck-studio:deck.0.visual`. |
| `no matches found: deck-studio:deck[0].visual` | That is your shell globbing. Use the dotted form `deck.0.visual`. |
| Shipping the default render | Set the presentation inputs, start from an authored example, then look at the file. |
| An animated gif or mp4 comes out on a black ground | The animated export path ignores `background`. Fix it with `finish --ground=<hex>`. |
| The mp4 will not play in PowerPoint or QuickTime | The native export is AV1. `finish --mp4=<file>` re-encodes it as H.264. |
| `Query too long (max 4096 characters)` from a chain | A `blocks` payload is too big to be a chain child. Render that step on its own. |
| A chained child renders as "Could not read this image" | That parent's asset input does not take a child. `quotes:bgImage` and `screenshot-frame:image` do. |
| `org-chart` connectors draw nothing | Its `path` and `box` primitives do not render from a URL. Use a thin rotated `card` with `shape=pill`. |
| Passing a long render URL around instead of the file | The path is the handoff; the link is in `<file>.lolly.json`. |
| `"imageFraming" is not an input` | It is a `vector` - pass its fields dotted: `imageFraming.zoom=140`. |
| Embedding an unpinned hot-link URL in a doc | Add `_v=` (from `catalog`) so output can't drift. |
