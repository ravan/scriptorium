# Compose mode

Goal: recompose wiki knowledge into a new artifact - blog post, LinkedIn post, slide deck (.pptx), document (.docx), or SVG image - in the user's voice, at their quality bar, in their brand style.

## Load order (before writing a word)

1. **The voice: an idiolect profile.** Read `voice_profile:` from the wiki's `CLAUDE.md` and load the bundled `idiolect` skill's `references/apply.md` (at `.claude/skills/idiolect/`). Apply the profile exactly as that file says: core `profiles/<name>/voice.md`, then the `registers/` overlay for this format (table below), then `quality.md`, then `ban-list.md`, then 1-3 matched exemplars if the profile links any. Idiolect's self-check order (substance, bans, register, mechanics, rhythm, attribution) is the final gate on every draft.
2. For slides, docs, or images: the brand skill named in the wiki's `CLAUDE.md` (`brand_skill:`). If `none`, use the neutral defaults built into the compose scripts. Lolly renders carry the brand already; your own SVG and your edits to a render must match it.
3. If `voice_profile:` is `none` or the profile is missing, offer to build one with idiolect (references/profile.md) or proceed with a plain, neutral style after saying so. A legacy `profile/voice.md` (pre-idiolect wiki) still governs until the user migrates - see references/profile.md.

### Which register for which output

Register names are folders the profile actually has - `ls profiles/<name>/registers/`. Match by this table, not by guess:

| Wiki output | Register overlay |
|---|---|
| Blog post | `blog` |
| LinkedIn post | `linkedin` |
| Document from a `templates/docs/` template | the template's name (`whitepaper`, `pov`, `amazon-6pager`, ...) if that register exists; else `whitepaper`; else core |
| Slide speaker `notes` | `talk` (it is spoken language, not prose) |
| On-slide text (titles, bullets, captions) | core voice only - too short for a register to bite; the slide rules below govern shape |
| Email or anything else | the register named like the format, if it exists |

**Register missing?** Do what idiolect says: compose from the core, tell the user which overlay would have helped, and finish the piece. Then, once the user is happy with it, offer to create that register through idiolect's Refine mode with the approved piece as its first evidence - the gap should exist only once.

## Content rule

Draw facts from `wiki/` pages (find them with `bun scripts/wiki.ts find <terms>` and `wiki.ts page <slug>`); cite raw sources where the format allows. Never introduce a claim the wiki cannot back. If the piece needs knowledge the wiki lacks, say what is missing and offer to ingest more sources first.

## Formats

- **Blog / LinkedIn** - markdown straight into `outputs/`. The idiolect profile fully governs; its `quality.md` and the matching register overlay supply the structure and the final checklist.
- **Slides** - see "Slides" below.
- **Documents (whitepaper, PoV, 6-pager, ... as .md, .docx or .pdf)** - see "Documents" below.
- **Images** - see "Visuals" below. SVGs referenced by slide/doc specs are converted to PNG automatically by the scripts.

## Visuals

**You own the visual, end to end.** Nobody will ask which route you took - the only test is whether the finished artifact reads better. Decide per visual, act, and do not stop to ask permission for a routine choice.

**SVG is the currency.** Both compose scripts accept a `.svg` path and rasterize it themselves, so always ask Lolly for `--format=svg`: it arrives as editable text, not a flat picture, which is what makes route 2 below possible.

### Three routes

**1. Lolly renders it.** A tool already makes this shape - charts, QR and barcodes, gradients, quote cards, certificates, badges, logo lockups, framed screenshots, icon sets, pricing tables, org/flow charts. Take it. A Lolly render is deterministic, brand-enforced by its template, reproducible from its inputs, and it carries an editable link, none of which a hand-drawn file gives you. **Never hand-draw a chart or a QR code** - that is off-brand work you would have to redo.

**2. Lolly renders part, you finish it.** Often the best answer, and the one to reach for before giving up on route 1. Lolly gives you a correct, on-brand base; you add what no template can know: a callout arrow to the bar that matters, an annotation band, a second panel beside the chart, a label in the wiki's own vocabulary. Edit the SVG directly - it is text.

