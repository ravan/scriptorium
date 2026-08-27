# Compose mode

Goal: recompose wiki knowledge into a new artifact - blog post, LinkedIn post, slide deck (.pptx), document (.docx), or SVG image - in the user's voice, at their quality bar, in their brand style.

## Load order (before writing a word)

1. `profile/voice.md` - governs every word of prose. Honor its HARD RULEs absolutely, STRONG TENDENCYs ~70-80% of the time, LIGHT PREFERENCEs by judgment (the profile explains its own labels).
2. `profile/quality-and-style.md` - governs structure, checklists, antipatterns.
3. For slides, docx, or SVG: the brand skill named in the wiki's `CLAUDE.md` (`brand_skill:`). If `none`, use the neutral defaults built into the compose scripts.
4. If a profile file is missing, offer the interview (references/profile.md) or proceed with a plain, neutral style after saying so.

## Content rule

Draw facts from `wiki/` pages (start at `index.md`); cite raw sources where the format allows. Never introduce a claim the wiki cannot back. If the piece needs knowledge the wiki lacks, say what is missing and offer to ingest more sources first.

## Formats

- **Blog / LinkedIn** - markdown straight into `outputs/`. Voice profile fully governs; quality doc supplies the structure and the final checklist.
- **Slides** - write a spec JSON (shape in the header of `scripts/compose-pptx.ts`), map brand palette/fonts into `theme`, then `bun scripts/compose-pptx.ts <spec> -o outputs/<name>.pptx`. Tell the user it imports into Google Slides via File > Import. Speaker notes carry the voice; keep on-slide text short.
- **Docx** - same pattern with `scripts/compose-docx.ts` (shape in its header).
- **SVG images** - hand-write the SVG following the brand skill's palette, typography and component rules (vector-first; explicit width/height). New images are generated fresh and context-aware - never copy a raw-source image; use the wiki's image descriptions to inform an improved original.
- SVGs referenced by slide/docx specs are converted to PNG automatically by the scripts.

## Before calling it done

1. Re-read the draft against the voice profile's Never list and the quality doc's checklist. Fix violations, then check again.
2. Write the file into `outputs/` with a dated, descriptive name.
3. Log entry in `wiki/log.md` + git commit.
4. If composing produced genuinely new synthesis (a comparison, an argument, a connection not yet in the wiki), file it as a `wiki/syntheses/` page. Routine restatements do not get filed.
