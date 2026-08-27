# Wiki — an agent-maintained knowledge base skill

A [Claude Code](https://claude.com/claude-code) skill that turns a folder of source material into a living, interlinked markdown wiki — and then recomposes that knowledge into blogs, LinkedIn posts, slide decks, Word documents and SVG images, written in **your** voice.

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
6. **Compose.** *"Write a LinkedIn post about X"*, *"make a slide deck on Y"*. Outputs land in `outputs/`, written in your voice, checked against your quality bar, styled by your brand skill. Decks are real `.pptx` files that import into Google Slides (File → Import).

### Your voice and quality profile

Composed outputs are governed by two files in `profile/`:

- **`voice.md`** — how you sound: openings, sentence rhythm, kill list of banned words, hard rules.
- **`quality-and-style.md`** — what "good" means per format: structure, evidence rules, ship checklists.

Have them already? The agent copies them in at setup. Don't? Say *"capture my voice"* — the agent either drafts a profile from 3–5 writing samples you paste, or runs a ~15-minute interview where every question comes with three sample answers in three different personas, so you can pick, mix, or answer freely. Filled examples for a fictional writer live in `skills/wiki/examples/`.

### Brand styling

Slides, documents and SVGs can follow a brand. At setup, name a brand skill (this repo ships `skills/suse-brand/` as an example: palette, typography, logo, component rules). The wiki skill loads it before composing anything visual. No brand skill? Outputs use a clean neutral default.

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
| `setup.ts <dir> --name "X" [--brand <skill>]` | Scaffold or repair a wiki (idempotent, never overwrites) |
| `ingest.ts [--dry-run]` | Scan `raw/`, update the manifest, extract to `derived/` |
| `manifest.ts status\|pending\|mark-ingested` | Inspect and update ingest state |
| `compose-pptx.ts <spec.json> -o out.pptx` | Render a slide spec to `.pptx` |
| `compose-docx.ts <spec.json> -o out.docx` | Render a document spec to `.docx` |

Spec JSON shapes are documented in the header comments of the two compose scripts. SVG images referenced in specs are converted to PNG automatically.

**Requirements:** macOS or Linux, `bun`, `unzip` (ships with macOS), `poppler` (`brew install poppler`), `git` (optional but recommended). `doctor.ts` checks all of it.

## This repository

This is the skill's development repo.

```
skills/wiki/          # the skill: SKILL.md, references/, templates/, examples/, scripts/
skills/suse-brand/    # example brand skill
.claude/skills/       # symlinks so this repo can run the skills directly
docs/                 # the original idea (kapathy/gist.md) and real profile examples
```

To work on the skill, edit under `skills/wiki/` and test by creating a throwaway wiki: `bun skills/wiki/scripts/setup.ts /tmp/test-wiki --name "Test"`, drop files in its `raw/`, then run its `scripts/ingest.ts`.
