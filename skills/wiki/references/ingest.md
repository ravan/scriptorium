# Ingest mode

Goal: every new or changed file in `raw/` becomes understood knowledge in `wiki/`, with the manifest tracking state.

Two speeds. **Batch** (default): process everything pending, log each. **Slow** (user says "ingest slowly" or similar): after reading each source, discuss key takeaways with the user before filing.

## Pipeline per run

1. `bun scripts/ingest.ts` - scans `raw/`, hashes files, updates `raw/.ingest-manifest.json`, and extracts into `derived/<slug>/`:
   - **pptx** → `text.md` (per-slide text + speaker notes) + `media/` (embedded images)
   - **docx** → `text.md` + `media/`
   - **pdf** → `text.txt` + `media/` (embedded images) + `pages/` (a picture of each page, capped at 60 - the cap is printed, never silent)
   - **md/txt/images** → no extraction; read the raw file directly
2. For each file listed by `bun scripts/manifest.ts pending` (not only what the latest run printed - an interrupted ingest leaves earlier files pending too), build understanding:
   - Read the derived text (or raw file).
   - **View every image** in `media/` (and `pages/` when the text alone is unclear). For each, write a one-line description: what it shows and why it matters. These descriptions are what makes the wiki rich enough to recompose from later - the wiki must "know" what every illustration said.
3. Write `wiki/sources/<slug>.md`, where `<slug>` = the path relative to `raw/` with folders joined by `--` and the extension dropped (`papers/whitepaper.docx` → `papers--whitepaper.md`). This keeps two same-named files in different folders from colliding. Page content: purpose line, key takeaways, notable claims (with slide/page numbers), image descriptions linking to `derived/.../media/...`.
4. Ripple outward: update or create `topics/`, `entities/`, `syntheses/` pages this source touches, flag contradictions (both claims, both links), and update `wiki/index.md`. A single source may touch 10-15 pages; that is normal.
5. Close out each source:
   ```
   bun scripts/manifest.ts mark-ingested <raw-rel-path> --pages "wiki/sources/x.md,wiki/topics/y.md"
   ```
   `--pages` appends (a union across calls), so listing a shared topic page from every source that touches it is correct.
6. Append one log entry per source to `wiki/log.md` (title = the raw file name, with `(updated)` or `(removed)` added when that applies). Then one git commit for the whole batch: `git add -A && git commit -m "ingest: <files or count>"`.

## States you will meet

- `extracted` - script done, your ingest pending (`bun scripts/manifest.ts pending` lists these).
- `changed` files re-extract automatically on the next run and drop back to `extracted`; re-read and update the pages listed in `pagesTouched`. If a listed page does not exist, treat the file as a first ingest (create the pages) and note the inconsistency in the log entry - it is a sign a past session ended half-done, worth a lint.
- `removed` - file left `raw/`. Keep the knowledge, add "source removed <date>" to its source page, mention in the next lint. If it was removed before it was ever ingested, create its source page now from the surviving `derived/` content (if any is useful) and mark it removed the same way. Never run `mark-ingested` on a removed file (the script refuses); list its pages in the log entry instead.
- `unsupported` / `error` - tell the user plainly what the file is and what you can or cannot do with it; handle manually if you can read it.
