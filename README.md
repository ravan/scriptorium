# Wiki — an agent-maintained knowledge base skill

A [Claude Code](https://claude.com/claude-code) skill that turns a folder of source material into a living, interlinked markdown wiki — and then recomposes that knowledge into blogs, LinkedIn posts, branded slide decks, whitepapers, point-of-view papers and memos (as Markdown, Word or PDF) and SVG images, written in **your** voice and styled by **your** templates.

You curate sources and ask questions. The agent does everything else: extraction, summarizing, cross-referencing, filing, maintenance and writing.

The idea builds on Andrej Karpathy's ["LLM Wiki" pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f#file-llm-wiki-md) (a local copy lives in `docs/kapathy/gist.md`): instead of re-retrieving from raw documents on every question (RAG), the agent **compiles knowledge once** into a persistent wiki and keeps it current. Every source you add and every good question you ask makes the wiki richer. This skill makes that pattern structured and deterministic: fixed layout, tracked ingestion, repeatable scripts.

## How it works

Every wiki has three layers:

| Layer | Who writes it | What it is |
|---|---|---|
| `raw/` | You | Your source files, in any subfolders you like. Immutable — the agent never touches them. |
| `wiki/` | The agent | Interlinked markdown: source summaries, topics, entities, syntheses, an index and a log. |
| `CLAUDE.md` | The skill | The schema: the rules the agent follows to maintain this wiki. |

Deterministic work lives in **bun + TypeScript scripts** (extraction, manifest tracking, pptx/docx rendering). Judgment work (understanding, synthesis, writing) is the agent's.

```
my-wiki/
  raw/                    # your sources; .ingest-manifest.json tracks state
  derived/                # machine-extracted text + images per source
  wiki/                   # index.md, log.md, sources/, topics/, entities/, syntheses/
  profile/                # voice.md + quality-and-style.md (how outputs sound)
  outputs/                # composed blogs, posts, decks, docs, images
  templates/              # slide + document templates (skill-shipped and your own)
  scripts/                # self-contained copy of the bun helpers
  CLAUDE.md               # the schema
```

## Getting started

You do not need to know the command line. The agent runs everything and asks plain yes/no questions before installing anything.

1. **Install the skill.** Copy (or symlink) `skills/wiki/` into your skills folder, e.g. `~/.claude/skills/wiki`. In this repo it is already linked via `.claude/skills/`.
2. **Create a wiki.** In Claude Code, say: *"Set up a wiki called Sovereignty Research."* The agent checks tools (bun, poppler, git), asks before installing anything missing, and scaffolds the wiki (default location `~/Wikis/<name>`).
3. **Add sources.** Drop files into `raw/` — PowerPoint (`.pptx`), PDF, Word (`.docx`), markdown, text, images. Subfolders are fine.
4. **Ingest.** Say: *"Ingest my sources."* The scripts extract text, speaker notes and embedded images; the agent reads it all, **views every image and describes it**, then writes and cross-links wiki pages. Say *"ingest slowly"* to review each source together before it is filed.
5. **Ask questions.** *"What do we know about data residency rules?"* Answers cite wiki pages; good answers get filed back so exploration compounds.
6. **Compose.** *"Write a LinkedIn post about X"*, *"make a slide deck on Y"*, *"write a whitepaper on Z as PDF"*. Outputs land in `outputs/`, written in your voice, checked against your quality bar, styled by a template. Decks are real `.pptx` files that import into Google Slides (File → Import); documents render to `.md`, `.docx` or `.pdf` from one spec.

### Your voice and quality profile

Composed outputs are governed by two files in `profile/`:

- **`voice.md`** — how you sound: openings, sentence rhythm, kill list of banned words, hard rules.
- **`quality-and-style.md`** — what "good" means per format: structure, evidence rules, ship checklists.

Have them already? The agent copies them in at setup. Don't? Say *"capture my voice"* — the agent either drafts a profile from 3–5 writing samples you paste, or runs a ~15-minute interview where every question comes with three sample answers in three different personas, so you can pick, mix, or answer freely. Filled examples for a fictional writer live in `skills/wiki/examples/`.

## Composition and branding

Everything visual is template-driven. A template is a folder the agent reads and you can edit — no code changes needed to restyle or retune anything.

### Brand skill

At setup, name a brand skill (this repo ships `skills/suse-brand/` as an example: palette, typography, logo markup, component rules, voice notes). The wiki skill loads it before composing slides, documents or SVGs, and every generated visual follows it — including the rule that all artifacts use the brand typeface, never fonts found inside ingested source files. No brand skill? Outputs use a clean neutral default.

### Slide templates (`templates/slides/`)

Every deck is rendered through a template folder: `template.json` (fonts, semantic colors, footer) plus assets (logo SVGs, cover photo, `.ttf` brand fonts). The template owns the masters — logo and page number on every slide, dark section dividers, a photo title slide. Shipped:

- **`suse-sovereign`** — built from a real SUSE customer deck: SUSE typeface, Pine/Jungle palette, geeko lockup, brand photo cover.
- **`neutral`** — clean and unbranded.

The wiki's `CLAUDE.md` names the default in its `slide_template:` key. The deck spec supports assertion-first layouts: `title`, `section`, `content` (with an optional side visual), `two-col`, `image`, `big-number`, `quote`, `closing`.

**Slide quality is enforced, not hoped for.** The compose rules are evidence-based (assertion-evidence research, cognitive-load text limits): a full-sentence assertion per slide, max 5 bullets of ≤16 words, the spoken narrative in speaker notes, a visual every 2-3 slides, and as few slides as the argument needs — one good diagram replaces the slides that would have explained it. The renderer lints every spec (too many bullets, wordy titles, missing notes, text-only runs, padding section dividers) and the agent must fix every warning before delivering.

### Document templates (`templates/docs/`)

A document template is a document **type**, not just a skin: `template.json` carries the styling *and the rules* (word range, bullet policy, figure density); `structure.md` is the section skeleton the agent must follow. Shipped:

- **`whitepaper`** — branded cover page, exec summary → problem → approach → evidence → references; 1500–6000 words, figures required.
- **`pov`** — a point of view argued in 2–4 pages: stance first, exactly three arguments, an honest caveat.
- **`amazon-6pager`** — narrative decision memo; prose only (**the renderer rejects bullets**), 1800–3300 words, FAQ section.

One spec renders to all formats: `bun scripts/compose-doc.ts <spec> -o out.md|.docx|.pdf`. PDF is produced from branded HTML with the real brand fonts embedded, via Chrome/Chromium (`doctor.ts` checks; `.md`/`.docx` need nothing).

### Generated visuals

The agent never pastes source screenshots. Diagrams and charts are generated fresh as SVGs following the brand skill (palette, typography, component rules), then converted to PNG automatically — rendered with the template's own font files, so they look right even on machines without the brand font installed. Images are always placed at true aspect ratio.

### Extending and fine-tuning in your wiki

Templates live inside your wiki and are yours to change:

- **Tweak** a shipped template: edit its `template.json` (colors, fonts, footer text, word caps, bullet policy) or a doc template's `structure.md`. Skill-shipped templates are refreshed when `setup.ts` re-runs, so copy one to a new name before deep edits.
- **Add your own**: copy any template folder to a sibling name (`templates/slides/acme/`, `templates/docs/case-study/`), adjust, and tell the agent to use it — or ask the agent to build one for you from a reference deck or document.
- **Swap the default deck look** via `slide_template:` in the wiki's `CLAUDE.md`; document types are chosen per request ("make it a PoV").
- **Assets**: drop your logo SVGs, a cover photo (pre-cropped to the 4.93:7.5 title panel for slides) and brand `.ttf` files into the template's `assets/`; shared brand assets live once in `templates/shared/`.

## What ingestion extracts

| Source | Extracted |
|---|---|
| `.pptx` | Per-slide text, speaker notes, embedded images (read as zip+XML — no PowerPoint or LibreOffice needed) |
| `.docx` | Full text, embedded images |
| `.pdf` | Text, embedded images, a picture of each page (via poppler) |
| `.md` / `.txt` / images | Read directly |

`raw/.ingest-manifest.json` tracks every file by content hash: edit a source and the next ingest re-extracts it and updates the pages it touched; delete a source and the wiki keeps the knowledge but flags it. Every ingest ends in a git commit, so the wiki has full history.

## The scripts

All run with [bun](https://bun.sh), from the wiki folder. Each wiki carries its own copy in `scripts/`.

| Script | Job |
|---|---|
| `doctor.ts` | Check required tools; print plain-language install hints |
| `setup.ts <dir> --name "X" [--brand <skill>] [--slide-template <name>]` | Scaffold or repair a wiki (idempotent, never overwrites your content; refreshes `scripts/` and skill-shipped templates) |
| `ingest.ts [--dry-run]` | Scan `raw/`, update the manifest, extract to `derived/` |
| `manifest.ts status\|pending\|mark-ingested` | Inspect and update ingest state |
| `compose-pptx.ts <spec.json> -o out.pptx` | Render a slide spec through a `templates/slides/` template; lints against the slide rules |
| `compose-doc.ts <spec.json> -o out.(md\|docx\|pdf)` | Render a document spec through a `templates/docs/` template; lints against the template's word/bullet/figure rules |
| `compose-docx.ts <spec.json> -o out.docx` | Back-compat shim over `compose-doc.ts` |

Spec JSON shapes are documented in the header comments of the compose scripts. SVG images referenced in specs are converted to PNG automatically, using the template's font files.

**Requirements:** macOS or Linux, `bun` 1.4+, `unzip` (ships with macOS), `poppler` (`brew install poppler`), `git` (optional but recommended), Chrome or Chromium (optional — only for `.pdf` output). `doctor.ts` checks all of it.

## This repository

This is the skill's development repo.

```
skills/wiki/          # the skill: SKILL.md, references/, templates/ (slides, docs, shared), examples/, scripts/
skills/suse-brand/    # example brand skill
.claude/skills/       # symlinks so this repo can run the skills directly
docs/                 # the original idea (kapathy/gist.md), profile examples, sample source decks
testing/my-wiki/      # a live test wiki with composed outputs (deck, whitepaper in md/docx/pdf)
```

To work on the skill, edit under `skills/wiki/` and test by creating a throwaway wiki: `bun skills/wiki/scripts/setup.ts /tmp/test-wiki --name "Test"`, drop files in its `raw/`, then run its `scripts/ingest.ts`.
