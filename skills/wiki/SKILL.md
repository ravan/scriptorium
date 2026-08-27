---
name: wiki
description: Use when the user wants an agent-maintained knowledge wiki - creating one, ingesting source material (pptx, pdf, docx, markdown, images), asking questions of accumulated knowledge, recomposing it into blogs, LinkedIn posts, slide decks, docx or SVG images, health-checking pages, or building a personal voice/quality writing profile. Also use when a folder contains raw/.ingest-manifest.json or the user mentions "my wiki".
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
| "capture my voice", missing profile/voice.md or quality doc | Profile | references/profile.md |

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
| `setup.ts <dir> --name "X" [--brand <skill>] [--slide-template <name>] [--bundle-skills a,b]` | scaffold/repair a wiki, idempotent; refreshes `scripts/`, `templates/` and any bundled skills |
| `ingest.ts [--dry-run] [--re-extract <file>]` | scan raw/, update manifest, extract text+media to derived/; junk images (blank/tiny/duplicate/unviewable) are gated into `skipped/` with a `skipped.json` note |
| `manifest.ts status\|pending\|mark-ingested` | inspect and update ingest state |
| `outline.ts [slug\|--all]` | heading map + `sed` read plan for extracted text too big to `cat` |
| `media.ts [slug\|--all]` | inventory of images worth viewing: absolute paths, sizes; junk appears only as counts |
| `links.ts [--quiet]` | verify every relative link resolves; regenerate `wiki/index.json` + `wiki/map.json`; exit 1 if broken |
| `wiki.ts find\|page\|hubs\|clusters\|orphans\|recent\|log\|render` | query the catalog/graph/log in slices; append log entries; render human reading copies to `outputs/` |
| `clean.ts [--apply]` | reclaim disk: delete gated junk, PDF page renders and unreferenced media of ingested sources (dry run by default) |
| `compose-pptx.ts <spec.json> -o out.pptx` | render slide spec to branded .pptx via a template from `templates/slides/` (Google Slides importable); prints `lint:` warnings against the slide rules in references/compose.md |
| `compose-doc.ts <spec.json> -o out.(md\|docx\|pdf)` | render a document spec through a `templates/docs/` template (whitepaper, pov, amazon-6pager, ...); lints against the template's word/bullet/figure rules; pdf needs Chrome |
| `compose-docx.ts <spec.json> -o out.docx` | back-compat shim over compose-doc.ts |

Spec JSON shapes are documented in the header comments of the two compose scripts.

**Existing wiki missing a script?** Re-run `setup.ts` on it. It overwrites `scripts/` only and never touches your content.
