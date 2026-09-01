---
name: wiki
description: Use when the user wants an agent-maintained knowledge wiki - creating one, ingesting source material (pptx, pdf, docx, markdown, images), asking questions of accumulated knowledge, recomposing it into blogs, LinkedIn posts, slide decks, docx or SVG images, health-checking pages, or building a personal voice profile (captured by the bundled idiolect skill, enforced by the bundled hogwash skill). Also use when a folder contains raw/.ingest-manifest.json or the user mentions "my wiki".
---

# Wiki

An LLM-maintained knowledge base: the human curates sources and asks questions; the agent extracts, cross-references, and maintains a persistent, compounding wiki of markdown pages, then recomposes that knowledge into outputs written in the human's own voice.

Deterministic work (folder scaffolding, file extraction, manifest tracking, pptx/docx rendering) lives in bun + TypeScript scripts in `scripts/`. Judgment work (summarizing, cross-referencing, synthesis, writing) is yours.

## The user cannot use a command line

Talk in plain language. Run every command yourself; never ask the user to run one. Explain what you are doing in one short sentence, not in shell syntax. Before installing anything, say what it is and why in one sentence, then ask a yes/no question.

## Mode routing

| User intent sounds like | Mode | Read first |
|---|---|---|
| "new wiki", "set up a wiki for X" | Setup | references/setup.md |
| "add these files", "process my sources", "ingest" | Ingest | references/ingest.md |
| "what do we know about...", any question against the wiki | Query | this file, Query section |
| "write a blog/post/deck/doc/image from the wiki" | Compose | references/compose.md |
| "health check", "lint", "anything stale?" | Lint | references/lint.md |
| "capture my voice", "sounds fake", voice_profile is none | Profile | references/profile.md |

Every wiki carries its own `CLAUDE.md` schema (created at setup). When working inside a wiki, that schema is the local authority; these references explain the machinery behind it.

## Hard rules

1. **`raw/` is immutable.** Never create, edit or delete files in `raw/` (the scripts alone maintain `raw/.ingest-manifest.json`).
2. **Never invent facts.** Everything in the wiki traces to a raw source; everything composed traces to the wiki.
3. **Contradictions are flagged, not overwritten.** New source disagrees with an old claim: record both, with links.
4. **Answers worth keeping get filed** into `wiki/syntheses/` so exploration compounds.
5. **Every operation gets a log entry** (`bun scripts/wiki.ts log <op> "<title>"` appends to `wiki/log.jsonl`) and a git commit.
6. **Metadata is queried, never read whole.** `wiki/index.json`, `wiki/map.json` and `wiki/log.jsonl` are machine files that grow with the wiki; `bun scripts/wiki.ts` serves slices of them. Humans get reading copies from `wiki.ts render`.

## Query mode (inline, no reference file)

Start with `bun scripts/wiki.ts find <terms>` against the generated catalog (or `find --text` for full text), then `wiki.ts page <slug>` to see a hit's neighbours, then read the pages that matter. Answer with links to wiki pages and, where it matters, the raw source. If the answer required new cross-source synthesis, offer to file it as a `wiki/syntheses/` page.

## Scripts quick reference

All run with `bun`, from the wiki folder (`scripts/` inside each wiki is a self-contained copy):

| Script | Job |
|---|---|
| `doctor.ts` | check required tools, print plain-language install hints |
| `setup.ts <dir> --name "X" [--brand <skill>] [--slide-template <name>] [--bundle-skills a,b] [--voice-profile <name>]` | scaffold/repair a wiki, idempotent; refreshes `scripts/`, `templates/` and any bundled skills; always bundles (or installs via `npx skills add ravan/hogwash`) the `idiolect` and `hogwash` skills: idiolect owns the voice profiles in `profiles/`, hogwash scans and rewrites prose against them. Bundled skills are always real copies, never symlinks |
| `ingest.ts [--dry-run] [--re-extract <file>]` | scan raw/, update manifest, extract text+media to derived/; junk images (blank/tiny/duplicate/unviewable) are gated into `skipped/` with a `skipped.json` note |
| `manifest.ts status\|pending\|mark-ingested` | inspect and update ingest state |
| `outline.ts [slug\|--all]` | heading map + `sed` read plan for extracted text too big to `cat`. Every slice is guaranteed under the byte budget, so a printed command never truncates |
| `media.ts [slug\|--all]` | inventory of images worth viewing: absolute paths, sizes; junk, duplicates and text-only PDF page renders appear only as counts. Marks animated gif/apng/webp `ANIMATED` - viewing one shows frame 1 only |
| `links.ts [--quiet]` | verify every relative link resolves; regenerate `wiki/index.json` + `wiki/map.json`; exit 1 if broken |
| `wiki.ts find\|page\|hubs\|clusters\|orphans\|recent\|log\|render` | query the catalog/graph/log in slices; append log entries; render human reading copies to `outputs/` |
| `clean.ts [--apply]` | reclaim disk: delete gated junk, plus any PDF page render or media file of an ingested source that no wiki page links to (dry run by default). A render you cited in a source page is kept |
| `compose-pptx.ts <spec.json> -o out.pptx` | render slide spec to branded .pptx via a template from `templates/slides/` (Google Slides importable); prints `lint:` warnings against the slide rules in references/compose.md |
| `compose-doc.ts <spec.json> -o out.(md\|docx\|pdf)` | render a document spec through a `templates/docs/` template (whitepaper, pov, amazon-6pager, ...); lints against the template's word/bullet/figure rules; pdf needs Chrome |
| `compose-docx.ts <spec.json> -o out.docx` | back-compat shim over compose-doc.ts |
| `verify-pptx.ts <deck.pptx> [spec.json]` | open the rendered deck and report what is really inside it: media per slide, notes, animation, and every image the spec asked for that did not arrive. Exit 2 on a problem |
| `preview.ts <file> [-o dir] [--pages 1-4]` | turn a .pptx, .pdf, .svg or .gif into PNGs to read back as images. Decks go through LibreOffice or Keynote, the engines that will actually show them |
| `voice-lint.ts <file.md \| spec.json>` | the mechanical half of the voice profile: connector dashes, sentences over one comma, banned words, emoji, long paragraphs. Reads the ban list from the active idiolect profile's `ban-list.md` (legacy `profile/voice.md` kill lists still parse). Exit 2 on a hard-rule finding |

Spec JSON shapes are documented in the header comments of the two compose scripts.

**Existing wiki missing a script?** Re-run `setup.ts` on it. It overwrites `scripts/` only and never touches your content.

## Tests

```bash
bun test scripts/                 # 148 tests, offline, no external tools
```

Covers the byte-level image checks (animation detection for gif/apng/webp, text-only page-render detection) and the read-plan slicer. It needs no ImageMagick and no Chrome: the fixtures are built in the test, so a failure always means the parser broke. Run it after any change to `image.ts`, `outline.ts` or `setup.ts`.

Three of these suites exist because real use broke the scripts, and each encodes the lesson as a test rather than as advice:

- `outline.test.ts` - every emitted slice must fit the **byte** budget. Slices once ran 2-12x over, because spans between headings were never subdivided and the budget counted UTF-16 chars while the pipe carries UTF-8.
- `textpage.test.ts` - a page render must only be filtered when it is provably just text. Its safety cases are the ones that matter; a pale grey diagram was wrongly hidden until tint detection was added.
- `setup.test.ts` - a bundled skill must be a real directory that still works when its source repo is moved away. `cpSync` copies a symlinked skill as a link, which works only on the machine that ran setup.
