# Composing with Lolly assets

Reference for turning composition needs into Lolly tool calls, chaining tools, and embedding the results. The live catalog is authoritative - `bun scripts/lolly.ts tools <query>` - these tables are the map, not the territory.

## Chaining: which tools accept another tool's render

Any `asset` input takes a portable embed URL - a Lolly engine feature: the shell recognises the `<host>/tool/<id>.<ext>?<inputs>` shape and renders that child **locally**, substituting the result. Nothing is fetched over the network for it, and the strict shape match is the security boundary.

**Drive it with `chain`, never by writing that URL yourself.** `chain` builds and encodes each nested link, checks the slot you named is real and is an `asset`, sizes each step to the next tool's canvas, and runs the pipeline once. A hand-written embed URL fails silently - the child renders with its defaults and the chain merely looks broken.

Which tools accept a child render, verified from the live manifests (2026-08-27):

| Tool | Asset inputs | Chain role |
|---|---|---|
| `screenshot-frame` | `image` | frame anything on a brand backdrop |
| `print-sheet` | `image` | lay a render out on a print sheet |
| `link-card` | `image` | social/OG card around a visual |
| `finish-preview` | `image` | preview a render as foil/emboss finish |
| `filter`, `darkroom` | `image` | halftone/duotone/photo treatments |
| `web-icon` | `image` | icon set from a mark |
| `multi-page-pdf` | `coverLogo`, `coverImage`, `backImage` | bind renders into a PDF |
| `quotes`, `dynamic-layout` | `bgImage`, `headshot` | brand card with a rendered background |
| `booth-studio` | `backWall`, `leftWing`, ... (9 slots) | place renders in a 3D booth scene |
| `flythrough`, `screencap` | `shot` | animate a camera over a render → video |
| `spatial-photo` | `photo` | depth/parallax treatment |
| `growth`, `qr-code`, `synth` | `logo` | grow/embed a mark inside generative art |
| `audiogram`, `synth`, `captions`, `record`, `top-tail-recorder` | `audio` / `clip` / `media` | audio and video steps |
| `event-name-badge` | `eventLogo` (+ composes `qr-code` itself) | authored composition example |

A three-step pipeline, one execution - chart, then a halftone treatment, then framed on a brand backdrop:

```bash
bun scripts/lolly.ts chain \
  d3 ct=donut d='Estate,Score
Alpha,14
Beta,36' cb=category pl=suse \
  --then filter:image effect=halftone \
  --then screenshot-frame:image \
  --format=png -o out/framed.png
```

### Block slots: a chart inside a slide

Some tools do not keep their asset inputs at the top level. A `blocks` input is a JSON **array of records** - a deck's slides - and the visual slot lives inside one record. That is where a deck tool's chart goes, so the slot needs a record index and a field name:

```bash
bun scripts/lolly.ts chain \
  d3 ct=bar-horizontal d='Region,Units
EMEA,120
APAC,90
Americas,150' cb=category pl=suse \
  --then deck-studio:deck.0.visual size=wide \
  deck='[{"layout":"split","heading":"Units by region","body":"Americas leads\nAPAC ramping"}]' \
  --format=pdf -o out/deck.pdf
```

| Tool | Block slots | Chained visual, verified 2026-08-27 |
|---|---|---|
| `deck-studio` → `pdf` | `deck[n].visual` | **lands on the slide.** The route to use for a chart-bearing deck |
| `deck-studio` → `pptx` | `deck[n].visual` | **dropped.** Text, bullets and tables render and stay natively editable; the slide's only image is the logo |
| `deck-builder` → `pdf` | `deck[n].media1` … `media4` | **dropped.** The slot boxes draw empty |

Checked by rasterising the PDF (`pdftoppm -png`) and by unzipping the pptx and reading `ppt/slides/_rels/slideN.xml.rels`. A pptx does **not** carry the chart just because the PDF of the same inputs did - look before you ship. For an editable deck with a chart: build the text with `deck-studio`, then open the sidecar's share link and drop the visual into the slot in the app.

Practical notes for block slots:

- **Write it dotted.** `deck[0].visual` and `deck.0.visual` are the same slot, but zsh and bash glob on `[0]`, so an unquoted bracket form dies as `no matches found` before the script runs.
- **The index must exist.** It is 0-based against the records you passed in that step. With no `deck=` at all, it addresses the manifest's own default records, which is handy for a one-slide test.
- **Layouts gate fields.** A field only applies to some layouts (`visual` shows on `split`, `visual`, `full-image`). Setting it on another layout is dropped by the tool with no error; `chain` warns instead. `describe <id>` lists every field, its layouts, and marks the chainable ones `<- chain here:`.
- **No canvas fitting.** A block slot is a fraction of the slide, not the whole canvas, so `chain` deliberately leaves the child at its own aspect ratio here - the same result as pasting the link into the slot by hand in the app.