**3. You draw it.** Bespoke structural diagrams no tool covers: a specific architecture, a four-file layout, a conceptual figure, a flow whose shapes carry meaning. Hand-write brand-true SVG per the brand skill's palette, typography and component rules. Say so plainly in your summary when you take this route, so the user knows the visual is not template-guaranteed.

### Choosing, in three commands

Run the `lolly` skill's script (`bun <skills>/lolly/scripts/lolly.ts`). If the skill is not present, route 3 is your only option.

```bash
bun .../lolly.ts catalog --image <keyword>   # is there a tool for this shape?
bun .../lolly.ts describe <id>               # its real inputs + AUTHORED EXAMPLES
bun .../lolly.ts render <id> k=v ... --format=svg -o outputs/assets/<name>.svg
```

Name the picture you need first ("a ranked comparison of three estates"), then search for that shape. `describe` ends with the tool author's own worked examples - start from the closest one and change the data. **Set the presentation inputs**: a tool called with only its data renders correct but ugly (one flat colour, no title, wrong aspect ratio for the row count), and shipping that is worse than drawing it yourself. The `d3` recipe is in the lolly skill's references/composing.md.

For a visual that is genuinely two tools - a chart on a brand backdrop, a render given a halftone treatment - use `lolly.ts chain`, which pipes one tool's output into the next in one call. Never hand-write a nested embed URL.

### Doing the hybrid

The Lolly SVG is a normal file. Open it, keep its `<svg>` root and `viewBox` intact, and add your own elements after its content so they paint on top:

```
outputs/assets/grain.svg          <- Lolly's render, untouched root
outputs/assets/grain.svg.lolly.json  <- keep: holds the editable link and inputs
```

The lolly skill does the fiddly parts, and works the same for every tool:

```bash
bun .../lolly.ts probe outputs/assets/chart.svg          # coordinate space + anchors
bun .../lolly.ts annotate outputs/assets/chart.svg \
  --layer=layer.svg -o outputs/assets/chart-final.svg [--pad-right=N]
```

