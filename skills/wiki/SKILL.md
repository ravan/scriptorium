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
5. **Every operation gets a log entry** in `wiki/log.md` (`## [YYYY-MM-DD] <op> | <title>`) and a git commit.

## Query mode (inline, no reference file)

Read `wiki/index.md` first to find relevant pages, drill into them, then answer with links to wiki pages and, where it matters, the raw source. If the answer required new cross-source synthesis, offer to file it as a `wiki/syntheses/` page.

## Scripts quick reference

All run with `bun`, from the wiki folder (`scripts/` inside each wiki is a self-contained copy):

| Script | Job |
|---|---|
| `doctor.ts` | check required tools, print plain-language install hints |
| `setup.ts <dir> --name "X" [--brand <skill>]` | scaffold/repair a wiki, idempotent |
| `ingest.ts [--dry-run]` | scan raw/, update manifest, extract text+media to derived/ |
| `manifest.ts status\|pending\|mark-ingested` | inspect and update ingest state |
| `compose-pptx.ts <spec.json> -o out.pptx` | render slide spec to .pptx (Google Slides importable) |
| `compose-docx.ts <spec.json> -o out.docx` | render document spec to .docx |

Spec JSON shapes are documented in the header comments of the two compose scripts.