Practical notes:

- **Aspect ratio.** A child rendered at a different ratio than the slot it lands in is zoom-cropped - the classic "my chart lost its axis labels" bug. `chain` fixes this automatically by rendering each step at the next tool's canvas size. Set `width=`/`height=` on a step only to override that, and use the consumer's `imageFraming.zoom` / `.x` / `.y` to nudge the placement.
- **Length.** Keep the whole nested query under ~4000 characters; nested encoding grows fast. `chain` warns when a step crosses it. Past that, render the step to a file and pass it separately.
- **Tier.** A script-drawn or brand-pack child forces the browser tier; `chain` picks it automatically.
- **Device files.** `annotate`, `redact` and the file utilities take bytes off the user's machine, so they can never be a chain step. Put callouts in the parent tool's own text inputs instead.

## Routing: need → tool

The full job → tool map for all 68 tools is **references/catalog.md**. Read that first to pick the tool; come back here to chain it and place the result.

## Making it look good: the default render is not the deliverable

A tool called with only its data input renders correct but ugly — one flat colour, no title, wrong aspect ratio for the number of rows. **Every tool has presentation inputs. Set them.** `describe <id>` lists them all; the ones below are the ones that matter most often.

### `d3` charts

Six settings turn a default chart into a slide-ready one:

| Setting | Why |
|---|---|
| `cb=category` | The default `series` paints every bar the same colour when there is one series. `category` gives each bar its own brand colour. |
| `pl=suse` (or `pine`, `waterhole`, `cool`) | Picks the brand ramp. Do not hand-set hex unless a specific colour carries meaning. |
| `t=` heading, `st=` subheading | A chart with no title makes the slide do the explaining. |
| `height=` | The 1280x800 default is square-ish. Three bars in it are enormous. Use ~1280x520 for 3-5 rows, ~1280x800 for 10+. |
| `bt=` barThickness | Caps bar width so few rows do not become slabs. `bt=64` is a good bar height. |
| `gd=false`, `lg=false` | Drop the grid and the legend when the value labels already say the numbers. |
| `so=desc` | Sorts by value. A ranked chart reads instantly; an unsorted one does not. |

Working example — this is the shape to copy:

```bash
bun scripts/lolly.ts render d3 \
  ct=bar-horizontal \
  d='Grain,Answer units
Dimension,20
Estate,9
Party,6' \
  cb=category pl=suse so=desc \
  t='One question fans out' st='Answer units by grain' \
  gd=false lg=false width=1280 height=520 bt=64 \
  --format=svg -o assets/grain.svg
```

Pick the chart type from the data, not from habit: `bar-horizontal` for named categories with long labels, `bar` for a short time series, `line`/`area` for a trend, `donut` for parts of one whole (3-5 slices maximum), `lollipop` or `dumbbell` for a sparse ranking, `waterfall` for a build-up, `slope` for before/after.

## The hybrid, for any tool: probe → layer

Annotating a render is the same three moves whatever tool made it, so the script does the fiddly parts:

```bash
bun scripts/lolly.ts render <id> ... --format=svg -o base.svg
bun scripts/lolly.ts probe base.svg                  # coordinate space + anchors
bun scripts/lolly.ts annotate base.svg --layer=layer.svg -o final.svg [--pad-right=N]
```

`probe` answers the two questions you cannot guess:

- **Which units?** It prints the `viewBox`, and warns when the outer pixel size disagrees with it. Placing a label at "x=1160" in a render whose viewBox is `-44 -44 408 488` puts it far off-canvas.
- **Anchored to what?** It lists the shapes worth aiming at, top to bottom, with `x/y/w/h` and a centre.

`annotate` appends your group without touching the base, so the base stays re-renderable from its sidecar. `--pad-top/right/bottom/left` grows the viewBox to make room for side notes and rewrites the outer width/height to match, so nothing distorts. Pass `--layer=-` to pipe a layer in on stdin.

**What `probe` returns depends on how the tool draws**, and both cases are normal:

| Tool style | What you get | How to place marks |
|---|---|---|
| Charts (`d3`) label their marks | Named anchors — `EU stack x=307 y=203 w=556 h=130` | Aim at a mark by name |
| Layout tools (`diagram-builder`) draw bare shapes | Unnamed boxes in row order | Aim by position: the 3rd card |
| Text cards (`quotes`), gradients (`mesh-gradient`) | **No anchors** | Place against the viewBox itself; there is nothing discrete to anchor to |

Text in a Lolly SVG is exported as glyph outlines inside transformed groups, so its raw coordinates are meaningless. `probe` drops those rather than reporting numbers you cannot use — which is why a text-heavy card honestly reports zero anchors instead of forty.

