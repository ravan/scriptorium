# Scriptorium

You have forty slide decks, a folder of PDFs and a whitepaper you wrote last year. The knowledge is in there. Answering a question means opening the files and reading them again, every time.

Scriptorium is a [Claude Code](https://claude.com/claude-code) skill that reads that material once and compiles it into a markdown wiki the agent maintains. It then writes new work out of the wiki: blog posts, LinkedIn posts, branded slide decks, whitepapers, points of view and memos. Each one renders as Markdown or Word or PDF.

You curate sources and ask questions. The agent does the rest: extraction, summarizing, cross-referencing, filing and writing.

A scriptorium was the room where books were read, copied and made. Knowledge in. New documents out.

## Compile the knowledge once instead of re-reading on every question

The pattern comes from Andrej Karpathy's ["LLM Wiki" gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f#file-llm-wiki-md). RAG goes back to the raw documents on every question. A compiled wiki does the understanding once and then keeps it current.

Every source you add makes the wiki richer. Every good answer gets filed back, so the next question starts further along.

This skill makes the pattern deterministic rather than hopeful. Fixed folder layout. Hash-tracked ingestion. Repeatable scripts.

## Three layers, and only one of them is yours to write

| Layer | Who writes it | What it is |
|---|---|---|
| `raw/` | You | Your source files, in any subfolders you like. Immutable: the agent never touches them. |
| `wiki/` | The agent | Interlinked markdown. Source summaries, topics, entities, syntheses, an index and a log. |
| `CLAUDE.md` | The skill | The schema. The rules the agent follows to maintain this wiki. |

Deterministic work lives in bun and TypeScript scripts: extraction, manifest tracking, pptx and docx rendering. Judgment work stays with the agent: understanding, synthesis and writing.

```
my-wiki/
  raw/                    # your sources; .ingest-manifest.json tracks state
  derived/                # machine-extracted text + images per source
  wiki/                   # index.md, log.md, sources/, topics/, entities/, syntheses/
  profiles/               # idiolect voice profiles, one folder per named voice
  outputs/                # composed blogs, posts, decks, docs, images
  templates/              # slide + document templates (skill-shipped and your own)
  scripts/                # self-contained copy of the bun helpers
  CLAUDE.md               # the schema
```

## Install it with the skills CLI

Use the [Vercel skills CLI](https://github.com/vercel-labs/skills). It reads this repo's `skills/` folder and installs into whichever agent you use: Claude Code, Cursor, Codex, opencode and others.

```bash
# everything: wiki + lolly (visual assets) + suse-brand (example brand skill)
npx skills add ravan/scriptorium

# or with bun
bunx skills add ravan/scriptorium
```

Useful variants:

```bash
npx skills add ravan/scriptorium --list                     # see what is in here
npx skills add ravan/scriptorium --skill wiki               # just the wiki skill
npx skills add ravan/scriptorium -g -a claude-code -y       # user-wide, no prompts
```

`-g` installs to `~/.claude/skills`. Without it the skill lands in the current project's `.claude/skills`.

| Skill | What it is |
|---|---|
| `wiki` | The skill itself: ingest, maintain, compose. |
| `lolly` | Generates visual assets: charts, diagrams, codes, backgrounds. Optional. |
| `suse-brand` | An example brand skill: palette, typography, logo rules. Replace it with your own. |

## From an empty folder to a first deck

You do not need to know the command line. The agent runs every command and asks a plain yes or no question before it installs anything.

1. **Install the skill.** See above, then restart your agent.
2. **Create a wiki.** Say: *"Set up a wiki called Sovereignty Research."* The agent checks for bun, poppler and git. It asks before installing anything that is missing, then scaffolds the folder. Default location is `~/Wikis/<name>`.
3. **Add sources.** Drop files into `raw/`: `.pptx`, `.pdf`, `.docx`, markdown, text and images. Subfolders are fine.
4. **Ingest.** Say: *"Ingest my sources."* The scripts pull out text, speaker notes and embedded images. The agent reads all of it and views every image and describes it. Then it writes and cross-links the wiki pages.
5. **Ask questions.** *"What do we know about data residency rules?"* Answers cite wiki pages. Answers worth keeping get filed back into `wiki/syntheses/`.
6. **Compose.** *"Write a LinkedIn post about X"* or *"make a slide deck on Y"* or *"write a whitepaper on Z as PDF"*. Outputs land in `outputs/`.

Say *"ingest slowly"* if you want to review each source together before it is filed.

Decks are real `.pptx` files that import into Google Slides through File then Import. Documents render to `.md`, `.docx` or `.pdf` from one spec.

## Your voice is an idiolect profile, not a prompt you retype

Composed outputs are governed by a voice profile in `profiles/<name>/`, created and maintained by the [idiolect](https://github.com/ravan/slop) skill. Setup bundles idiolect into every wiki automatically (installing it from `ravan/hogwash` if it is not already on the machine), and the wiki's `CLAUDE.md` names the active profile.

A profile is a folder: `voice.md` (how you sound), `quality.md` (what "good" means per format), `ban-list.md` (words you forbid), `registers/` (per-format overlays: blog, LinkedIn, whitepaper, talk), plus an evidence ledger and a changelog. A wiki can hold several named voices.

Say *"capture my voice"*. Idiolect builds the profile from writing you point it at, or through its guided interview when you have no samples, and it refines the profile every time you react to a piece ("I'd never say that"). A profile can also live user-wide in `~/.idiolect/profiles/<name>/`, shared by every project. Everything voice goes through the bundled hogwash skill, on its own defaults; the wiki writes no `hogwash.json`. Hogwash's rule packs are the real ban list (the machine-writing tells); the idiolect profile adds your own bans and voice, and hogwash's rewrite loop applies it from its default `profile/` path, so one symlink (`~/.idiolect/profile -> ~/.idiolect/profiles/<name>`) makes your voice the default in every project.

## Everything visual comes from a template folder you can edit

A template is a folder the agent reads. Restyling or retuning needs no code change.

### The brand skill is loaded before anything visual is drawn

At setup you name a brand skill. This repo ships `skills/suse-brand/` as a worked example: palette, typography, logo markup, component rules and voice notes.

The wiki skill loads it before composing slides, documents or SVGs. That includes the rule that every artifact uses the brand typeface, never a font found inside an ingested source file. With no brand skill the outputs use a clean neutral default.

### A slide template owns the masters, not just the colours

Every deck renders through a folder under `templates/slides/`. It holds `template.json` for fonts and semantic colours and footer, plus the assets: logo SVGs, a cover photo and `.ttf` brand fonts.

The template owns the logo and page number on every slide, the dark section dividers and the photo title slide. Two ship today:

- **`suse-sovereign`**: built from a real deck. SUSE typeface, Pine and Jungle palette, geeko lockup, brand photo cover.
- **`neutral`**: clean and unbranded.

The wiki's `CLAUDE.md` names the default in its `slide_template:` key. The deck spec supports assertion-first layouts: `title`, `section`, `content` with an optional side visual, `two-col`, `image`, `big-number`, `quote` and `closing`.

### Slide quality is linted, not hoped for

The compose rules come from assertion-evidence research and cognitive-load text limits. A full sentence assertion per slide. At most 5 bullets of 16 words or fewer. The spoken narrative goes in the speaker notes.

A visual appears every two or three slides, and a deck runs as short as the argument allows. One good diagram replaces the four slides that would have explained it.

The renderer lints every spec for too many bullets, wordy titles, missing notes, runs of text-only slides and padding section dividers. The agent has to clear every warning before it hands the deck over.

### A document template is a document type, not a skin

`template.json` carries the styling and the rules: word range, bullet policy, figure density. `structure.md` is the section skeleton the agent has to follow. Three ship today:

- **`whitepaper`**: branded cover page, then exec summary, problem, approach, evidence and references. 1500 to 6000 words. Figures required.
- **`pov`**: a point of view argued in two to four pages. Stance first, exactly three arguments, one honest caveat.
- **`amazon-6pager`**: a narrative decision memo. Prose only, so the renderer rejects bullets. 1800 to 3300 words, with an FAQ section.

One spec renders to every format: `bun scripts/compose-doc.ts <spec> -o out.md|.docx|.pdf`. PDF comes from branded HTML with the real brand fonts embedded, rendered through Chrome or Chromium. `.md` and `.docx` need nothing extra.

### Diagrams are generated, never screenshotted

The agent does not paste pictures out of your source files. Diagrams and charts are drawn fresh as SVGs following the brand skill, then converted to PNG.

Rendering uses the template's own font files, so the output looks right on a machine that has never had the brand font installed. Images are always placed at true aspect ratio.

### Templates live inside your wiki, so they are yours to change

- **Tweak** a shipped template through its `template.json`: colours, fonts, footer text, word caps and bullet policy. A doc template's `structure.md` is editable the same way. Skill-shipped templates get refreshed when `setup.ts` re-runs, so copy one to a new name before you make deep edits.
- **Add your own** by copying a folder to a sibling name such as `templates/slides/acme/` or `templates/docs/case-study/`. Adjust it, then tell the agent to use it. The agent can also build one for you from a reference deck or document.
- **Swap the default deck look** through `slide_template:` in the wiki's `CLAUDE.md`. Document types are chosen per request instead, as in "make it a PoV".
- **Drop in assets** under the template's `assets/`: your logo SVGs, a cover photo pre-cropped to the 4.93:7.5 title panel and your brand `.ttf` files. Shared brand assets live once in `templates/shared/`.

## What ingestion pulls out of each file type

| Source | Extracted |
|---|---|
| `.pptx` | Per-slide text, speaker notes, embedded images. Read as zip and XML, so no PowerPoint or LibreOffice needed. |
| `.docx` | Full text and embedded images. |
| `.pdf` | Text, embedded images and a picture of each page, through poppler. |
| `.md` / `.txt` / images | Read directly. |

`raw/.ingest-manifest.json` tracks every file by content hash. Edit a source and the next ingest re-extracts it and updates the pages it touched. Delete a source and the wiki keeps the knowledge but flags it.

Every ingest ends in a git commit, so the wiki carries its full history.

## The scripts do the half that should never be improvised

All of them run with [bun](https://bun.sh) from the wiki folder. Each wiki carries its own copy in `scripts/`.

| Script | Job |
|---|---|
| `doctor.ts` | Check required tools and print plain-language install hints |
| `setup.ts <dir> --name "X" [--brand <skill>] [--slide-template <name>] [--voice-profile <name>] [--refresh-templates] [--refresh-schema]` | Scaffold or repair a wiki. Idempotent, never overwrites your content. A re-run refreshes `scripts/`, adds new templates but keeps template files you edited (`--refresh-templates` overwrites them), updates a `CLAUDE.md` config line per flag, and commits only what it changed |
| `ingest.ts [--dry-run]` | Scan `raw/`, update the manifest, extract to `derived/` |
| `manifest.ts status\|pending\|mark-ingested` | Inspect and update ingest state |
| `compose-pptx.ts <spec.json> -o out.pptx` | Render a slide spec through a `templates/slides/` template and lint it |
| `compose-doc.ts <spec.json> -o out.(md\|docx\|pdf)` | Render a document spec through a `templates/docs/` template and lint it against the word, bullet and figure rules |
| `compose-docx.ts <spec.json> -o out.docx` | Back-compat shim over `compose-doc.ts` |

The spec JSON shapes are documented in the header comments of the compose scripts. SVG images named in a spec are converted to PNG automatically, using the template's font files.

**Requirements**: macOS or Linux, `bun` 1.4+, `unzip` and `poppler`. `unzip` ships with macOS and `poppler` comes from `brew install poppler`. `git` is optional but worth having, and Chrome or Chromium is needed only for `.pdf` output. `doctor.ts` checks all of it.

## Decisions, and what each one rejected

- **A compiled wiki instead of RAG over the raw files.** RAG was rejected because it pays the understanding cost on every question and never accumulates. The cost here is an ingest step you have to run.
- **Scripts for extraction, agent for judgment.** Letting the agent parse `.pptx` and `.pdf` directly was rejected as non-repeatable. Two runs over the same deck have to produce the same `derived/` output.
- **`.pptx` read as zip and XML.** Driving LibreOffice or PowerPoint was rejected because it adds a large install and a headless failure mode on a machine you do not control.
- **Templates as folders of JSON and assets.** Styling in code was rejected because rebranding a deck should not be a pull request.
- **Lints that block delivery.** Guidance in the prompt was rejected because the agent talks itself past guidance. A failing lint line is harder to argue with.

## What is still open

- The repository is `scriptorium` but the skill inside it is still named `wiki`, because "my wiki" is what people actually say when they want it.
- Only macOS and Linux are exercised. Windows is untested rather than unsupported.
- The three document templates cover the shapes I needed. Anything else is a folder you write yourself.

## This repository

```
skills/wiki/          # the skill: SKILL.md, references/, templates/, scripts/
skills/lolly/         # visual-asset skill used when composing
skills/suse-brand/    # example brand skill
.claude/skills/       # symlinks so this repo can run the skills directly
docs/                 # the original idea (karpathy/gist.md), profile examples, sample decks
testing/my-wiki/      # a live test wiki with composed outputs
```

`skills/<name>/SKILL.md` is the layout the skills CLI discovers. Anything added under `skills/` installs straight from GitHub, with no packaging step and no npm publish.

To work on the skill, edit under `skills/wiki/` and test against a throwaway wiki: `bun skills/wiki/scripts/setup.ts /tmp/test-wiki --name "Test"`. Drop files into its `raw/`, then run its `scripts/ingest.ts`.

## Those forty decks

They are still sitting in the folder. The difference is that now they get read once, by something that writes down what it found and remembers it the next time you ask.

## License

[MIT](LICENSE), copyright Ravan Naidoo. The SUSE brand assets under `skills/suse-brand/` and `skills/wiki/templates/shared/suse/` are SUSE property and are included here as a worked example only.
