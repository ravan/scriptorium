# {{WIKI_NAME}} - Wiki Schema

This folder is an LLM-maintained knowledge wiki, created {{DATE}} by the `wiki` skill.
The agent maintains it; the human curates sources and asks questions.

## Configuration

- **brand_skill**: {{BRAND_SKILL}} (skill to load before composing slides, docx or svg; "none" = neutral default styling)
- **voice**: `profile/voice.md` (governs the words of every composed output; if missing, offer the profile interview)
- **quality**: `profile/quality-and-style.md` (governs structure and QA checks of composed outputs)

## The three layers

1. **`raw/`** - the human's source files, in any subfolders they like. **Immutable: never create, edit or delete anything in raw/ except `.ingest-manifest.json`** (and that only via the scripts).
2. **`wiki/`** - agent-owned markdown. The human reads it; the agent writes it.
3. **This file** - the schema. Keep it current when conventions evolve.

Supporting folders: `derived/` (machine-extracted text/images per source, written by `scripts/ingest.ts`), `profile/` (voice + quality), `outputs/` (composed artifacts), `scripts/` (bun helpers).

## Wiki page types

- `wiki/index.md` - catalog of every page: link + one-line summary, grouped by category. Update on every ingest.
- `wiki/log.md` - append-only. Entry format: `## [YYYY-MM-DD] <ingest|query|compose|lint> | <title>`. Newest at the bottom.
- `wiki/sources/<slug>.md` - one page per raw source (`<slug>` = path relative to raw/, folders joined by `--`, extension dropped: `papers/whitepaper.docx` → `papers--whitepaper.md`): key takeaways, claims, links to derived media with a one-line description of **each image** (what it shows, why it matters).
- `wiki/topics/<slug>.md` - synthesis pages for concepts/themes across sources.
- `wiki/entities/<slug>.md` - people, products, organizations, projects.
- `wiki/syntheses/<slug>.md` - larger cross-cutting analyses, comparisons, and filed answers to good questions.

Conventions: standard markdown links with relative paths (never `[[wikilinks]]`). When a new source contradicts an existing claim, state both with source links; do not silently overwrite. Every page starts with a one-line purpose sentence.

## Operations

### Ingest (default: batch)
1. Run `bun scripts/ingest.ts`. It updates `raw/.ingest-manifest.json` and extracts text + media into `derived/`.
2. Work through everything `bun scripts/manifest.ts pending` lists (not only the latest run's output). For each source: read the derived text, **view every extracted image** and write a one-line description for it in the source page.
3. Write/update the source page, then update affected topic/entity/synthesis pages and `index.md`.
4. Append one log entry per source, then `bun scripts/manifest.ts mark-ingested <file> --pages <pages>` (`--pages` appends across calls; never mark a `removed` file - the script refuses).
5. One commit per batch: `git add -A && git commit -m "ingest: <files or count>"`.

"Ingest slowly" = same steps, but pause after step 2 of each source to discuss takeaways before filing.

### Query
Read `index.md` first, drill into pages, answer with links to wiki pages and raw sources. If the answer produced genuinely new synthesis, file it under `wiki/syntheses/` and log it.

### Compose (blog, LinkedIn post, slides, docx, svg)
1. Load `profile/voice.md` + `profile/quality-and-style.md`; for slides/docx/svg also load the brand skill named above.
2. Gather content from wiki pages (never invent facts not in the wiki or raw sources).
3. Blog/LinkedIn: write markdown into `outputs/`. Slides: write a spec JSON, then `bun scripts/compose-pptx.ts <spec> -o outputs/<name>.pptx`. Docx: same with `compose-docx.ts`. Svg: hand-write the SVG following brand rules.
4. Run the voice and quality checks against the draft before calling it done.
5. Log entry + git commit. File new insights back into `wiki/syntheses/`.

### Lint
Health-check the wiki: contradictions, stale claims, orphan pages, concepts without pages, missing cross-references, sources stuck in `extracted` status (`bun scripts/manifest.ts pending`). Report findings, fix approved ones, log the pass.

## Manifest statuses

`extracted` (script done, agent ingest pending) → `ingested` (in the wiki). Also: `removed` (file left raw/; keep the knowledge, note "source removed <date>" in the source page - creating it from derived/ content if it never got one - and flag in next lint), `unsupported`, `error`. If a `pagesTouched` page is missing, recreate it as a first ingest and note the inconsistency in the log.