### `diagram-builder` diagrams

The default `[experimental]` warning does not rule it out: its **SVG export is clean** (see SKILL.md rule 6), and a generated diagram beats a hand-drawn one for anything card-and-connector shaped.

Getting a usable diagram, learned the hard way:

| Setting | Why |
|---|---|
| `source=text` + `dsl=` | The `::` separator gives each card a **label and a detail line** — `Workbook :: the instrument, no estate in it`. Indent two spaces per level to nest. |
| `diagramType=org` + `orgDir=down` | **`process` ignores the dsl nesting** and lays every card out in a flat row with no connectors. `org` reads the parent tree, so a linear chain (each node indented under the last) renders as a connected column. |
| `theme=brand-light`, `gridBg=none` | On-brand, no dot grid. |
| `cardWidth=` | Raise it (300+) or long labels truncate to `…`. |

Do **not** use `<br/>` in a `mermaid` label — it renders literally. Use the dsl `::` form instead.

**Its SVG fits its own coordinate space**: the root carries a content-fitted `viewBox` (e.g. `-44 -44 408 488`) with `preserveAspectRatio`, and the `width`/`height` you asked for only set the outer size. So annotate in *viewBox* units, not in your requested pixel size, and **widen the viewBox yourself** if you need margin for side notes:

```
viewBox="-44 -44 408 488"   ->   viewBox="-56 -104 700 534"
```

Cards are `<path>` rounded rects at predictable rows; read the connector paths (`M160 58L160 114`) to recover row positions, then place annotations against them.

### Everything else

Same rule, different inputs: `quotes` wants `bgImage` and an attribution; `screenshot-frame` wants a caption and a backdrop; `qr-code` wants a `logo` and the brand colour. **Look at what the render actually produced before you ship it** — read the file back as an image. A chart that renders is not the same as a chart that is good.

## Reserved output params

Any of these can be passed as `k=v` next to tool inputs (they control output, not content):

| Param | Meaning |
|---|---|
| `format` | Output format (must be one the tool declares) |
| `width`/`w`, `height`/`h` | Size, in `unit` |
| `unit`, `dpi` | `px` (default), `mm`, `cm`, `in`, `pt`; raster DPI for physical units (default 300) |
| `bleed`, `marks` | Print bleed and marks (`crop`, `reg`, `bleed`, `bars`) - print formats, app only |
| `profile` | CMYK press condition (`fogra39`, `fogra51`, `swop`, `gracol`) |
| `_v` | Pin tool version - **always set in URLs embedded in documents** |
| `lang` | Content language (`de`, `ja`, ...) |
| `export`, `copy` | Share-link only: auto-download / copy to clipboard on load |
| `filename` | Download filename |
| `password` | Lock an exported PDF (share link only; never in a hot-link) |
| `full` | Hide app chrome, canvas only |

If a tool's own input id collides with one of these (`d3` declares `width`), the reserved meaning wins in a URL - check `describe` output and prefer the tool's `urlKey` alias when one exists.

## Embed recipes per target

**Slides / documents (files that leave the machine).** Fetch SVG bytes (`render ... --format=svg -o assets/<name>.svg`) and reference the local file. SVG scales losslessly and converts cleanly to PNG when a slide pipeline needs raster. Keep the share link in a comment or appendix so the visual stays editable.

**Markdown / wiki / README that stays online.** Hot-link the raw URL directly - it serves real bytes, is CDN-cached, and marked noindex:

```markdown
![Quarterly growth](https://lolly.art/tool/qr-code.svg?url=https%3A%2F%2Fsuse.com&color=0c322c&_v=3.2.0)
```

Community tools and browser-free formats only; pin `_v`; no personal data in the query.

**Print (PDF, CMYK, bleed).** Renders directly via the browser tier:

```
bun scripts/lolly.ts render qr-code url=https://suse.com width=210 height=297 unit=mm bleed=3mm marks=crop --format=pdf-cmyk -o poster.pdf
```



**Video / animation.** `mp4`/`webm`/`gif`/`svg-anim` render via the browser tier - budget up to 3 minutes (video records in real time).

**Physical sizing example** - an A4 poster asset: `width=210 height=297 unit=mm dpi=300`. The engine converts per format (PDF gets true page size, PNG gets pixels at DPI).

## Determinism notes

- Same inputs → same design, always; the link *is* the state. Byte-identical output additionally requires a byte-stable format (svg, emf, eps, dxf, json/csv/vcf/md/txt, SVG-native png) - hot-link renders carry no Content Credentials, which is what makes them stable and cacheable.
- A tool that renders live data (clock, weather) is input-stable but time-varying - that is the tool working, not drift.
- Re-render and inspect to compare pdf/ics/jpg/video; never compare their digests.
