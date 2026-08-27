# Setup mode

Goal: a ready wiki folder, dependencies installed, schema in place, profile started.

## 1. Dependencies (consent first)

Check in this order. For each missing tool: one plain sentence on what it is and why, then a yes/no question. Never install without a yes.

1. **bun** - `command -v bun`. If missing: "I need to install bun, a small tool that runs the wiki's helper scripts. OK to install?" Then run `curl -fsSL https://bun.sh/install | bash` and make sure `~/.bun/bin` is on PATH for subsequent commands (`export PATH="$HOME/.bun/bin:$PATH"`).
2. **Everything else** - run `bun <skill>/scripts/doctor.ts`. It lists missing tools with exact install commands (poppler via brew, etc.). Ask once, install what was approved, re-run doctor to confirm.

## 2. Ask two things, decide the rest

- **Name**: "What should the wiki be called?"
- **Brand** (only if they will want styled slides/docs): "Do you have a brand skill for styling outputs?" Default: none.

Location default: `~/Wikis/<name>` (kebab-case the name). A user-supplied path wins.

## 3. Scaffold

```
bun <skill>/scripts/setup.ts ~/Wikis/<name> --name "<Name>" [--brand <brand-skill>]
```

Idempotent: safe to re-run, never overwrites content. It creates the folders, the manifest, seeds `wiki/log.jsonl`, the wiki `CLAUDE.md` (from `templates/wiki-claude.md`), copies `scripts/` in (refreshing skill-owned scripts), runs `bun install`, generates `wiki/index.json` + `wiki/map.json` via `links.ts`, and makes the first git commit.

## 4. Profile

If the user has voice/quality files, copy them to `profile/voice.md` and `profile/quality-and-style.md` and commit. If not, offer the interview: see references/profile.md. It is fine to defer the profile until the first compose; ingest does not need it.

## 5. Hand-over sentence

Tell the user in plain words: where the wiki lives, that they drop files into `raw/` (any subfolders they like), and that they say "ingest" when ready.