`probe` prints the `viewBox` you must place marks in (a render's outer pixel size often disagrees with it) and lists the shapes worth anchoring to, with their centres. `annotate` appends your group without touching the base and can grow the viewBox to make room for side notes. A text card or a gradient honestly reports **no anchors** - place those against the canvas box.

Working rules for editing a render:
- **Add, don't rewrite.** Wrap your additions in one `<g id="annotations">` so the Lolly base stays identifiable and can be re-rendered from its sidecar if the data changes.
- **Match the base.** Pull colours and font-family from the SVG you were given, not from memory - it was generated against the live brand tokens.
- **Keep the sidecar.** `<file>.lolly.json` carries the editable link and exact inputs. It is how the visual gets regenerated later; deleting it strands the asset.
- **Re-read the result.** Rasterize or view the finished SVG before it goes in the deck. A chart that renders is not the same as a chart that is good.

### Whichever route

- Assets live in `outputs/assets/`; specs reference them by relative path.
- New images are generated fresh and context-aware - **never copy a raw-source image**. Use the wiki's image descriptions to inform an improved original.
- Vector-first, explicit `width`/`height`, and a `viewBox` so the rasterizer scales it cleanly.
- Facts in a visual obey the content rule: every number traces to a wiki page.

## Slides

A deck is not a document. The audience reads the slide in one glance and listens to the rest; a slide that reads like markdown has failed. The rules below are evidence-backed (assertion-evidence research, Penn State; cognitive-load text limits) and the compose script lints for the mechanical ones - fix every `lint:` line it prints before delivering.

**Template first.** Read the wiki's `CLAUDE.md` `slide_template:` key, list `templates/slides/` for what exists, and set `"template": "<name>"` in the spec. The template owns fonts, colors, logo, footer and section styling - never restate them per slide, and never override `theme` unless the user asks for an off-template look. If the user wants a new template, build a folder under `templates/slides/<name>/` (template.json + assets; copy an existing one as the starting shape). A `cover` asset must be pre-cropped to the title panel's 4.93:7.5 ratio - it is placed 1:1, not resized.

**Writing the spec** (layout shapes are in the header of `scripts/compose-pptx.ts`):

1. **One idea per slide.** The title is a full-sentence assertion stating the point ("Resident is not sovereign"), never a topic label ("Data residency"). If a slide needs a second sentence to make its point, it is two slides.
2. **Slides carry evidence, notes carry the talk.** Every content slide gets speaker `notes` with the spoken narrative in the user's voice. On-slide text is what the audience must remember, not what the presenter will say.
3. **Bullets are a last resort.** Max 5 per slide, aim for 3, each under ~16 words, no sub-clauses. Before writing bullets, ask what would show the point instead: a generated SVG diagram (flows, comparisons, architectures, timelines), a `big-number` slide (any statistic that matters), a `two-col` (any either/or), a `quote` (any citable sentence), an `image` slide.
4. **Every 2-3 content slides, the audience needs a visual.** Source it per "Visuals" above - a Lolly render, a Lolly render you have annotated, or your own SVG, whichever serves the slide - and reference it from the spec (`image` on a content slide puts text left, visual right). The script converts SVG to PNG automatically.
5. **As few slides as the argument needs - visuals compress.** Slide count comes from the content and the audience's time, never from the layout menu. One good diagram replaces the 3-4 slides that would have explained it; when a visual already carries a point, the slides restating that point are deleted, not kept alongside. A 30-minute talk earns 10-20 slides; a leave-behind argument often fits in 4-6. `section` dividers are for long multi-act talks only - in a short deck they are padding.
6. **Compression pass before rendering**: for every slide ask "must the audience remember this as its own point?" If no, its content moves into a visual, into another slide's notes, or out. The memorable points of a deck number 3-5; the slide count should not be far above that plus title and closing.
7. Numbers beat adjectives; if the wiki has the figure, use `big-number`. Left-align, never all-caps (the template enforces fonts and colors).
8. **`title`, `section` and `closing` take an optional `background`**: `"background": { "path": "assets/<deck>/bg.png" }`, painted full-bleed behind the text. Use it for a generated backdrop (a `mesh-gradient` or `growth` render seeded from the brand palette) when a deck needs more than the flat template colour. The image must be dark and roughly 16:9 - a title slide with one drops the template cover panel and switches to the light-on-dark text colours, and a section slide keeps its corner logo painted back on top.
9. **A slide image may be an animated GIF.** `pptxgenjs` embeds it untouched and PowerPoint and Google Slides both play it in slideshow mode (verified 2026-08-27 by unzipping the deck: all 75 frames landed in `ppt/media/`). `d3` exports `gif`, `apng`, `webm` and `mp4`, and its `frameColumn` input builds a chart frame by frame. Two cautions from that render: the animated exports ignore the `background` input and come out on black, and its `mp4` is AV1, which most players will not open. Recolour the GIF ground and transcode the video after the render, and say in the summary that you did.

Then `bun scripts/compose-pptx.ts <spec> -o outputs/<name>.pptx`, fix lint warnings, and tell the user it imports into Google Slides via File > Import (fonts must be installed on the viewing machine; the SUSE font is on Google Fonts).

### Before you call a deck done

A clean render log is not evidence. pptxgenjs reports success for a slide whose
image resolved to nothing, and an animated GIF can arrive flattened. Two scripts
settle the mechanical half, always:

```bash
bun scripts/verify-pptx.ts outputs/<name>.pptx outputs/<name>.spec.json   # the file
bun scripts/preview.ts outputs/<name>.pptx -o /tmp/preview  # the slides
```

And two more **only when the user says the deck is going to a wider audience,
or asks for a scan** (SKILL.md, "Hogwash runs only when asked"):

```bash
bun scripts/spec-prose.ts outputs/<name>.spec.json          # the words
bun .claude/skills/hogwash/scripts/hogwash.ts scan --register prose --fail-on error outputs/<name>.spec.prose.md
```

- **`spec-prose.ts` then hogwash** settle the words of a shared deck. hogwash
  scans files, and a spec's prose sits in nested JSON no scanner would find, so
  `spec-prose.ts` writes it out as markdown first and prints a line-number index
  that reads a finding back as "slide 3 bullet 2" or "section 4 block 2". It
  reads both spec shapes, slides and document `blocks`, so captions, bullets and
  body paragraphs all arrive, which is where a hand check misses things.
  `--register prose` calibrates the scanner for published prose, and
  `--fail-on error` is what makes one breach fail the run, because the plain
  exit code is density-based and a single dash in a long deck sits under the
  threshold. Hogwash's packs are the real ban list; the idiolect profile at
  hogwash's default `profile/` path adds the owner's bans and voice (see
  references/profile.md). A deck the owner will present from their own laptop
  to their own team is working text: skip these two.
- **`verify-pptx.ts`** opens the deck and reports media per slide, whether notes
  arrived, whether an animation kept its frames, and any image the spec asked for
  that is not there. It also warns when a visual fills far less of its slot than
  the slot offered, which is what a chart looks like just before its type becomes
  unreadable.
- **`preview.ts`** writes one PNG per slide through LibreOffice or Keynote. Read
  them back as images. Every one, not a sample.

**Never substitute an SVG preview for a slide preview.** Rasterising the source
asset with resvg is not the same engine and silently drops shapes PowerPoint
draws correctly, rotated ones especially. A visual that looks broken in an SVG
preview may be fine on the slide, and the only way to know is to build the deck
and look at it. `preview.ts` says so when you point it at an `.svg`.

None of this judges whether the deck is any good. Scene, callback, evidence next
to its claim, and whether a slide earns its place are still yours.

## Documents

Long-form artifacts use the same machinery as slides: a template folder owns the look, a spec JSON owns the content, one script renders it - `bun scripts/compose-doc.ts <spec> -o outputs/<name>.md|.docx|.pdf` (spec shape in the script header). Same output from the same spec in all three formats; .pdf needs Chrome/Chromium on the machine (doctor.ts checks), .md and .docx need nothing.

**A doc template is a document TYPE, not just a skin.** Each folder under `templates/docs/` carries `template.json` (fonts, colors, page, cover, and *rules*: word range, bullet policy, figure density) and `structure.md` (the section skeleton and writing rules for that form). Shipped: `whitepaper`, `pov` (point of view), `amazon-6pager`. Users tweak these or add their own folders; a re-run of setup keeps a tweaked file (only `--refresh-templates` overwrites it). Treat a user-added template's structure.md as law, same as a shipped one.

Composing a document:

1. Pick the template with the user ("whitepaper or PoV?" is a real question - the forms argue differently). List `templates/docs/` for what exists.
2. **Read the template's `structure.md` first** and build the spec's sections to its skeleton. The rules in template.json are enforced by lint; structure.md is enforced by you.
3. Facts from wiki pages only; cite raw sources in a references section where the form has one.
4. Visuals follow "Visuals" above: a Lolly render for any shape a tool covers, annotated by you where the figure needs saying more, your own SVG for bespoke structure. Figure density is linted per template - a document under its figure count is usually one that explained in prose what a chart would have shown.
5. Render, fix every `lint:` line, and re-read the output against voice + quality profiles before delivering. If the user said the document is for a wider audience, or asks for a scan, run `bun scripts/spec-prose.ts <spec>` and the hogwash scan exactly as for a shared deck (the block above); a document only the owner will read is not scanned. For .md outputs, image links point at the generated assets - keep them inside `outputs/`.

## Before calling it done

1. Run idiolect's ordered self-check on the draft (substance, bans, register, mechanics, rhythm, attribution) against the loaded profile. Fix violations, then check again. This is the voice; it applies to every piece.
2. **Share gate, only on request.** If the user said the piece is for a wider audience or asked for a scan, run hogwash on it now (SKILL.md, "Hogwash runs only when asked") and fix or hand over what it reports. If they did not say, deliver the piece and ask in one sentence whether it is going outside; do not scan first.
3. Write the file into `outputs/` with a dated, descriptive name.
4. Log entry (`bun scripts/wiki.ts log compose "<title>"`) + git commit.
5. If composing produced genuinely new synthesis (a comparison, an argument, a connection not yet in the wiki), file it as a `wiki/syntheses/` page. Routine restatements do not get filed.
