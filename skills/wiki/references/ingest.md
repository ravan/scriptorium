# Ingest mode

Goal: every new or changed file in `raw/` becomes understood knowledge in `wiki/`, with the manifest tracking state.

Two speeds. **Batch** (default): process everything pending, log each. **Slow** (user says "ingest slowly" or similar): after reading each source, discuss key takeaways with the user before filing.

## Pipeline per run

1. `bun scripts/ingest.ts` - scans `raw/`, hashes files, updates `raw/.ingest-manifest.json`, and extracts into `derived/<slug>/`:
   - **pptx** → `text.md` (per-slide text + speaker notes) + `media/` (embedded images)
   - **docx** → `text.md` + `media/`
   - **pdf** → `text.txt` + `media/` (embedded images) + `pages/` (a picture of each page, capped at 60 - the cap is printed, never silent)
   - **md/txt/images** → no extraction; read the raw file directly

   Junk images are **gated at extraction**: blanks (decode to one flat colour), tiny icons (long side under 64 px), byte-identical duplicates, and unviewable vector formats (emf/wmf) are moved to `media/skipped/` (or `pages/skipped/`) with the reason recorded in `derived/<slug>/skipped.json`. You never view them; you only account for them (step 3). `--re-extract <raw-rel-path>` forces one unchanged file through extraction again (after `clean.ts`, or to apply a newer gate) without changing its manifest status.
2. Survey the batch before reading a word of it. Two commands, once per run:
   ```
   bun scripts/outline.ts     # structure + read plan for every pending text
   bun scripts/media.ts       # every pending image, with paths to view
   ```
   `outline.ts` prints a heading map and a ready-to-paste `sed -n 'a,bp'` slice per section, every slice sized to arrive whole. Extracted text runs to 40 KB and more; `cat` on a file that size truncates and you lose the tail without being told. Read the slices instead.

   **The read plan is a map, not a route.** For a long structured source (legislation, a standard, a spec) the recipe is: read the heading map first, decide which sections carry the answer, then read only those slices. A 129-page regulation prints 43 slices and perhaps six of them matter. Where the headings are too generic to choose from, `grep -n` for the document's own spine (`^Article `, `^Section `, `^[0-9]+\.`) gives a sharper index than the outline can infer. Reading a 5,000-line source end to end is a choice, and usually the wrong one.

   `media.ts` prints absolute image paths (paste straight into a file read) for images **worth viewing only** - the extraction gate already filtered junk, and anything junk-like that survives in an older derived/ folder is reported as counts and relative paths, never as a viewable path. Cross-source byte-identical files are grouped: view the first, reuse its description. A "possible near-duplicates" hint (same format and pixel size) is only a hint; check while viewing.

   PDF `pages/` renders that hold nothing but typeset text are summarised as a count too, since their content is already in `text.*`. A page carrying a figure still gets listed, including a pale grey one: the test looks for colour, filled panels and solid blocks, and resolves every uncertain case to "show it". If an extraction looks garbled, read the page render directly by path rather than trusting the count.

3. For each file listed by `bun scripts/manifest.ts pending` (not only what the latest run printed - an interrupted ingest leaves earlier files pending too), build understanding:
   - Read the derived text (or raw file), in the slices `outline.ts` gave you.
   - **View every image `media.ts` lists** (and `pages/` when the text alone is unclear). For each, write a one-line description: what it shows and why it matters. These descriptions are what makes the wiki rich enough to recompose from later - the wiki must "know" what every illustration said. Account for the gated ones in the source page in a single line, from `skipped.json` (e.g. "12 further images were blanks/icons, filtered at extraction") - never link to a skipped file.
4. Write `wiki/sources/<slug>.md`, where `<slug>` = the path relative to `raw/` with folders joined by `--` and the extension dropped (`papers/whitepaper.docx` → `papers--whitepaper.md`). This keeps two same-named files in different folders from colliding. Page content: purpose line, key takeaways, notable claims (with slide/page numbers), image descriptions linking to `derived/.../media/...`.
5. Ripple outward: update or create `topics/`, `entities/`, `syntheses/` pages this source touches and flag contradictions (both claims, both links). Wiki pages are the owner's private working notes: **never run hogwash on them**, at ingest or ever. Plain, dense and true beats polished here. A single source may touch 10-15 pages; that is normal. There is no index to maintain - `wiki/index.json` is generated from each page's purpose line, so getting that first sentence right IS the index work.
6. Close out each source:
   ```
   bun scripts/manifest.ts mark-ingested <raw-rel-path> --pages "wiki/sources/x.md,wiki/topics/y.md"
   ```
   `--pages` appends (a union across calls), so listing a shared topic page from every source that touches it is correct.
7. Log one entry per source (title = the raw file name, with `(updated)` or `(removed)` added when that applies):
   ```
   bun scripts/wiki.ts log ingest "<raw file name>" --pages "wiki/sources/x.md,wiki/topics/y.md"
   ```
   Then check the wiring you just wrote and commit the batch:
   ```
   bun scripts/links.ts
   git add -A && git commit -m "ingest: <files or count>"
   ```
   `links.ts` exits 1 when a relative link is broken, a page the manifest claims exists is missing, a `[[wikilink]]` slipped in, or a link target holds an unencoded space (raw file names often do; write `%20` or wrap the target in `<...>`, since strict markdown drops the link otherwise). One ingest can add sixty links by hand, and a broken one is invisible until someone follows it. Fix what it reports before committing (it also warns on pages missing their purpose line, and on a source page not at its schema name - fix those too). The same run regenerates `wiki/index.json` and `wiki/map.json` - commit them with the batch; never edit them by hand. `git add -A` is safe: setup's `.gitignore` keeps page renders, gated junk and render intermediates out of git (a clone regenerates them with `ingest.ts --re-extract`), while embedded media that pages link to stays tracked.

8. Optional, when the user cares about disk space: `bun scripts/clean.ts` shows what derived/ material of ingested sources can go (gated junk, PDF page renders, unreferenced media); `--apply` deletes it. Everything is regenerable with `bun scripts/ingest.ts --re-extract <file>`.

## States you will meet

- `extracted` - script done, your ingest pending (`bun scripts/manifest.ts pending` lists these).
- `changed` files re-extract automatically on the next run and drop back to `extracted`; re-read and update the pages listed in `pagesTouched`. If a listed page does not exist, treat the file as a first ingest (create the pages) and note the inconsistency in the log entry - it is a sign a past session ended half-done, worth a lint.
- `removed` - file left `raw/`. Keep the knowledge, add "source removed <date>" to its source page, mention in the next lint. If it was removed before it was ever ingested, create its source page now from the surviving `derived/` content (if any is useful) and mark it removed the same way. Never run `mark-ingested` on a removed file (the script refuses); list its pages in the log entry instead.
  **"Forget this source"**: when the user asks you to remove a file from the wiki, this is the one time you delete from `raw/`. Say which file and what stays behind (its source page, marked removed), get a yes, delete the file, run `bun scripts/ingest.ts`, then follow the removed flow above. If they also want the knowledge gone, delete the source page and fix every link to it (`links.ts` lists them), and note both in the log entry.
- A PDF whose manifest note says **NO TEXT LAYER** is a scan: `text.txt` is empty and the knowledge sits in the `pages/` renders. Read those directly, page by page, and say so on the source page.
- `unsupported` / `error` - tell the user plainly what the file is and what you can or cannot do with it; handle manually if you can read it.
