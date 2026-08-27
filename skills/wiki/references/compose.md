# Compose mode

Goal: recompose wiki knowledge into a new artifact - blog post, LinkedIn post, slide deck (.pptx), document (.docx), or SVG image - in the user's voice, at their quality bar, in their brand style.

## Load order (before writing a word)

1. `profile/voice.md` - governs every word of prose. Honor its HARD RULEs absolutely, STRONG TENDENCYs ~70-80% of the time, LIGHT PREFERENCEs by judgment (the profile explains its own labels).
2. `profile/quality-and-style.md` - governs structure, checklists, antipatterns.
3. For slides, docx, or SVG: the brand skill named in the wiki's `CLAUDE.md` (`brand_skill:`). If `none`, use the neutral defaults built into the compose scripts.
4. If a profile file is missing, offer the interview (references/profile.md) or proceed with a plain, neutral style after saying so.

## Content rule

Draw facts from `wiki/` pages (find them with `bun scripts/wiki.ts find <terms>` and `wiki.ts page <slug>`); cite raw sources where the format allows. Never introduce a claim the wiki cannot back. If the piece needs knowledge the wiki lacks, say what is missing and offer to ingest more sources first.

## Formats

- **Blog / LinkedIn** - markdown straight into `outputs/`. Voice profile fully governs; quality doc supplies the structure and the final checklist.
- **Slides** - see "Slides" below.
- **Documents (whitepaper, PoV, 6-pager, ... as .md, .docx or .pdf)** - see "Documents" below.
- **SVG images** - hand-write the SVG following the brand skill's palette, typography and component rules (vector-first; explicit width/height). New images are generated fresh and context-aware - never copy a raw-source image; use the wiki's image descriptions to inform an improved original.
- SVGs referenced by slide/docx specs are converted to PNG automatically by the scripts.

## Slides

A deck is not a document. The audience reads the slide in one glance and listens to the rest; a slide that reads like markdown has failed. The rules below are evidence-backed (assertion-evidence research, Penn State; cognitive-load text limits) and the compose script lints for the mechanical ones - fix every `lint:` line it prints before delivering.

**Template first.** Read the wiki's `CLAUDE.md` `slide_template:` key, list `templates/slides/` for what exists, and set `"template": "<name>"` in the spec. The template owns fonts, colors, logo, footer and section styling - never restate them per slide, and never override `theme` unless the user asks for an off-template look. If the user wants a new template, build a folder under `templates/slides/<name>/` (template.json + assets; copy an existing one as the starting shape). A `cover` asset must be pre-cropped to the title panel's 4.93:7.5 ratio - it is placed 1:1, not resized.

**Writing the spec** (layout shapes are in the header of `scripts/compose-pptx.ts`):

1. **One idea per slide.** The title is a full-sentence assertion stating the point ("Resident is not sovereign"), never a topic label ("Data residency"). If a slide needs a second sentence to make its point, it is two slides.
2. **Slides carry evidence, notes carry the talk.** Every content slide gets speaker `notes` with the spoken narrative in the user's voice. On-slide text is what the audience must remember, not what the presenter will say.
3. **Bullets are a last resort.** Max 5 per slide, aim for 3, each under ~16 words, no sub-clauses. Before writing bullets, ask what would show the point instead: a generated SVG diagram (flows, comparisons, architectures, timelines), a `big-number` slide (any statistic that matters), a `two-col` (any either/or), a `quote` (any citable sentence), an `image` slide.
4. **Every 2-3 content slides, the audience needs a visual.** Generate SVGs per the brand skill and reference them from the spec (`image` on a content slide puts text left, visual right). The script converts SVG to PNG automatically.
5. **As few slides as the argument needs - visuals compress.** Slide count comes from the content and the audience's time, never from the layout menu. One good diagram replaces the 3-4 slides that would have explained it; when a visual already carries a point, the slides restating that point are deleted, not kept alongside. A 30-minute talk earns 10-20 slides; a leave-behind argument often fits in 4-6. `section` dividers are for long multi-act talks only - in a short deck they are padding.
6. **Compression pass before rendering**: for every slide ask "must the audience remember this as its own point?" If no, its content moves into a visual, into another slide's notes, or out. The memorable points of a deck number 3-5; the slide count should not be far above that plus title and closing.
7. Numbers beat adjectives; if the wiki has the figure, use `big-number`. Left-align, never all-caps (the template enforces fonts and colors).

Then `bun scripts/compose-pptx.ts <spec> -o outputs/<name>.pptx`, fix lint warnings, and tell the user it imports into Google Slides via File > Import (fonts must be installed on the viewing machine; the SUSE font is on Google Fonts).

## Documents

Long-form artifacts use the same machinery as slides: a template folder owns the look, a spec JSON owns the content, one script renders it - `bun scripts/compose-doc.ts <spec> -o outputs/<name>.md|.docx|.pdf` (spec shape in the script header). Same output from the same spec in all three formats; .pdf needs Chrome/Chromium on the machine (doctor.ts checks), .md and .docx need nothing.

**A doc template is a document TYPE, not just a skin.** Each folder under `templates/docs/` carries `template.json` (fonts, colors, page, cover, and *rules*: word range, bullet policy, figure density) and `structure.md` (the section skeleton and writing rules for that form). Shipped: `whitepaper`, `pov` (point of view), `amazon-6pager`. Users tweak these or add their own folders; treat a user-added template's structure.md as law, same as a shipped one.

Composing a document:

1. Pick the template with the user ("whitepaper or PoV?" is a real question - the forms argue differently). List `templates/docs/` for what exists.
2. **Read the template's `structure.md` first** and build the spec's sections to its skeleton. The rules in template.json are enforced by lint; structure.md is enforced by you.
3. Facts from wiki pages only; cite raw sources in a references section where the form has one.
4. Visuals follow the slide rules: generate brand-true SVGs for anything structural (the script converts and renders them with the template's fonts); figure density is linted per template.
5. Render, fix every `lint:` line, and re-read the output against voice + quality profiles before delivering. For .md outputs, image links point at the generated assets - keep them inside `outputs/`.

## Before calling it done

1. Re-read the draft against the voice profile's Never list and the quality doc's checklist. Fix violations, then check again.
2. Write the file into `outputs/` with a dated, descriptive name.
3. Log entry (`bun scripts/wiki.ts log compose "<title>"`) + git commit.
4. If composing produced genuinely new synthesis (a comparison, an argument, a connection not yet in the wiki), file it as a `wiki/syntheses/` page. Routine restatements do not get filed.
